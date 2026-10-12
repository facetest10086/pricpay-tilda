# Tilda PricPay 支付网关

这是一个**纯后端支付网关**，没有前端页面。它接收 Tilda 的订单数据，调用 PricPay 创单接口，并把支付跳转地址返回给 Tilda。

## 接口

### 1. 创建订单

```text
POST /api/pricpay/create
Content-Type: application/json
```

请求体至少包含：

```json
{
  "orderid": "TILDA-10001",
  "amount": "38.59",
  "currency": "USD",
  "email": "customer@example.com",
  "name": "John Doe"
}
```

也支持 `application/x-www-form-urlencoded`。金额、订单号和邮箱会映射到 PricPay 参数；`products`、`items` 或 `productInformation` 可用于传递商品信息。

成功响应：

```json
{
  "ok": true,
  "orderNo": "TX...",
  "target": "https://...",
  "redirectUrl": "https://..."
}
```

让 Tilda 将用户重定向到 `redirectUrl`（或 `target`）。`target` 已按 PricPay 文档处理 `directFlag`。

### 2. PricPay 异步通知

PricPay 通知地址固定为：

```text
https://你的域名/api/pricpay/notify
```

网关会校验 PricPay MD5 签名，然后把 `paid=true`、订单号和金额以表单 POST 转发到 Tilda 的 `notifyUrl`。在创建订单时传入 `notifyUrl`，或配置 `TILDA_NOTIFY_URL`。

## 环境变量

在 Vercel 项目 Settings → Vars 中配置：

```text
PRICPAY_MERCHANT_NO=你的 merchantNo
PRICPAY_SECRET=你的签名密钥
PRICPAY_PUB_ID=你的 pubId
PRICPAY_MODE=EPP
PRICPAY_PAYMENT_METHOD=CardEmbed
PRICPAY_MERCHANT_WEBSITE=https://你的网关域名
TILDA_NOTIFY_URL=https://你的Tilda通知地址
```

其中 `PRICPAY_SECRET` 只保存在服务端，不能暴露给 Tilda 或浏览器。

## Tilda 配置步骤

1. 将本项目部署到 Vercel，并绑定自己的域名。
2. 在 Tilda 的支付设置中选择自定义支付方式/自定义支付网关。
3. 将订单创建请求指向 `https://你的域名/api/pricpay/create`。
4. 将订单 JSON 字段映射为 `orderid`、`amount`、`currency`、`email` 等字段。
5. 将 PricPay 异步通知地址设置为 `https://你的域名/api/pricpay/notify`，并确保 Tilda 的通知地址能通过 `notifyUrl` 传入或通过 `TILDA_NOTIFY_URL` 配置。
6. Tilda 收到响应后跳转到 `redirectUrl`。

## 注意事项

- Tilda 的自定义网关字段名和回调协议可能因账户/套餐不同；如果 Tilda 要求特定响应字段，只需在 `app/api/pricpay/create/route.ts` 中调整响应结构。
- 不要把 PricPay 密钥写入 Tilda 前端代码。
- 正式使用前请用 PricPay 测试商户号验证创单、异步通知和重复通知场景。

## 本地验证

启动项目后检查：

```text
GET http://localhost:3000/api/pricpay/create
```

应返回网关服务信息。创建支付必须先配置上述环境变量。
