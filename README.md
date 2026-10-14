# Tilda PricPay 支付网关

这是一个 Next.js 后端支付网关，用于把 Tilda 独立站订单转成 PricPay 订单，并处理 PricPay 的同步跳转和异步通知。

## 接口

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
- 仅在 `orderStatus=100` 时把支付成功通知转发给 Tilda。
- 对 PricPay 返回纯文本 `ok`。

### 同步跳转

```text
GET /api/pricpay/return
```

用户从 PricPay 返回时进入该接口。网关会按 PricPay 返回状态或数据库订单状态跳转到 Tilda 的成功、失败或处理中页面。最终订单状态仍以异步通知为准。

## 请求示例

```json
{
  "orderid": "TILDA-10001",
  "amount": "38.59",
  "currency": "USD",
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

## 日志和数据库

当前方案使用 Neon Postgres，不需要创建 Neon Object Storage bucket。原因是网关日志主要是结构化请求/响应/状态数据，用 Postgres JSONB 更容易按订单号、事件类型和时间查询。

表结构在 `db/schema.sql`：

- `gateway_orders`：订单主表，保存 Tilda 订单号、PricPay 订单号、金额、Tilda 回调/跳转 URL、当前状态。
- `gateway_events`：事件日志，保存 Tilda 入参、PricPay 请求参数、签名排序串、签名结果、跳转地址、错误信息。
- `payment_notifications`：PricPay 异步通知记录，保存原始通知、签名校验结果、是否已转发给 Tilda。

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
```

`GATEWAY_DB_TIMEOUT_MS` 控制日志写库最多等待多久。默认 1000ms；超过后跳过本次数据库日志并写入 Vercel 控制台，避免日志库拖慢支付主流程。

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

```bash
npm run build
npm start
```

在没有 PricPay 商户变量时，`/api/pricpay/create` 和 `/api/pricpay/cashier` 会返回配置错误，这是预期结果；配置完整后才会真实请求 PricPay。
