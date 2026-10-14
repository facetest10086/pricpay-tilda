# PricPay + Tilda 支付网关整改方案

状态：提议中
日期：2026-10-14

## 背景

当前项目是一个部署在 Vercel 上的 Next.js 支付网关：

- 线上网关：https://pricpay-tilda.vercel.app/
- GitHub 仓库：https://github.com/facetest10086/pricpay-tilda/

本地代码已经下载并由 Git 管理，本地路径为：

```text
C:\Users\kejop\Documents\Codex\2026-10-12\https-github-com-facetest10086-pricpay-tilda\work\pricpay-tilda
```

本地 Git 远程仓库为：

```text
origin https://github.com/facetest10086/pricpay-tilda.git
```

当前代码只有两个主要接口：

- `POST /api/pricpay/create`
- `POST /api/pricpay/notify`

后续版本需要把 PricPay 的两种创单方式拆开处理，同时补齐支付完成后的用户跳转、异步回调、订单状态记录和网关日志持久化。

## 参考官方文档

- Tilda 自定义支付网关文档：
  https://help.tilda.cc/payments/custom-payment-gateway
- PricPay 普通创单接口：
  https://www.pricpay.com/api/create.html
- PricPay Cashier/HPP 创单接口：
  https://www.pricpay.com/api/cashier.html
- PricPay 签名文档：
  https://www.pricpay.com/api/signature.html
- PricPay 异步通知文档：
  https://www.pricpay.com/api/notify.html
- Vercel Runtime Logs：
  https://vercel.com/docs/logs/runtime
- Neon Pricing：
  https://neon.com/pricing

## Tilda 侧的接入模型

Tilda 的自定义支付网关不是纯 JSON API 模型。

根据 Tilda 文档，正常流程应是：

1. 买家在 Tilda 独立站提交订单。
2. Tilda 通过 `POST` 把买家跳转到支付系统 API URL。
3. 支付系统校验订单签名，然后展示支付页或继续跳转到真正的支付页。
4. 支付结束后，支付系统可以把买家跳回成功页或失败页。
5. 支付系统还需要通过 `POST` 通知 Tilda 的支付通知 URL。
6. Tilda 收到通知并校验签名后，才会把订单标记为已支付。

这对当前网关的含义是：

- 面向 Tilda 的创单接口不应该只返回 JSON。
- 生产流程中，创单成功后应该把浏览器重定向到 PricPay 支付页。
- JSON 响应可以保留给手动测试使用，比如通过 `Accept: application/json` 或 `?format=json` 开启。
- 网关应该校验 Tilda 发起订单时带来的签名。
- Tilda 的通知地址、成功页、失败页等信息要在创单时保存下来，后续 PricPay 回调时不能指望 PricPay 再带回来。

## PricPay 的两种创单接口

PricPay 这里实际有两种创建订单方式，建议在本项目中拆成两个明确的路由。

### 普通创单接口：`/api/pricpay/create`

项目对外路由：

```text
POST /api/pricpay/create
```

对应 PricPay 接口：

```text
POST https://gateway.pricpay.com/payment/gateway/payapi/v2/checkout
Content-Type: application/json
```

这个接口用于 PricPay 普通 checkout/create 流程。

典型参数包括：

- `mode`
- `paymentMethodCode`
- `merchantNo`
- `orderNumber`
- `transactionAmount`
- `transactionCurrency`
- `notifyUrl`
- `returnUrl`
- `productInformation`
- `pubId`
- `signature`

成功响应里会有：

- `data.orderNo`
- `data.shopUrl`
- `data.thirdUrl`
- `data.directFlag`

跳转规则：

- 如果 `directFlag === 1` 且 `thirdUrl` 存在，则跳转到 `thirdUrl`。
- 否则跳转到 `shopUrl + '?orderFlag=b&orderNo=' + orderNo`。

### Cashier/HPP 接口：`/api/pricpay/cashier`

项目对外路由：

```text
POST /api/pricpay/cashier
```

对应 PricPay 接口：

```text
POST https://gateway.pricpay.com/payment/gateway/payapi/cache-merchant-info
Content-Type: application/json
```

这个接口用于 PricPay Cashier/HPP 流程。

当前代码默认 `PRICPAY_MODE=HPP`，所以现在的 `/api/pricpay/create` 实际默认走的是这个 Cashier/HPP 接口，而不是普通 `v2/checkout` 创单接口。

Cashier/HPP 的最终请求 payload 不应包含：

- `mode`
- `paymentMethodCode`
- `pubId`

PricPay 会返回一个 cashier token 字符串。

跳转规则：

```text
https://cashier.pricpay.com?cashier=<token>
```

## 当前代码的主要问题

### 1. 一个 `/create` 接口混合了两种 PricPay 创单模式

当前代码通过 `PRICPAY_MODE` 判断走普通创单还是 HPP/Cashier。

问题：

- 接口语义不清晰。
- 很难从 URL 判断实际走的是哪份 PricPay 文档。
- 后续调试和 Tilda 配置容易混乱。

建议：

- `/api/pricpay/create` 固定走 PricPay 普通 `v2/checkout`。
- `/api/pricpay/cashier` 固定走 PricPay Cashier/HPP。
- 不再用 `PRICPAY_MODE` 决定路由行为。

### 2. 创单成功后只返回 JSON

当前响应类似：

```json
{
  "ok": true,
  "orderNo": "xxx",
  "target": "https://...",
  "redirectUrl": "https://..."
}
```

问题：

- Tilda 文档描述的是浏览器通过 `POST` 到支付网关，支付网关展示或跳转支付页。
- 如果 Tilda 不支持读取 JSON 里的 `redirectUrl` 再跳转，用户可能只看到 JSON。

建议：

- 默认返回 `302` 跳转，或者返回一个自动跳转 HTML 页面。
- 保留 JSON 模式用于接口测试。

### 3. 没有校验 Tilda 发起订单的签名

当前任何人都可以直接 POST 到 `/api/pricpay/create` 发起 PricPay 创单。

风险：

- 可被伪造订单请求。
- 可造成无效订单、日志污染或额外接口调用。

建议：

- 增加 `TILDA_ORDER_SECRET`。
- 对 Tilda 传入参数进行签名校验。
- 校验失败直接拒绝创单并记录日志。

### 4. PricPay 异步回调丢失 Tilda 通知地址

当前代码把 `target`、`order`、`amount` 放在 PricPay `notifyUrl` 的 query 里。

但当前 `/api/pricpay/notify` 只读取 POST body，不读取 URL query。

问题：

- PricPay 回调 body 里默认不会带 Tilda 的通知地址。
- 网关可能返回 `{ ok: true }`，但实际上没有通知 Tilda。

建议：

- 创单时把 Tilda 通知地址保存到数据库。
- PricPay 回调时根据 `orderNumber` 查数据库。
- 从数据库取出 Tilda 通知地址，再通知 Tilda。

### 5. 异步回调没有判断 PricPay 订单状态

PricPay 通知文档中常见状态包括：

- `orderStatus=100`：支付成功
- `orderStatus=120`：支付失败
- `orderStatus=103`：处理中

当前代码只要签名正确，就直接向 Tilda 发送 `paid=true`。

风险：

- 失败订单可能被标记为支付成功。
- 处理中订单可能被提前标记为支付成功。

建议：

- 只有 `orderStatus=100` 才通知 Tilda 支付成功。
- `120` 记录失败，不通知成功。
- `103` 记录处理中，不通知成功。

### 6. `returnUrl` 指向不存在的路由

当前默认 `returnUrl` 是：

```text
/api/pricpay/return
```

但项目里没有这个路由。

问题：

- 买家支付后可能跳到 404。
- 成功页/失败页无法统一处理。

建议：

- 新增 `/api/pricpay/return`。
- 这个接口只处理买家浏览器跳转，不作为订单支付成功的最终依据。
- 最终订单状态以 PricPay 异步通知为准。

### 7. 没有持久化订单状态

当前没有数据库。

问题：

- 无法可靠关联 Tilda 订单和 PricPay 回调。
- 无法保存 Tilda 通知地址、成功页、失败页、金额、邮箱、创单模式。
- 无法处理重复回调。
- 无法排查历史支付问题。

建议：

- 使用 Neon Postgres 保存订单、回调和日志。

### 8. 没有持久化网关日志

Vercel 的运行日志适合临时调试，不适合作为支付网关审计日志。

建议记录：

- Tilda 传来的原始数据
- 归一化后的订单数据
- 组装给 PricPay 的参数
- 签名前的参数串
- 签名结果
- 请求 PricPay 前的 payload
- PricPay 创单响应
- 最终跳转链接
- 浏览器同步返回参数
- PricPay 异步通知参数
- 通知 Tilda 的请求和响应
- 错误信息和异常堆栈摘要

敏感字段必须脱敏，不能把密钥和完整敏感信息写入日志。

### 9. 没有重复通知处理

支付平台通常会重试异步通知。

建议：

- 按 `platformOrderNo + orderStatus` 或类似唯一键做幂等。
- 同一笔成功通知重复到达时，不重复修改状态，不重复通知 Tilda，或者记录为重复事件。

### 10. 缺少测试

当前 `package.json` 只有：

- `dev`
- `build`
- `start`

建议增加测试覆盖：

- PricPay 签名
- Tilda 签名
- 两种创单 payload
- 普通创单跳转规则
- Cashier token 跳转规则
- 异步通知状态判断
- 重复通知幂等
- 同步返回跳转规则

## 推荐接口设计

### `POST /api/pricpay/create`

用途：处理 PricPay 普通创单接口。

流程：

1. 接收 Tilda 的 `POST` 请求。
2. 支持 `application/json` 和 `application/x-www-form-urlencoded`。
3. 记录 Tilda 入参日志。
4. 校验 Tilda 签名。
5. 归一化订单字段。
6. 写入或更新 `orders` 表。
7. 组装 PricPay `v2/checkout` 参数。
8. 生成 PricPay 签名。
9. 记录请求 PricPay 前的日志。
10. 请求 PricPay `v2/checkout`。
11. 保存 PricPay 响应。
12. 根据 `directFlag` 决定跳转链接。
13. 默认重定向买家到 PricPay 支付页。

测试模式：

- 如果请求头 `Accept: application/json`
- 或 URL 带 `?format=json`

则返回 JSON：

```json
{
  "ok": true,
  "orderId": "...",
  "pricpayOrderNo": "...",
  "redirectUrl": "..."
}
```

### `POST /api/pricpay/cashier`

用途：处理 PricPay Cashier/HPP 创单接口。

流程：

1. 与 `/create` 一样接收、校验和记录 Tilda 请求。
2. 写入或更新订单。
3. 组装 Cashier payload。
4. 移除 `mode`、`paymentMethodCode`、`pubId`。
5. 生成 PricPay 签名。
6. 请求 PricPay `cache-merchant-info`。
7. 保存返回的 cashier token。
8. 拼接跳转链接：

```text
https://cashier.pricpay.com?cashier=<token>
```

9. 默认重定向买家到 Cashier 页面。

测试模式返回：

```json
{
  "ok": true,
  "orderId": "...",
  "cashierToken": "...",
  "redirectUrl": "..."
}
```

### `GET /api/pricpay/return`

用途：处理支付完成后的浏览器同步跳转。

重要原则：

- 同步跳转只负责用户体验。
- 不用它作为订单是否支付成功的最终依据。
- 最终支付状态以 PricPay 异步通知为准。

流程：

1. 接收 PricPay return 参数。
2. 记录同步返回日志。
3. 根据 `orderNumber` 或 PricPay 订单号查找订单。
4. 如果能判断成功，跳转到 Tilda 成功页。
5. 如果能判断失败，跳转到 Tilda 失败页。
6. 如果状态未知或处理中，跳转到待确认页。

需要保存或配置：

- `tilda_success_url`
- `tilda_failure_url`
- `tilda_pending_url`

环境变量兜底：

```text
TILDA_SUCCESS_URL
TILDA_FAILURE_URL
TILDA_PENDING_URL
```

### `POST /api/pricpay/notify`

用途：处理 PricPay 异步通知。

流程：

1. 接收 `application/x-www-form-urlencoded`。
2. 记录原始回调日志。
3. 校验 PricPay 签名。
4. 根据 `orderNumber` 查找订单。
5. 写入 `payment_notifications`。
6. 更新订单状态。
7. 只有 `orderStatus=100` 时通知 Tilda 支付成功。
8. `orderStatus=120` 只记录失败。
9. `orderStatus=103` 只记录处理中。
10. 返回 PricPay 期望的成功响应。

如果 PricPay 文档没有严格规定响应 body，可以返回简单的 `OK` 和 HTTP 200。

## 同步跳转和异步回调的关系

这里必须分清楚两个概念。

### 同步跳转

同步跳转是买家浏览器跳回来的过程。

作用：

- 给买家展示支付结果。
- 跳回 Tilda 的成功页或失败页。

不应该做的事：

- 不应该仅凭同步跳转就把订单标记为已支付。

原因：

- 浏览器跳转可能被中断。
- 用户可能关闭页面。
- return 参数可能不完整。
- 真正可靠的是服务端异步通知。

### 异步回调

异步回调是 PricPay 服务端通知网关。

作用：

- 校验签名。
- 更新订单状态。
- 触发对 Tilda 的支付成功通知。

它应该是订单状态的最终来源。

推荐规则：

- `orderStatus=100`：订单支付成功，通知 Tilda。
- `orderStatus=120`：订单失败，记录失败，不通知 Tilda 成功。
- `orderStatus=103`：订单处理中，记录处理中，不通知 Tilda 成功。

## 日志和存储方案

### 为什么不能只用 Vercel 日志

Vercel 日志适合临时排查线上问题，但不适合作为支付系统长期审计记录。

支付网关至少需要能查：

- 某个 Tilda 订单是否发送到 PricPay。
- 发送给 PricPay 的参数是什么。
- 签名是否正确。
- PricPay 返回了什么。
- 买家被跳转到了哪个链接。
- PricPay 后续有没有回调。
- 回调签名是否正确。
- 是否通知了 Tilda。
- Tilda 响应了什么。

这些都应该进数据库。

### 推荐方案：Vercel + Neon Postgres

当前只有一个 Tilda 站点，预计单日数据不大。

推荐先使用：

```text
Vercel + Neon Postgres
```

原因：

- 成本低，适合早期验证。
- Neon 是托管 Postgres，不需要自己维护服务器。
- Postgres 适合保存订单、回调、幂等记录和审计日志。
- 和 Vercel 搭配比较自然。
- 后续如果量上来，也可以升级 Neon 或迁移到其他 Postgres。

需要注意：

- 免费方案适合早期验证和低流量。
- 如果开始承载真实收入订单，建议评估付费数据库方案、备份、监控和告警。

### 备选方案

#### Supabase Postgres

优点：

- 也是托管 Postgres。
- 管理后台成熟。
- 后续如果需要简单后台或认证能力，扩展方便。

缺点：

- 如果只做网关日志，功能可能略多。

#### Turso / LibSQL

优点：

- 轻量。
- 成本可能较低。

缺点：

- 对支付订单、回调、审计查询来说，Postgres 更常规。

#### 自购服务器 / VPS

优点：

- 控制力更强。
- 可以保存本地文件日志。
- 可以使用任意后端语言。

缺点：

- 需要维护系统安全、部署、备份、数据库、监控、证书和告警。
- 当前只有一个 Tilda 站点，过早上服务器会增加运维负担。

#### 换其他后端语言

可以考虑的场景：

- 后续订单量变大。
- 需要常驻进程或队列。
- 需要复杂后台管理。
- 需要更强的日志、风控或任务调度。

但当前阶段不建议马上换语言。先把支付流程跑通更重要。

## 推荐数据库表

### `orders`

保存订单主表。

```sql
id uuid primary key default gen_random_uuid(),
tilda_order_id text not null,
pricpay_order_no text,
creation_mode text not null, -- create | cashier
status text not null default 'created',
amount numeric(18, 8) not null,
currency text not null,
customer_email text,
tilda_notify_url text,
tilda_success_url text,
tilda_failure_url text,
tilda_pending_url text,
pricpay_redirect_url text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique(tilda_order_id)
```

### `gateway_events`

保存网关事件日志，建议只追加，不覆盖。

```sql
id uuid primary key default gen_random_uuid(),
order_id uuid references orders(id),
tilda_order_id text,
pricpay_order_no text,
event_type text not null,
direction text not null, -- inbound | outbound | internal
endpoint text,
http_method text,
status_code integer,
request_headers jsonb,
request_body jsonb,
response_body jsonb,
signature_base text,
signature_result text,
redirect_url text,
error_message text,
created_at timestamptz not null default now()
```

### `payment_notifications`

保存 PricPay 异步通知，并用于幂等。

```sql
id uuid primary key default gen_random_uuid(),
order_id uuid references orders(id),
platform_order_no text,
order_number text not null,
order_status text not null,
amount numeric(18, 8),
currency text,
signature text,
raw_body jsonb not null,
received_at timestamptz not null default now(),
unique(platform_order_no, order_status)
```

## 日志脱敏规则

应该记录：

- Tilda 订单号
- PricPay 订单号
- 金额和币种
- 请求接口
- 请求时间
- 脱敏后的请求体
- 脱敏后的响应体
- 签名前参数串
- 签名结果
- 跳转链接
- 回调状态
- 错误信息

不应该记录：

- `PRICPAY_SECRET`
- Tilda 支付密钥
- 完整银行卡信息
- 完整 token
- 不必要的个人信息
- 未脱敏的手机号

建议脱敏：

- 邮箱：如需客服排查可保存完整邮箱，否则保存脱敏邮箱。
- 手机号：中间位数脱敏。
- 密钥：统一替换为 `[REDACTED]`。
- 请求头：只保存 `content-type`、`user-agent`、请求 ID、IP 等必要字段。

## 建议实施阶段

### 第一阶段：先修接口行为

目标：让接口语义清晰，基础支付流程可测试。

任务：

1. 拆分普通创单和 Cashier 创单。
2. 新增 `/api/pricpay/cashier`。
3. 让创单成功后默认跳转到 PricPay，而不是只返回 JSON。
4. 增加 JSON 测试模式。
5. 新增 `/api/pricpay/return`。
6. 修复 `/api/pricpay/notify` 的状态判断。

限制：

- 如果没有数据库，这一阶段仍然无法可靠处理真实订单回调。

### 第二阶段：接入 Neon Postgres

目标：让订单状态和日志可追踪。

任务：

1. 添加数据库依赖。
2. 添加 SQL schema。
3. 实现订单仓储。
4. 实现网关日志写入。
5. 创单时保存 Tilda 通知地址、成功页、失败页。
6. PricPay 回调时从数据库查订单。
7. 实现回调幂等。

这是进入真实订单前建议完成的最低版本。

### 第三阶段：补测试和运维能力

目标：减少线上支付问题。

任务：

1. 增加 PricPay 签名单元测试。
2. 增加 Tilda 签名单元测试。
3. 增加创单跳转规则测试。
4. 增加回调状态处理测试。
5. 增加重复通知测试。
6. 增加简单的内部日志查询能力。
7. 更新 README，写清楚 Vercel 和 Neon 的配置步骤。

## 环境变量整理

当前已有变量可以保留：

```text
PRICPAY_MERCHANT_NO
PRICPAY_SECRET
PRICPAY_PUB_ID
PRICPAY_PAYMENT_METHOD
PRICPAY_MERCHANT_WEBSITE
TILDA_NOTIFY_URL
```

建议新增：

```text
DATABASE_URL
TILDA_ORDER_SECRET
TILDA_NOTIFY_SECRET
TILDA_SUCCESS_URL
TILDA_FAILURE_URL
TILDA_PENDING_URL
GATEWAY_DEFAULT_MODE=create
LOG_RAW_PAYLOADS=false
```

建议废弃或弱化：

```text
PRICPAY_MODE
```

原因：

- 以后由路由决定模式。
- `/api/pricpay/create` 走普通创单。
- `/api/pricpay/cashier` 走 Cashier/HPP。

## 最终建议

当前只有一个 Tilda 站点，建议路线是：

```text
继续使用 Next.js + Vercel。
新增 Neon Postgres 保存订单和日志。
拆分 /api/pricpay/create 与 /api/pricpay/cashier。
创单成功后由网关直接跳转 PricPay 支付页。
新增 /api/pricpay/return 处理买家同步跳转。
使用 PricPay 异步通知作为订单状态最终来源。
只有签名正确且 orderStatus=100 时才通知 Tilda 已支付。
```

暂时不建议马上买服务器或改用其他后端语言。

原因：

- 当前最大问题不是技术栈，而是支付流程、回调、签名和日志不完整。
- Vercel + Neon 足够支撑单站点低流量验证。
- 买服务器会引入额外运维成本。
- 等真实订单流程稳定后，再根据流量、成本、日志保留和运维要求决定是否迁移。
