# Tilda PricPay 支付网关

这是一个 Next.js 后端支付网关，用于把 Tilda 独立站订单转成 PricPay 订单，并处理 PricPay 的同步跳转和异步通知。

## 接口

### 客户数据接收

```text
POST /api/tilda/customer-data
```

接收购物车脚本发送的真实客户信息，以完整订单 ID 和随机 token 哈希关联。Cashier 和普通创单均须先取得这份数据；缺失时停止创单。部署后还须按 [T123 安装步骤](docs/tilda-customer-data-install.zh-CN.md) 在 Tilda 加入脚本，并删除 Additional 中七组同名固定客户字段。

国家输入支持 RU，以及 Россия、Российская Федерация、РФ、Russia、Russian Federation、RUS 这些明确的俄罗斯名称，统一转成 RU。其他国家仍使用两位代码。校验错误响应会包含 field；脚本用对应的俄文字段标题提示买家，服务器日志只记录字段名和状态码，不记录失败输入值。

### 普通创单

```text
POST /api/pricpay/create
```

对应 PricPay `v2/checkout` 创单文档。该接口需要 `PRICPAY_PUB_ID`。

### 收银台创单

```text
POST /api/pricpay/cashier
```

对应 PricPay `cache-merchant-info` 收银台文档。该接口返回 PricPay cashier 跳转地址，不需要 `PRICPAY_PUB_ID`。

### 异步通知

```text
POST /api/pricpay/notify
```

PricPay 支付通知地址。网关会：

- 校验 PricPay 签名。
- 保存通知原始参数到 Neon Postgres。
- 仅在 orderStatus=100 且回调金额、币种与数据库原订单一致时，将规范化金额重新签名并通知 Tilda。
- 只有 Tilda 返回 HTTP 2xx 且正文为 OK 才记录转发成功；拒绝或网络错误返回 502，供上游重试。
- 正常处理返回纯文本 ok；无效签名返回 401，金额／币种不符返回 400，原订单或通知地址不可用返回 503。

创单 transactionAmount 保持主货币单位不变。回调 amount 默认按最小货币单位解释，例如 RUB 的 7263589.00000000 转为 72635.89；先验原始签名，再用整数精确核对原订单，不能用显示金额或自动猜测单位代替验证。transactionAmount 回调字段仍按主单位处理；两个金额字段同时出现时必须都匹配。

可选环境变量 PRICPAY_NOTIFY_AMOUNT_UNIT=minor（默认）或 major，仅控制回调 amount 的单位。当前 RUB 通道已有日志验证 100 倍关系，无需新增该变量即可使用 minor。其他商户通道应先确认回调单位；收到主单位 amount 的通道才显式配置 major。程序按币种精度处理，JPY 等零位小数币种不会统一除以 100。转发 Tilda 的金额按币种精度格式化；原始回调值留在日志中。

### 同步跳转

```text
GET /api/pricpay/return
```

用户从 PricPay 返回时进入该接口。只有该订单存在已验签、已核对金额和币种的成功回调记录，才进入成功页。未确认付款时进入配置的处理中页，未配置则返回商店首页；失败或取消提示进入失败页，未配置则返回商店首页。浏览器返回参数不更新付款状态，即使传入 SUCCESS 或 100，也不能单独作为成功依据。

## 请求示例

以下是安装脚本后支付 POST 的字段示例。customerDataToken 必须来自本次已保存的客户数据，不能直接复制示例值独立发单；客户字段由已验证的对应记录补入。

```json
{
  "orderid": "38252103:10001",
  "customerDataToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "amount": "38.59",
  "currency": "USD",
  "firstName": "Ivan",
  "lastName": "Ivanov",
  "customerCountry": "RU",
  "state": "Moscow Oblast",
  "city": "Moscow",
  "address": "Example Street 12",
  "zip": "001234",
  "phone": "+79991234567",
  "orderTime": "2026-10-20T10:15:30+03:00",
  "email": "customer@example.com",
  "notifyUrl": "https://example.tilda.ws/payment/custom/notify",
  "successUrl": "https://example.tilda.ws/payment-success",
  "failUrl": "https://example.tilda.ws/payment-fail"
}
```

成功创单响应：

```json
{
  "ok": true,
  "orderNo": "TX...",
  "target": "https://...",
  "redirectUrl": "https://..."
}
```

Tilda 的浏览器表单 POST 默认会收到 `303` 跳转并进入 PricPay cashier 页面。调试或服务端调用时可在接口后加 `?response=json`，此时返回上面的 JSON。

订单号须按 Tilda 顶层 Mapping 使用项目 ID:订单号，例如 38252103:10001。真实客户记录中的 firstName、customerCountry 优先于旧 name、country；国家代码去掉首尾空格并转大写。地址键当前对应 PricPay 的账单地址，配送地址与账单地址不同时不能直接复用。

`orderTime` 使用带时区的 ISO-8601 时间（`Z` 或 `+03:00` 等偏移，秒必填，可带 1 至 3 位毫秒）。网关转成 UTC 的 `YYYY-MM-DD HH:mm:ss`，例如上面的值变为 `2026-10-20 07:15:30`。传入无效日期或缺少时区会返回 HTTP 400；未传或空值时兼容旧请求，使用服务器当前 UTC 时间。原始入参仍保存在订单日志中。

## 日志和数据库

当前方案使用 Neon Postgres，不需要创建 Neon Object Storage bucket。原因是网关日志主要是结构化请求/响应/状态数据，用 Postgres JSONB 更容易按订单号、事件类型和时间查询。

表结构在 `db/schema.sql`：

- `gateway_orders`：订单主表，保存 Tilda 订单号、PricPay 订单号、金额、Tilda 回调/跳转 URL、当前状态。
- `gateway_events`：事件日志，保存 Tilda 入参、PricPay 请求参数、签名排序串、签名结果、跳转地址、错误信息。
- `payment_notifications`：PricPay 异步通知记录，保存原始通知、签名校验结果、是否已转发给 Tilda。
- `tilda_customer_data`：按订单 ID 与 token 哈希保存的临时客户数据，关联有效期 30 分钟，后续上传清理过期行；原始订单日志额外保留 customerData。

本地应用 schema：

```bash
npm run db:schema
```

如果本机到 Neon HTTP SQL endpoint 超时，可用 Neon CLI psql 通道：

```bash
neon psql production -- -f db/schema.sql
```

## 环境变量

Vercel 生产环境至少需要：

```text
DATABASE_URL=Neon pooled connection string
DATABASE_URL_UNPOOLED=Neon unpooled connection string
PRICPAY_MERCHANT_NO=你的 merchantNo
PRICPAY_SECRET=PricPay 签名密钥
PRICPAY_MERCHANT_WEBSITE=https://你的网关域名
```

普通创单还需要：

```text
PRICPAY_PUB_ID=你的 pubId
PRICPAY_CREATE_MODE=EPP
PRICPAY_PAYMENT_METHOD=CardEmbed
```

Tilda 转发和跳转可通过订单入参传入，也可以用环境变量兜底：

```text
TILDA_NOTIFY_URL=https://你的 Tilda 通知地址
TILDA_SUCCESS_URL=https://你的 Tilda 成功页
TILDA_FAILURE_URL=https://你的 Tilda 失败页
TILDA_PENDING_URL=https://你的 Tilda 处理中页
TILDA_NOTIFY_SECRET=Tilda 通知签名密钥
```

可选：

```text
GATEWAY_HEALTH_TOKEN=生产环境 health 接口访问令牌
GATEWAY_DB_TIMEOUT_MS=1000
TILDA_SITE_ORIGIN=https://hoteltoiletries.ru
PRICPAY_NOTIFY_AMOUNT_UNIT=minor
```

`GATEWAY_DB_TIMEOUT_MS` 控制日志写库最多等待多久。默认 1000ms；超过后跳过本次数据库日志并写入 Vercel 控制台，避免日志库拖慢支付主流程。

客户数据存储是创单必需步骤，不按可跳过日志处理：写入最多等待 5 秒，Cashier 关联最多等待 8 秒，失败返回 503／504 并停止创单。TILDA_SITE_ORIGIN 可省略，默认是上述店铺 origin，无末尾斜杠。

## 健康检查

本地：

```text
GET http://localhost:3000/api/neon/health
GET http://localhost:3000/api/neon/health?details=1
```

生产环境需要带 `GATEWAY_HEALTH_TOKEN`：

```text
GET https://你的域名/api/neon/health?details=1&token=...
```

## 本地验证

本地回归测试使用 Node.js 22.6+ 的实验性 TypeScript 类型剥离功能，不请求 PricPay 或数据库：

```bash
npm test
npx tsc --noEmit
npm run build
npm start
```

未安装 T123 或缺少 customerDataToken 时，创单接口返回 400；无对应客户记录时返回 504。通过客户数据检查后才继续检查 PricPay 商户配置并发起真实请求。数据库及浏览器隔离联调步骤见 [安装文档](docs/tilda-customer-data-install.zh-CN.md)。
