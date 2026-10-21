# Tilda 对接 PricPay Cashier 指南

完整的逐项配置请阅读 [Tilda 自定义支付网关设置](tilda-custom-payment-gateway-settings.zh-CN.md)。该文档覆盖字段映射、商品内部字段、运费折扣、订单签名和支付结果通知，并说明尚未实现的 Tilda 订单入站验签。

客户字段实测不能通过 Additional 的同名固定值读取。现在需要安装 [客户数据 T123 脚本](tilda-customer-data-install.zh-CN.md)，删除七组固定客户字段；Cashier 会在创单前按订单 ID/token 读取真实数据，缺少脚本或数据时不继续创单。

## 推荐链路

当前推荐使用 PricPay 收银台接口：

```text
POST https://pricpay-tilda.vercel.app/api/pricpay/cashier
```

该接口会把 Tilda 订单转成 PricPay `cache-merchant-info` 请求。成功后，浏览器会收到 `303` 跳转并进入 PricPay cashier：

```text
https://cashier.pricpay.com?cashier=...
```

调试时可以请求：

```text
POST https://pricpay-tilda.vercel.app/api/pricpay/cashier?response=json
```

这样不会跳转，而是返回 JSON：

```json
{
  "ok": true,
  "orderNo": "TILDA-10001",
  "target": "https://cashier.pricpay.com?cashier=...",
  "redirectUrl": "https://cashier.pricpay.com?cashier=..."
}
```

## Vercel 环境变量

先在 Vercel Project Settings -> Environment Variables 配置：

```text
DATABASE_URL=Neon pooled connection string
DATABASE_URL_UNPOOLED=Neon unpooled connection string
PRICPAY_MERCHANT_NO=PricPay merchantNo
PRICPAY_SECRET=PricPay signature secret
PRICPAY_MERCHANT_WEBSITE=https://pricpay-tilda.vercel.app
GATEWAY_HEALTH_TOKEN=自定义健康检查令牌
```

Cashier 模式不需要 `PRICPAY_PUB_ID`。如果之后也要启用普通 `/api/pricpay/create`，再补：

```text
PRICPAY_PUB_ID=PricPay pubId
PRICPAY_CREATE_MODE=EPP
PRICPAY_PAYMENT_METHOD=CardEmbed
```

可选兜底 URL：

```text
TILDA_NOTIFY_URL=Tilda 后台生成的通知 URL
TILDA_SUCCESS_URL=https://你的站点/success
TILDA_FAILURE_URL=https://你的站点/fail
TILDA_PENDING_URL=https://你的站点/pending
TILDA_NOTIFY_SECRET=Tilda 通知签名密钥
GATEWAY_DB_TIMEOUT_MS=10000
```

这里的 10000 是当前联调的显式配置建议；代码默认仍为 1000。首次数据库调用包含 schema 检查，不能把一次超时直接等同于连接串错误。

## Tilda 自定义支付网关配置

在 Tilda 后台进入：

```text
Site Settings -> Payment Systems -> Custom Payment Gateway
```

如果你的账户只能选择已审核模板，需要把本项目的接口说明发给 Tilda 或支付服务开发方申请模板；Tilda 文档说明，没有现成模板时需要支付方案开发者参与创建模板。

如果后台允许手动配置高级参数，按下面设置。

## API URL

```text
https://pricpay-tilda.vercel.app/api/pricpay/cashier
```

请求方法：

```text
POST
```

## 字段映射

建议把 Tilda 字段映射成下面这些名字。代码已兼容部分别名，但保持这些字段名最稳。

必填：

```text
orderid      Tilda 订单号
amount       订单金额
currency     实际收款货币，本店为 RUB
email        客户邮箱
```

建议补充：

```text
firstName    名，优先于旧 name
lastName     姓
phone        电话
customerCountry 客户实际国家，两位代码，优先于固定 country
state        州/省
city         城市
address      地址
zip          邮编
orderTime    Tilda 订单时间，带时区的 ISO-8601 格式
```

购物车变量名与上面参数名统一，不使用全小写 firstname、lastname，也不自动拆分 fullname。通过 T123 将客户字段先传给客户数据接口，付款 POST 携带 customerDataToken；后端按项目 ID:订单号和 token 合并真实 firstName 等字段。已有顶层姓名映射 name 可保留作原始记录，不能再往 Additional 填 firstName=firstName 等固定文字。

订单时间使用 Tilda 的 orderTime，转成 UTC 的 YYYY-MM-DD HH:mm:ss 后发给 PricPay；无效时间返回 400，未传时才使用服务器时间兜底。地址字段映射到 PricPay billing*，配送与账单地址不同的订单不能直接复用。

回调和跳转：

```text
notifyUrl    Tilda 支付通知 URL
successUrl   Tilda 支付成功页
failUrl      Tilda 支付失败页
pendingUrl   Tilda 支付处理中页，可选
```

商品信息：

```text
productInformation
```

如果 Tilda 传的是 `products` 或 `items`，网关会将外层封装为 PricPay 的 `productInformation`，但不会重命名商品内部字段。Tilda 商品内部应映射为 `goodsName`、`goodsPrice`、`quantity`；JSON 字符串会原样透传。

## 签名设置

当前代码尚未校验 Tilda 发给本项目的订单签名。这是正式接入前需要补齐的缺口，不能把 PricPay 密钥保存在服务端视为可以省略 Tilda 入站验签的理由。已有的签名验证用于 PricPay 异步通知：

```text
按字段名排序 -> 去掉空值 -> key=value& 拼接 -> 追加 secret=密钥 -> MD5 大写
```

`TILDA_NOTIFY_SECRET` 用于网关发回 Tilda 的通知签名，不会启用订单入站验签。通知验签规则须与 `toTildaNotification` 一致；当前通知额外携带未签入的 `target`，应在 Tilda 通知验签中排除它和 `signature`。具体规则及可复核示例见完整逐项配置文档。

## PricPay 后台回调地址

PricPay 创单时网关会自动传：

```text
notifyUrl=https://pricpay-tilda.vercel.app/api/pricpay/notify?order=...
returnUrl=https://pricpay-tilda.vercel.app/api/pricpay/return?order=...
```

一般不需要在 PricPay 后台手动覆盖。异步通知以 orderStatus=100 作为成功状态；网关先验证原始签名，再按数据库原订单核对金额和币种。回调 amount 默认按最小货币单位转换（RUB 分转卢布），创单金额不变；只有 Tilda 接受通知后才对 PricPay 返回：

```text
ok
```

Tilda 必须返回 HTTP 2xx 且正文为 OK，才能记录 forwardedToTilda=true。即使 HTTP 200，正文为 Signature not correct. 也会记录 tilda.notify.rejected、订单 tilda_notify_error，并返回 502，保留上游重试机会。重试成功会清除旧错误。原订单不可用或缺少 Tilda 通知地址返回 503，金额／币种不符返回 400，无效签名返回 401 且不修改订单状态。

回调 amount 的单位可用 PRICPAY_NOTIFY_AMOUNT_UNIT=minor（默认）或 major 显式配置；当前 RUB 通道无需额外设置。major 仅在 PricPay 确认该商户回调 amount 已用主单位时使用。Tilda 后台显示的是原订单金额，不能用它判断实际通知中 amount 的单位。

## 上线验证

部署后按顺序检查：

1. 打开健康检查：

```text
https://pricpay-tilda.vercel.app/api/neon/health?details=1&token=你的 GATEWAY_HEALTH_TOKEN
```

预期返回：

```json
{
  "ok": true,
  "service": "neon-postgres",
  "counts": {
    "orders": 0,
    "events": 0,
    "notifications": 0
  }
}
```

2. 用 PricPay 测试商户在 Tilda 下单。

3. 用户应跳转到 PricPay cashier。

4. 支付完成后，用户应被 `/api/pricpay/return` 带回 Tilda 成功/失败/处理中页面。

5. PricPay 异步通知应进入 `/api/pricpay/notify`，并在 Neon 里写入：

```text
gateway_orders
gateway_events
payment_notifications
```

6. Tilda 订单应在收到正确通知后标记为已支付。

## 排查方式

看 Vercel 日志：

```text
Gateway log write failed
Gateway order upsert failed
Payment notification write failed
```

普通日志写入失败时，支付主流程仍会继续。客户数据保存和读取则是创单必需步骤，失败返回 503／504，不再带缺失地址继续创单。

看 Neon 表：

```sql
select * from gateway_orders order by created_at desc limit 20;
select * from gateway_events order by created_at desc limit 50;
select * from payment_notifications order by created_at desc limit 20;
```

常见状态：

```text
redirect_created              已生成 PricPay 跳转
paid                          PricPay 通知支付成功
pending                       PricPay 通知处理中
failed                        PricPay 通知失败
notify_amount_mismatch        PricPay 回调金额或币种不符，停止转发
paid_tilda_notify_missing     支付成功但缺少 Tilda notifyUrl
tilda_notify_error            转发 Tilda 通知失败
configuration_error           Vercel 环境变量缺失
```

## 仍需实测的地方

本地与隔离数据库可验证客户字段、金额换算、签名以及 Tilda 拒绝／重试应答。真实 cashier 创单、支付和 Tilda 通知验签闭环仍须实际联调确认。新代码中的 tilda.notify.forwarded 要求 HTTP 2xx 加 OK 正文；旧代码产生的同名记录没有这一保证，应查看当时的实际响应及 Tilda 订单状态。

正式上线前至少跑一笔 PricPay 测试支付，并确认：

```text
Tilda 下单 -> PricPay cashier -> 支付完成 -> Tilda 成功页 -> Tilda 订单已支付 -> Neon 三张表有完整日志
```
