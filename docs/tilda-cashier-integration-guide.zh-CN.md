# Tilda 对接 PricPay Cashier 指南

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
GATEWAY_DB_TIMEOUT_MS=1000
```

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
currency     货币，建议 USD
email        客户邮箱
```

建议补充：

```text
name         名
lastName     姓
phone        电话
country      国家代码
state        州/省
city         城市
address      地址
zip          邮编
```

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

如果 Tilda 传的是 `products` 或 `items` 数组，网关也会转换成 PricPay 的 `productInformation`。

## 签名设置

Tilda 发给本项目的创单请求可以先不强制校验签名，因为 PricPay 密钥只在服务端使用，不暴露给 Tilda。真正需要严格校验的是 PricPay 回调签名，代码会按 PricPay 文档进行 MD5 校验：

```text
按字段名排序 -> 去掉空值 -> key=value& 拼接 -> 追加 secret=密钥 -> MD5 大写
```

如果你在 Tilda 模板里启用了订单签名，请设置 `TILDA_NOTIFY_SECRET`，并保持 Tilda 后台的通知签名规则与项目内 `toTildaNotification` 生成的字段一致。

## PricPay 后台回调地址

PricPay 创单时网关会自动传：

```text
notifyUrl=https://pricpay-tilda.vercel.app/api/pricpay/notify?order=...
returnUrl=https://pricpay-tilda.vercel.app/api/pricpay/return?order=...
```

一般不需要在 PricPay 后台手动覆盖。异步通知以 `orderStatus=100` 作为成功状态，网关收到后会通知 Tilda，并对 PricPay 返回：

```text
ok
```

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

如果只看到这些日志，通常是 Neon 连接短暂超时；支付主流程会继续。

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
invalid_notify_signature      PricPay 通知签名不正确
paid_tilda_notify_missing     支付成功但缺少 Tilda notifyUrl
tilda_notify_error            转发 Tilda 通知失败
configuration_error           Vercel 环境变量缺失
```

## 仍需实测的地方

本地已经验证 Next.js 路由、构建、Neon 表结构、日志容错和通知 `ok` 响应。但没有 PricPay 测试商户密钥时，无法完成真实创单、真实 cashier 跳转和真实异步通知签名闭环。

正式上线前至少跑一笔 PricPay 测试支付，并确认：

```text
Tilda 下单 -> PricPay cashier -> 支付完成 -> Tilda 成功页 -> Tilda 订单已支付 -> Neon 三张表有完整日志
```
