# Tilda 自定义支付网关配置：按页面顺序填写

核对日期：2026-10-20。当前代码已适配客户字段优先级与 Tilda 订单时间，需部署后验证。店铺：`https://hoteltoiletries.ru/`。收款币种：`RUB`。接入方式：PricPay Cashier。

本文先列出尚待处理的问题，再从页面最上方开始逐项填写。已支持 firstName、customerCountry 优先取值，并将 orderTime 转为上游订单时间；真实 Tilda 参数传递仍需联调。

## 当前仍需处理或确认的问题

| 位置 | 最后确认的状态 | 现在要做什么 |
|---|---|---|
| Notify signature | 最后截图已选 Custom rules，但规则框仍是灰色示例，Use uppercase 未勾选 | 填写下面通知签名区块给出的完整规则，并勾选 Use uppercase；如果你已经改好，这项转为待实际通知验证 |
| 通知签名密钥 | 尚未确认 Tilda 实际验签密钥与 Vercel Production 的 TILDA_NOTIFY_SECRET 已一致 | 采用同一个实际值；使用独立通知密钥框时也填相同值 |
| 成功／失败页面 | 2026-10-20 上次检查两个目标地址均返回 404，尚未收到发布成功的确认 | 创建并发布 payment-success、payment-failed 两页，再打开网址确认 |
| 商户身份 | 截图商户号与本地一致，也与 PricPay 官方通知文档的示例商户号相同 | 确认它确实由 PricPay 分配给你；一致并不能证明账号权限有效 |
| Country | 你决定上方固定值保留 GB；已新增客户国家字段约定 | 确认真实 customerCountry 已传入并优先使用，未传时仍会兜底到旧 country |
| 地址数据 | 你已反馈完成配置；后端已适配，尚未验收实际动态传递 | 核对支付 POST 和上游 billing* 的真实值，不将变量名字符串当作客户数据 |
| Tilda 通知地址 | 只读且尚未看到生成后的实际地址，这是待确认项，不是手工填写错误 | 按平台流程保存配置后重新打开，读取生成的地址，并检查真实订单的 notifyUrl |

**以下项目不再列为错误：你已确认商品 Price 改为 `goodsPrice`；RUB 已确认正确；顶层字段名称、取消共用通知签名，以及 `paid=true`、`transactionid / Custom`、`OK / ERROR` 已按最新信息记录。** 后续若改动，以实际配置和真实请求为准。

## 1. 页面最上方：基础设置

这里填写实际值。它与后面 Mapping field list 填“参数名”不同。

| 页面字段 | 是什么 | 你要如何填写 | 当前状态或说明 |
|---|---|---|---|
| Login | 商户标识 | 复制你实际账户的 `PRICPAY_MERCHANT_NO` 值 | 不填环境变量名称本身；需确认不是复制官方示例账号 |
| Secret for order sign | Tilda 生成订单签名使用的密钥 | 可以使用已生成的独立 Tilda 密钥，取本地 `.env.tilda-signing.local` 等号后完整值 | 当前服务器尚未校验 Tilda 订单签名；填入密钥不会自动启用验证 |
| Notification URL | Tilda 接收支付通知的地址 | 这是只读项，保持系统管理，不手工填 | 保存后重新打开查看生成的地址，不填本网关 /notify 或 /return |
| Currency | 实际收款币种 | `RUB` | 你已确认，保留；还需 PricPay 实际商户支持 RUB |
| Country | 此支付配置的固定国家 | 按你的决定先保留 `GB` | 客户真实国家从 customerCountry 传入；后端只在无新国家字段时兜底到这里 |
| Payment widget language | 组件语言 | 面向俄罗斯买家建议 `RU` | 当前网关记录 language，不用它控制 PricPay 收银台语言 |

### 本次使用的密钥怎样对应

`.env.tilda-signing.local` 中的新密钥是随机生成的实际值；它保存在本地且受 Git 忽略保护，不在本文公开。

| 位置 | 要填写的值 |
|---|---|
| Tilda / Secret for order sign | 可以使用该文件等号后完整的新 Tilda 密钥 |
| Vercel Production / TILDA_NOTIFY_SECRET | 如果采用这把密钥签通知，也必须设置为相同值，然后重新部署 Production |
| Tilda / Secret for notification（如果显示独立输入框） | 同一个通知密钥值 |
| PRICPAY_SECRET | 保持 PricPay 商户密钥原有用途，不替换成新 Tilda 密钥 |

`{{secret}}` 是规则中的变量，不是要粘贴到密钥输入框的实际值。本地示例文件不会自动同步到 Vercel。

本地 `.env` 上次检查未设置 `TILDA_NOTIFY_SECRET`，代码会回退使用 `PRICPAY_SECRET` 签通知；线上值应在 Production 核对。只改 Tilda 而不对齐网关实际密钥，会导致通知验签不一致。

Notification URL 在保存后生成的操作可见 [Tap2Pay](https://tap2pay.me/how-to-integrate-tap2pay-with-tilda/)和 [PassimPay](https://passimpay.io/en/modules/tilda) 的 Tilda 对接说明。若当前新模板需要申请或审核，按 Tilda 实际流程完成后再读取，不手工拼接地址。

### 选择 RU 后出现的俄罗斯收据选项

| 页面字段 | 是什么 | 本项目当前状态 |
|---|---|---|
| Taxation for online receipt | 收据所用税制，例如 OSN | 不能仅凭默认值判定适用，按实际收据服务配置核对 |
| Online receipt / VAT | 商品收据的增值税设置 | 不因想减少设置就统一选择 VAT Free |
| VAT for delivery | 运费收据税项 | 同样应按实际配置核对 |
| FFD: method of payment calculation | 财政收据格式及计算方式 | 当前网关没有接入这段财政参数传递 |

当前 PricPay 请求没有发送这些税务／FFD 参数，也没有实现俄罗斯电子收据服务。保留 GB 不代替客户真实账单国家，也不解决电子收据接入。相关业务配置应依据实际接入服务核对，不能由本文替你选择税制。

## 2. Advanced settings → URL

| 页面字段 | 是什么 | 你要如何填写 | 说明 |
|---|---|---|---|
| API URL | Tilda 将订单 POST 到的入口 | `https://pricpay-tilda.vercel.app/api/pricpay/cashier` | 目前地址正确，保留 |
| 请求方法（若另有选项） | 发单方式 | `POST` | 正常为表单请求 |
| 调试参数 | 是否返回 JSON | 正式接入不添加 `?response=json` | 浏览器请求也不要强制 Accept: application/json，否则网关返回 JSON 而不跳转 |

成功创单后，网关给浏览器返回 303，跳转到 PricPay 收银台。

## 3. Fields → Mapping field list：顶层映射

左侧是 Tilda 数据来源，中间 Field 填“发送给我们网关的参数名”，右侧选择格式。例如 Amount 填 `amount`，网关才把它转换成 PricPay 的 `transactionAmount`。

| Tilda 左侧项目 | 中间 Field 填什么 | 右侧格式 | 当前项目用途 |
|---|---|---|---|
| Login | `login` | 无 | 保留原值供记录；PricPay 商户号仍从服务器环境变量读取 |
| Currency | `currency` | `USD/EUR/...` | 发给 PricPay 的 transactionCurrency；实际值来自上方 RUB |
| Language | `language` | `Upper case` | 保留语言原值 |
| Country | `country` | `Upper case` | 旧兼容兜底；customerCountry、billingCountry 优先 |
| Notification URL | `notifyUrl` | 无 | 保存 Tilda 实际通知目标，不直接作为 PricPay 通知 URL |
| Order number | `orderid` | `<project ID>:<order ID>` | 原样转成 PricPay 的 orderNumber |
| Order description | `description` | Max length 先留空 | 没传商品数组时用作默认商品名称 |
| Amount | `amount` | `In USD/EUR/...` | 以元为单位，例如 1490.00 RUB；不选 cents/分格式 |
| Order time | `orderTime` | `ISO-8601` | 将带时区的订单时间转为 UTC，生成上游 merchantOrderDate |
| Customer email | `email` | 无 | 转成 billingEmail |
| Customer phone | `phone` | `Unchanged` | 转成 billingTelephone，保留国家区号 |
| Customer name | `name` | `Name (or Full Name, if empty)` | 旧兼容备用；明确的 firstName、billingFirstName 优先，不自动拆分全名 |
| Signature | `signature` | 无 | Tilda 传签名；当前创单处理尚未校验 |
| Products | `products` | `Array in JSON` | 封装成 PricPay 的 productInformation，内部字段保持原名 |

以上顶层名称按最新信息可保留。不要把 `amount` 改成 `transactionAmount`，也不要把 `currency` 改成 `transactionCurrency`：当前对应取值函数不识别这两个上游名称。

账单国家取值优先级为 customerCountry → billingCountry → country。customerCountry 应来自客户真实国家，不能把站点固定国家视为每位客户的实际国家。

订单时间已使用 orderTime，要求带 Z 或 +03:00 等时区偏移、精确到秒，可带 1 至 3 位毫秒。例如 2026-10-20T10:15:30+03:00 转成 UTC 的 2026-10-20 07:15:30。无效日期或缺少时区返回 HTTP 400；未传或空值时兼容旧请求，使用服务器当前 UTC 时间。原始参数仍保存在订单日志中。

## 4. Products：商品内部映射

这里与顶层有区别：当前代码不会重命名商品内部字段，因此使用 PricPay 所需的名称。

| 商品内层项目 | Field 填什么 | 右侧格式 | 当前状态或用途 |
|---|---|---|---|
| Order number | 留空 | 不需要设置 | 商品行编号，不是顶层订单号 |
| Name | `goodsName` | Max length 先留空 | 商品名称 |
| Quantity | `quantity` | 无 | 商品数量 |
| Price | `goodsPrice` | `In USD/EUR/...` | **你已确认修正，保持，不再作为错误项**；表示商品单价 |
| Full Amount | 留空 | 不需要设置 | 不额外映射商品行总额 |
| Image | `productShowUrl` | 无 | 商品图片完整网址 |

预期商品结构如下，示例值不需要粘贴进 Field 输入框：

```json
[
  {
    "goodsName": "Demo product",
    "goodsPrice": 1490,
    "quantity": 1,
    "productShowUrl": "https://shop.example.com/product.jpg"
  }
]
```

PricPay 示例还包含 `productUrl`、`productCategory`；当前截图没有对应动态来源，不虚构配置入口。若实际收款渠道要求它们，需要确认模板或后续适配。

## 5. 商品下方：运费和折扣

| 页面选项 | 是什么 | 你要如何选择 | 说明 |
|---|---|---|---|
| Add delivery to products list | 将运费列入商品列表 | 无运费时不勾；需要体现运费时勾选 | 用有运费订单核对总额，避免重复计算 |
| Use discount price for products | 使用折扣后的商品价格 | 使用折扣时勾选 | 截图中已勾选；用折扣订单核对最终单价 |
| Use discount price if FFD array | FFD 数组折扣设置 | 本方案采用 JSON 数组，可保持不勾 | 不代替上一项 |

当前代码不会重新分摊折扣或计算商品总额。含运费、折扣的实际输出需要在联调中核对。

## 6. Additional field list：返回页面

字段名必须是 `successUrl`，不是 `successl`。你提供的真实店铺域名已用于下面地址。

| 添加的 Field | Value 填什么 | 当前状态 |
|---|---|---|
| `successUrl` | `https://hoteltoiletries.ru/payment-success` | 上次检查为 404，需要创建并发布 |
| `failUrl` | `https://hoteltoiletries.ru/payment-failed` | 上次检查为 404，需要创建并发布 |
| `pendingUrl` | `https://hoteltoiletries.ru/payment-pending` | 可选；未检查，不添加此字段就无需创建 |

在 Tilda 创建成功页，将页面路径设为 `payment-success` 并发布；创建失败页，将路径设为 `payment-failed` 并发布。分别直接打开两个网址，确认可访问后再作为实际返回地址使用。填 URL 本身不会创建页面。

已准备可直接放入 T123 的俄文模板：[成功返回页 HTML](tilda-pages/payment-success.html)、[失败返回页 HTML](tilda-pages/payment-failed.html)。新建空白页面，设置上述路径，添加 Other → T123，把对应 HTML 全部放入代码框后发布即可。[完整建页步骤](tilda-pages/README.zh-CN.md)包含标题和发布后检查。

这些文件目前只在本地准备，没有自动发布到 Tilda。浏览器工具禁止 file:// 预览，尚未做浏览器视觉检查，发布后需要确认实际显示。

不要将本网关的 `/api/pricpay/return` 填成成功页，网关会先处理该返回请求，再跳到你的店铺页面。页面展示不能单独证明已经收款。

| 其他设置 | 如何处理 |
|---|---|
| `firstName`、`lastName`、`customerCountry`、`state`、`city`、`address`、`zip` | 后端已支持这些参数；Additional 动态源字段绑定仍需实际 POST 确认，不填只有键的项目或同名固定字符串 |
| 已有 URL 环境变量 | 若用 TILDA_SUCCESS_URL、TILDA_FAILURE_URL、TILDA_PENDING_URL 兜底，可不重复传对应页面参数；订单参数优先 |

在 ST100 → Content → Input fields 中，按以下约定收集客户数据；约定发给本网关的参数名与表单 Variable name 一致：

| 输入框标题示例 | 建议表单 Variable name | Value 的实际来源 |
|---|---|---|
| Имя（名） | `firstName` | 买家填写的名，优先于旧 name |
| Фамилия（姓） | `lastName` | 买家填写的姓 |
| Страна（国家） | `customerCountry` | 买家实际国家的两位代码，如 RU，优先于固定 country |
| Регион / область（地区） | `state` | 买家填写或选择的地区 |
| Город（城市） | `city` | 买家填写的城市 |
| Улица, дом, квартира（详细地址） | `address` | 买家填写的街道、门牌、房间 |
| Почтовый индекс（邮编） | `zip` | 买家填写的邮编字符串 |

姓名按 firstName、lastName 分开收集；邮箱和电话已有 email、phone 映射时不重复添加。发货订单应按实际物流要求将城市、详细地址、邮编等设置为必填。表单采集与发送到支付网关是两步：发布后既要在 Tilda 订单中看到这些值，也要确认 `/api/pricpay/cashier` 的实际 POST 含真实值。仅给表单变量命名，不保证自定义网关会自动收到所有自定义字段。

目前没有验证该 Additional 的 Value 支持任意购物车动态变量，因此不要直接填写 `{{city}}`。如果实际支付请求没有地址字段，需要补传递适配；当前项目也没有专用的完整 Tilda 表单接收接口。[地址采集与传递说明](tilda-customer-address-setup.zh-CN.md)列出具体步骤和仍未验收的链路。

不要在附加字段中发送 PricPay 密钥、数据库连接串或健康检查令牌。

## 7. Order signature：订单签名

这是 Tilda → 网关的方向。本轮不修改入站验签代码，下表区分可保留的页面设置与实际后端能力。

| 页面项目 | 是什么 | 本轮填写或选择 | 说明 |
|---|---|---|---|
| Signature rules | 参与签名的字段规则 | `All fields` | 当前订单侧基线 |
| Excluding fields | 排除字段 | `signature` | 填字段名，不填签名值 |
| Do not use fields with empty values for signature | 跳过空值 | 勾选 | 保留 |
| Fields order | 字段排序 | `Alpha, asc` | 保留 |
| Divider | 字段值分隔符 | 本轮保持空白 | 当前服务器不验证该订单摘要 |
| Add secret in signature | 是否额外加入密钥 | 本轮保持截图的 `No` | 不作为通知签名规则使用 |
| Signature algorithm | 摘要算法 | `MD5` | 保留 |
| Use secret as algorithm key (HMAC) | 使用 HMAC | 不勾选 | 保留 |
| Use uppercase | 摘要大写 | 订单侧本轮保持不勾选 | 后面通知侧使用不同配置 |
| Encode result signature in base64 | Base64 编码 | 不勾选 | 保留 |

这些值只能说明 Tilda 如何生成订单摘要，不能证明服务端已验证。当前创单入口没有校验 Tilda 订单签名；无密钥摘要也不能用于正式鉴权。该缺口本轮只记录，后续再确定完整规则并实现校验。

## 8. Same for notify signature

| 页面选项 | 是什么 | 你要如何选择 | 当前状态 |
|---|---|---|---|
| Same for notify signature | 通知是否沿用订单签名规则 | **不勾选** | 你已取消，保持 |

订单签名和通知签名是两个方向，接下来单独配置 Notify signature。

## 9. Notify signature：通知签名

这是网关 → Tilda 的方向。务必在 **Notify signature** 区块配置，不能只修改上面的 Order signature。你最新截图已确认占位符语法。

| 页面项目 | 是什么 | 你要如何填写或选择 |
|---|---|---|
| Signature rules | 通知签名规则类型 | `Custom rules` |
| Custom signature rules | 通知字段拼接模板 | 粘贴下方完整一行 |
| Signature algorithm | 摘要算法 | `MD5` |
| Use secret as algorithm key (HMAC) | 是否使用 HMAC | 不勾选 |
| Use uppercase | 摘要是否大写 | **勾选** |
| Encode result signature in base64 | 是否 Base64 编码 | 不勾选 |

Custom signature rules：

```text
amount={{amount}}&orderid={{orderid}}&paid={{paid}}&transactionid={{transactionid}}&secret={{secret}}
```

保持一行，不加引号、空格或换行。不要把真实密钥直接替换到模板中，保留 `{{secret}}`；Tilda 会读取通知规则使用的实际密钥。

如果切换后仍显示 Divider / Add secret，不再做额外拼接：模板已包含全部分隔符和 `&secret=`，不要重复追加密钥。

模板只引用四个通知字段，不包含 `signature` 和 `target`，因此不再依靠 All fields 的排除选项。通知验签实际使用的密钥必须与网关一致；共用主密钥或使用独立通知密钥框时都遵守这一点。

本地已用 `19.90`、`1490.00`、`1490.00000000`、`0.01` 四种金额字符串比对，结果均与当前网关代码一致。示例使用虚构密钥 `TILDA_DEMO_SECRET`：

```text
amount=19.90&orderid=12345:10001&paid=true&transactionid=TX-DEMO-001&secret=TILDA_DEMO_SECRET
```

对应 MD5 大写结果：

```text
C20699714DE7CE1E88F2E52D66060C69
```

不要在计算时将金额原字符串 `19.90` 改成 `19.9`。固定模板要求真实通知包含非空交易流水号；PricPay 官方将平台流水号标为必填。本地模板比对不等于已完成真实 Tilda 服务器验签。

## 10. Notification：成功标识和应答

| 页面项目 | 是什么 | 你要如何填写或选择 | 当前状态 |
|---|---|---|---|
| Successful payment indicator / Field | 判断支付成功的字段名 | `paid` | 正确，保留 |
| Successful payment indicator / Value | 支付成功值 | `true` | 正确，保留 |
| Transaction ID / Field | 交易流水号参数名 | `transactionid` | 正确，保留 |
| Transaction ID / 类型 | 流水号类型 | `Custom` | 已选择，保留并在联调核对字母数字流水号 |
| Notify success answer | 正常接收通知后的应答 | `OK` | 大写，保留 |
| Notify error answer | 通知处理错误时的应答 | `ERROR` | 大写，保留 |
| Answers for notify as json | 用 JSON 包装应答 | 不勾选 | 保持纯文本 |

Tilda 返回的 `OK` 是对本网关的应答；本网关对 PricPay 的通常应答为小写 `ok`，这是另一段请求。

当前网关仅在 PricPay 通知验签成功且状态为 `100` 时尝试通知 Tilda。`transactionid` 来源于 PricPay 的平台订单号，不能按纯整数截断。

## 11. Form settings：管理员看到的标签和提示

这些项目只改界面文案，不改接口参数名。Russian 不使用时可保留原文；English 可按下面填写。

| 页面项目 | 是什么 | 如何填写或选择 |
|---|---|---|
| "LOGIN" field title / English | Login 的显示标题 | `Merchant ID`；保留原来的 Login 也可以 |
| "LOGIN" field title / Russian | 俄文标题 | 保留现有文案 |
| "LOGIN" field hint / English（若显示） | Login 下方提示 | `Merchant number configured for this gateway.` |
| "SECRET FOR ORDER SIGN" field title（若显示） | 订单密钥标题 | English 可填 `Tilda order signing secret`；Russian 可保留 |
| Show field "Secret for notification"（若显示） | 是否显示独立通知密钥框 | **不是必勾项**；需要单独输入通知密钥才勾选 |
| "NOTIFICATION URL" field title（若显示） | 通知地址标题 | English 可填 `Tilda payment notification URL` |
| "NOTIFICATION URL" field hint（若显示） | 通知地址提示 | English 可填 `Tilda URL that receives payment status notifications.` |

不显示独立密钥框，不代表通知无需密钥。采用共用主密钥时，要确认 Tilda 实际验签用的主密钥与 Vercel `TILDA_NOTIFY_SECRET` 一致；显示独立通知密钥框时，也填写同一个实际通知密钥值。

Show field 控制密钥输入框显示，Same for notify signature 控制签名规则共用，两者不要混淆。

## 12. Support：客服和帮助链接

| 页面项目 | 是什么 | 如何填写 |
|---|---|---|
| Support email / Russian | 俄语客服邮箱 | 有真实邮箱就填写；可选且不用时留空 |
| Support email / English | 英语客服邮箱 | 有真实邮箱就填写；可选且不用时留空 |
| Feedback URL / Russian | 俄语联系页 | 填真实已发布联系页；可选且没有时留空 |
| Feedback URL / English | 英语联系页 | 同上 |
| Help docs URL / Russian | 俄语使用说明 | 填真实可公开访问的文档网址；可选且没有时留空 |
| Help docs URL / English | 英语使用说明 | 同上 |

截图里的 gringotts 等灰色提示若只是占位符，不需要复制；若已存成实际值，应改为自己的信息或清空。

## 13. Region：模板展示国家

| 页面项目 | 是什么 | 如何选择 |
|---|---|---|
| Display only for countries | 仅在哪些国家显示模板 | 没有明确展示限制时留空 |
| Hide for countries | 在哪些国家隐藏模板 | 没有明确展示限制时留空；避免与上一项冲突 |

这两个选项控制模板展示，不等于 PricPay 商户收款国家权限，也不代替客户账单国家。

## 14. Publishing the template、Title 和按钮

| 页面项目 | 是什么 | 如何填写或操作 |
|---|---|---|
| Publishing the template | 公开模板发布说明 | 完成联调后，再按 Tilda 流程申请公开；页面说明需要审核 |
| Title | 购物车里显示的支付方式名称 | `PricPay`；当前 Pricpay 只是大小写差异，不是接口错误 |
| Add | 添加或提交当前集成 | 完成配置后按页面声明操作；当前页面说明它涉及新集成申请 |
| Close | 关闭窗口 | 不把它当作提交配置按钮 |

按平台流程保存后重新打开，查看生成的 Notification URL。配置可用于继续联调，但不能仅凭保存成功认定已达到正式收款条件。

## 15. 保存后按顺序验证

1. 创建并发布两个返回页，直接访问成功页和失败页，确认不再返回 404。
2. 核对 Vercel Production 的 `TILDA_NOTIFY_SECRET` 与 Tilda 实际通知密钥一致，变量修改后重新部署 Production。
3. 在 Tilda 保存配置后重新打开，读取实际 Notification URL。
4. 用测试商户从 Tilda 发起测试订单，检查 POST 参数及 `notifyUrl` 非空。
5. 检查 `products` 内部包含 `goodsName`、`goodsPrice`、`quantity`，金额和币种为本次订单实际值。
6. 完成测试支付，确认 PricPay 异步通知验签成功，Tilda 后台订单也实际标为已支付。
7. 查看 Tilda 通知响应状态和正文，不能只依据一次跳转或一条 forwarded 日志判断成功。

当前实现仍有两个已记录限制：Tilda 订单入站签名尚未验证；转发通知后未核验 Tilda 的 HTTP 成功状态或 `OK` 正文。后者导致 `tilda.notify.forwarded`、`forwardedToTilda: true` 只能证明发出请求并收到响应。本轮只改配置文档，不将这些限制写成已经修复。

## 附录：服务器配置和核对依据

这些是服务器侧参考，不属于 Tilda 页面中途需要跳转填写的章节。

| 环境变量 | 配置要求 |
|---|---|
| DATABASE_URL | 现有 Neon pooled 连接串 |
| DATABASE_URL_UNPOOLED | 现有 Neon 直连串，供建表等管理操作使用 |
| PRICPAY_MERCHANT_NO / PRICPAY_SECRET | PricPay 实际商户号和配套密钥 |
| PRICPAY_MERCHANT_WEBSITE | 核对实际商户网站，对应 PricPay 的 merchantWebsite |
| GATEWAY_HEALTH_TOKEN | 现有健康检查令牌 |
| GATEWAY_DB_TIMEOUT_MS | 当前联调建议显式设 10000；代码默认仍为 1000 |
| TILDA_NOTIFY_SECRET | 与 Tilda 实际通知验签密钥相同 |
| TILDA_NOTIFY_URL | 可选兜底；真实订单的 notifyUrl 优先 |
| TILDA_SUCCESS_URL / TILDA_FAILURE_URL / TILDA_PENDING_URL | 对应店铺返回页的可选兜底 |

仅使用 Cashier 时不需要 PRICPAY_MODE、PRICPAY_CREATE_MODE、PRICPAY_PAYMENT_METHOD、PRICPAY_PUB_ID。

健康检查地址为 `/api/neon/health?details=1`，用现有令牌通过 Authorization: Bearer 或 token 查询参数鉴权。它会写一条日志；成功不代表已验证实际支付。

| 健康检查结果 | 含义 |
|---|---|
| ok: true，service: neon-postgres | 本次健康日志写入完成；details 会另读计数 |
| 当前健康路由返回 HTTP 404、Not found | 鉴权未通过，还未检查数据库 |
| Gateway log write timed out after 1000ms | 数据库操作超过当前时限，首次调用还含 schema 检查 |
| DATABASE_URL is not configured | 当前实例未读取到数据库地址 |

代码依据：

- [字段转换、商品封装、通知签名](../lib/pricpay.ts)。
- [创单入口及原始订单记录](../lib/pricpay-create-handler.ts)。
- [PricPay 通知验证与转发](../app/api/pricpay/notify/route.ts)。
- [健康检查](../app/api/neon/health/route.ts)。

外部依据：

- [Tilda 自定义支付网关](https://help.tilda.cc/payments/custom-payment-gateway)。
- [PricPay Cashier](https://www.pricpay.com/api/cashier.html)。
- [PricPay 签名](https://www.pricpay.com/api/signature.html)。
- [PricPay 异步通知](https://www.pricpay.com/api/notify.html)。
- [Vercel 环境变量](https://vercel.com/docs/environment-variables)。
- [Tap2Pay 的 Tilda 对接说明](https://tap2pay.me/how-to-integrate-tap2pay-with-tilda/)：保存后生成通知地址及自定义字段占位符示例。
- [PassimPay 的 Tilda 对接说明](https://passimpay.io/en/modules/tilda)：独立通知签名区块和保存后读取通知地址。
