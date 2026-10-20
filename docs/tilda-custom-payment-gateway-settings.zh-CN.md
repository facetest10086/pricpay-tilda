# Tilda 独立站自定义支付网关逐项配置

核对日期：2026-10-20。代码基线：`2dfca40`。适用接口：本项目的 PricPay Cashier。

本文按实际代码和用户提供的界面截图说明配置，供模板配置和联调使用。已验证本地字段转换及通知签名示例；未验证真实 Tilda 模板生成的请求、PricPay 实际支付或 Tilda 通知验签。

本轮只完成 Tilda 页面配置说明。订单时间优先取订单原值、入站验签及通知应答判定等代码调整留待后续，不在本轮修改。

### 按整页截图操作的顺序

| 页面位置 | 本文位置 | 要做什么 |
|---|---|---|
| 最上方 Login、Secret、Notification URL、Currency、Country、Language | 第 6 节 | 填实际值或选择实际币种、国家、语言 |
| Advanced settings / API URL | 第 1 节 | 设置 Cashier 入口 |
| Mapping field list | 第 3 节 | 填顶层参数名和格式 |
| Products 内层 | 第 4 节 | 填商品参数名，Price 使用 `goodsPrice` |
| 运费、折扣勾选项 | 第 4 节 | 按实际订单设置 |
| Additional field list | 第 5 节 | 添加店铺成功、失败、处理中页面 |
| Order signature / Divider / Add secret / Algorithm | 第 7 节 | 本轮保留订单侧生成配置，并记录服务端尚不验证 |
| Same for notify signature | 第 9 节 | 取消共用，单独核对通知签名 |
| Notification | 第 8 节 | 设置成功标识、流水号、成功及失败应答 |
| Form settings | 第 9 节后的“表单显示设置” | 设置标签、提示、独立通知密钥显示项 |
| Publishing the template / Title / Add / Close | 第 9 节后的“模板标题与提交” | 设置展示名称，理解添加操作 |

### 这张完整截图中应先处理的项目

| 截图当前状态 | 本次如何填写或处理 |
|---|---|
| 商品 Price 的 Field 是 `quantity` | 改为 `goodsPrice`；Quantity 一行仍保留 `quantity` |
| Currency 为 `RUB` | 若实际收卢布则保留；若实际收美元则选 `USD`，按真实币种决定 |
| 上方 Notification URL 为空 | 取得 Tilda 为该模板确认的通知地址后填写；当前不能猜一个路径 |
| Same for notify signature 已勾选 | 取消勾选，再核对独立通知签名规则 |
| Successful payment indicator 为空 | Field 填 `paid`，Value 填 `true` |
| Transaction ID 为空且类型为 Integer | Field 填 `transactionid`，类型选择字符串 |
| Notification URL field hint 写着不支持国家的提示 | 改成下文提供的通知地址说明文字 |

需要先明确三个现状：

1. 顶层参数先发到我们的 Vercel 网关，由网关转换成 PricPay 字段；因此 `amount`、`email` 等名称是本项目的输入约定。
2. 商品数组内部目前直接透传，没有把 `name`、`price` 自动改成 `goodsName`、`goodsPrice`。商品内部映射必须配置成 PricPay 所需名称。
3. 当前创单处理没有校验 Tilda 的订单签名；发回 Tilda 的通知签名也必须与模板单独对齐。填写页面不能补上缺失的服务端校验，当前不能据此认定生产对接已经完成。

## 1. 先确认地址和数据方向

| 操作 | 方向 | 地址或配置 |
|---|---|---|
| 从 Tilda 发起支付 | Tilda 页面 → 网关 | `POST https://pricpay-tilda.vercel.app/api/pricpay/cashier` |
| PricPay 异步通知 | PricPay → 网关 | 网关自动生成 `/api/pricpay/notify?order=订单号` |
| 支付后浏览器返回 | 浏览器 → 网关 | 网关自动生成 `/api/pricpay/return?order=订单号` |
| 更新 Tilda 订单状态 | 网关 → Tilda | 使用 Tilda 提供的 Notification URL |

在 Tilda 的 API URL 填第一行的完整网址，请求方式为 POST。正式接入不加 `?response=json`，浏览器请求也不要设置 `Accept: application/json`，否则网关会返回 JSON 而不是 303 跳转。

Tilda 提供的 Notification URL 是 Tilda 的接收地址。将其映射为下文的 `notifyUrl`；也可以在网关环境变量 `TILDA_NOTIFY_URL` 设置同一实际地址作为兜底。不要用本网关的 `/notify` 或 `/return` 代替它。

## 2. 理解 Field 输入框

`MAPPING FIELD LIST` 左边是 Tilda 的数据来源，中间 Field 是发送给接收方的参数名，右边是格式。

例如，Amount 的 Field 填 `amount`，表示 Tilda 发出 `amount=19.90`。网关再转换成 PricPay 的 `transactionAmount=19.90`。

因此，“填写支付网关需要的字段名称”这个理解是对的；这里直接接收 Tilda 请求的是我们的网关。不同接口间相同的字段名也可能有不同含义，尤其是 `notifyUrl`。

## 3. 顶层字段映射

只填写表中字段名本身，注意大小写，不填写示例值或环境变量名称。

| Tilda 左侧项目 | 中间 Field | 右侧格式 | 当前代码如何处理 |
|---|---|---|---|
| Login | `login` | 无 | 保留 Tilda 的 Login 原值供记录；不用于 PricPay 鉴权，实际商户号来自 `PRICPAY_MERCHANT_NO` |
| Currency | `currency` | `USD/EUR/...` | 转为 `transactionCurrency`，实际币种在上层支付配置选择 |
| Language | `language` | `Upper case` | 保留 Tilda 的语言原值供记录，当前不传给 PricPay |
| Country | `country` | `Upper case` | 转为 `billingCountry`，例如 `US` |
| Notification URL | `notifyUrl` | 无 | 保存为 Tilda 通知目标，不直接作为 PricPay 通知地址 |
| Order number | `orderid` | 保持截图的 `<project ID>:<order ID>` | 转为 `orderNumber`，原样保留完整订单号 |
| Order description | `description` | Max length 先留空 | 未传商品数组时用于默认商品名称 |
| Amount | `amount` | `In USD/EUR/...` | 转为 `transactionAmount`，例如 `19.90`，不用 cents/分格式 |
| Order time | `orderTime` | 保留 ISO-8601 | 先把 Tilda 订单时间带入原始请求记录；当前 PricPay 的 `merchantOrderDate` 仍由服务器生成 |
| Customer email | `email` | 无 | 转为 `billingEmail` |
| Customer phone | `phone` | `Unchanged` | 转为 `billingTelephone`，保留国家区号 |
| Customer name | `name` | 保持截图的 `Name (or Full Name, if empty)` | 转为 `billingFirstName`，代码不会自动拆分全名和姓氏 |
| Signature | `signature` | 无 | Tilda 发出签名，但当前创单处理没有验证它，见第 7 节 |
| Products | `products` | `Array in JSON` | 整体转入 PricPay 的 `productInformation`，内部字段原样保留 |

Country 的来源必须核对。当前代码把它当成客户账单国家；如果 Tilda 在此发送的是站点固定国家，不能据此认为已经收集到每位客户的真实账单国家。

Login、Language、Order time 在本项目中不是必需输入。为尽量保留订单和模板已有数据，本轮统一映射为 `login`、`language`、`orderTime`；它们会随原始请求进入现有记录流程。填写这些名称不会改变当前业务取值逻辑。

关于订单时间：你的“能从订单取得就优先使用订单参数”的要求已记录。现在先配置 `orderTime` 接收原值；后续再调整服务器构建 `merchantOrderDate` 的逻辑，本轮不做该修改。

### 不应直接照填的 PricPay 字段

| PricPay 名称 | Tilda 顶层应使用 | 原因 |
|---|---|---|
| `transactionAmount` | `amount` | 当前取金额函数不识别 `transactionAmount` |
| `transactionCurrency` | `currency` | 当前取币种函数不识别 `transactionCurrency`，缺失时会默认 USD |
| `billingEmail` | 推荐 `email` | 代码兼容 `billingEmail`，但统一使用表中名称更易核对 |
| `merchantNo` | 不用从表单提供 | 使用服务端环境变量 |
| `signature` | Tilda 也可叫 `signature` | 两段请求签名各自生成，Tilda 的签名不会直接作为 PricPay 签名发送 |

## 4. 商品数组内部字段

这对应截图中 Products 下方的内层框。外层 `products` 选择 `Array in JSON` 后，按下面配置：

| 内层项目 | Field 填写 | 右侧格式 | 说明 |
|---|---|---|---|
| Order number | 留空 | 不需要配置 | 这里是商品行编号，不是顶层订单号；PricPay 示例没有要求这个额外字段 |
| Name | `goodsName` | Max length 先留空 | 将截图现有的 `name` 改为 `goodsName` |
| Quantity | `quantity` | 无 | 保留数量 |
| Price | `goodsPrice` | `In USD/EUR/...` | 将截图现有的 `price` 改为 `goodsPrice`，表示商品单价 |
| Full Amount | 留空 | 不需要配置 | 不要再映射成单价；当前代码不使用额外的商品行总额字段 |
| Image | `productShowUrl` | 无 | 对应 PricPay 官方示例的商品图片网址 |

商品 JSON 应具有下面这种结构。以下是假订单数据，不是需要粘贴进 Field 输入框的内容：

```json
[
  {
    "goodsName": "Demo product",
    "goodsPrice": 19.9,
    "quantity": 1,
    "productShowUrl": "https://shop.example.com/product.jpg"
  }
]
```

PricPay 官方示例还包含 `productUrl` 和 `productCategory`。用户截图没有展示这两项对应的动态数据来源，因此不虚构 Tilda 的映射入口。若所用 PricPay 渠道要求它们，需确认模板能否提供实际商品链接、分类，或补充网关适配后再接入该渠道。

当前代码对 JSON 字符串直接返回，对数组只执行 JSON 序列化。因此 `[{"name":"Demo product","price":19.9,"quantity":1}]` 即使成功到达网关，其键名也不会自动改为 `goodsName`、`goodsPrice`。旧指南中“会转换商品信息”的说法仅指外层封装，不代表内部名称转换。

### 运费和折扣开关

| 选项 | 建议 | 核对要求 |
|---|---|---|
| Add delivery to products list | 无运费时不勾；需要在商品列表体现运费时勾选 | 用含运费订单检查最终商品 JSON 和订单总额，不能重复加运费 |
| Use discount price for products | 使用折扣时勾选，并用折扣订单验证 | `goodsPrice` 应反映本次实际收费；订单级优惠如何分摊不能仅凭此开关推定 |
| Use discount price if FFD array | 本方案使用 JSON 商品数组，不依赖此项，可取消勾选 | 不用它代替上面的普通商品折扣设置 |

商品价格与总额还可能涉及运费、订单级折扣和舍入。模板实际输出需要用有折扣、有运费的测试订单核对，当前网关不会重新计算或校正这些数据。

## 5. Additional field list

成功/失败页面是用户在你的 Tilda 店铺里看到的页面，填写实际存在的完整 HTTPS 网址。

| 添加的 Field | Value | 用途 |
|---|---|---|
| `successUrl` | 你实际的支付成功页网址 | 浏览器支付成功后跳转 |
| `failUrl` | 你实际的支付失败页网址 | 支付失败后跳转 |
| `pendingUrl` | 你实际的处理中页网址；没有则不添加 | 支付处理中跳转 |

如果这些页面已配置在 `TILDA_SUCCESS_URL`、`TILDA_FAILURE_URL`、`TILDA_PENDING_URL`，可以使用环境变量兜底；订单参数优先。

PricPay 账单数据还可以使用 `lastName`、`state`、`city`、`address`、`zip` 等本项目支持的参数。它们必须绑定客户实际填写的数据。截图没有显示 Tilda 动态表单取值语法，因此不要在 Value 中直接输入字符串 `lastName` 或统一填写假地址来代替客户数据。

`country` 已在上方映射时，不要又传冲突的 `billingCountry`：代码优先使用 `country`。其他字段也应避免同时设置多个值不一致的别名。

不要在 Additional field list 填 `PRICPAY_SECRET`、数据库连接串或健康检查令牌。

## 6. 上层基础设置与密钥

这里填写实际值，与 Mapping field list 填参数名不同。例如最上方 Login 填实际商户号，中间映射表 Login 填 `login`。

| 界面字段 | 是什么 | 你要如何填写 | 当前项目说明 |
|---|---|---|---|
| Login | 此支付配置的商户标识 | 复制你现有 `PRICPAY_MERCHANT_NO` 的实际值 | 不要填写字面字符串 `PRICPAY_MERCHANT_NO`；当前后端实际鉴权仍用环境变量 |
| Secret for order sign | Tilda 生成订单签名使用的密钥 | 填你为 Tilda 设置的订单签名密钥 | 当前创单代码尚不验证它；不要把截图中的真实密钥抄进文档或附加表单字段 |
| Notification URL | Tilda 接收支付结果的服务器地址 | 填 Tilda 对这个自定义模板提供或确认的实际通知 URL | 不填本网关的 `/notify`、`/return`，也不填店铺成功页面 |
| Currency | 实际订单收款币种 | 选择你实际收款且 PricPay 商户支持的币种，例如美元选择 `USD` | 截图是 `RUB`，会按映射发送 RUB；右侧 `USD/EUR/...` 只是字母代码格式，不会将它转换成 USD |
| Country | 此 Tilda 配置的国家值 | 填实际的两位国家代码；英国为 `GB`，美国为 `US` | 截图 `GB` 仅在实际国家正确时保留；当前代码还会将映射出的值用作账单国家 |
| Payment widget language | 支付组件语言 | 英文保留 `EN`，其他语言按店铺选择 | 映射为 `language` 供记录，当前不会控制 PricPay 收银台语言 |
| Advanced settings / API URL | Tilda 发起支付的入口 | `https://pricpay-tilda.vercel.app/api/pricpay/cashier` | 该页面说明 POST 跳转，正式接入不加调试参数 |
| 请求方法（若界面另有选项） | 发单方式 | POST | 使用表单字段发送 |
| Secret for notification（显示该输入框后） | Tilda 验证本网关通知使用的密钥 | 填与 Vercel `TILDA_NOTIFY_SECRET` 完全相同的实际值 | 建议使用独立 Tilda 通知密钥，显示方法见“表单显示设置” |

Notification URL 目前仍是需要取得真实值的项目。你这张截图是新建模板页面，输入框为空，并没有给出该地址。官方通用帮助明确说明它应是 Tilda 的服务器地址，但没有公布适用于这个未完成模板的通用固定 URL。应从该模板的站点配置或 Tilda 模板接入确认中取得；不能根据别人的支付模板拼一个 `/custom/pricpay/` 路径，也不能假定点击 Add 后就一定自动填好。

Tilda 的 Secret for order sign 属于 Tilda 发给网关的订单签名配置。它与“网关发给 Tilda 的通知验签密钥”是不同方向；是否共用由模板设置决定，不能仅凭相似的名称认为自动相同。

PricPay 的商户密钥保留在服务器环境变量 `PRICPAY_SECRET` 中。Tilda 通知建议配置独立的 `TILDA_NOTIFY_SECRET`。当前代码在未配置它时会回退到 `PRICPAY_SECRET`，这是现有行为，不是要求将 PricPay 密钥填写到 Tilda。

## 7. Order signature：当前存在服务端校验缺口

本轮按你的要求保留现有业务处理，不实现新的入站验签。下面将截图已经显示的每一项列全：前四项是订单侧生成基线，后六项按当前截图保留。它们只配置 Tilda 如何生成订单签名，不是一套已完成服务端验证的规则。

| 界面项目 | 是什么 | 本轮如何填写或选择 | 当前实现状态 |
|---|---|---|---|
| Signature rules | 参与生成的字段规则 | `All fields` | Tilda 侧先配置；网关尚未验证入站签名 |
| Excluding fields | 不参加签名的字段 | `signature` | 添加一个字段名，不填写签名值 |
| Do not use fields with empty values for signature | 是否跳过空值 | 勾选 | 订单侧生成基线 |
| Fields order | 字段排序方式 | `Alpha, asc` | 按字段名升序 |
| Divider | 字段值之间的分隔符 | 本轮保持截图的空白 | 仅保留当前订单侧设置；不适用于下节的通知签名 |
| Add secret in signature | 是否将密钥放入拼接串 | 本轮保持截图的 `No` | 仅保留当前订单侧设置，不能当成通知的规则 |
| Signature algorithm | 摘要算法 | 保持 `MD5` | 当前后端不据此验证 Tilda 订单 |
| Use secret as algorithm key (HMAC) | 是否用 HMAC | 保持不勾选 | 普通 MD5 与 HMAC 是不同算法 |
| Use uppercase | 生成摘要是否大写 | 订单侧本轮保持截图的不勾选 | 通知侧必须单独按当前代码的大写结果配置 |
| Encode result signature in base64 | 是否将结果编码成 Base64 | 保持不勾选 | 不把普通摘要改成 Base64 |
| Mapping / Signature | 签名发出的参数名 | `signature` | 字段可接收，但当前不会据此拒绝伪造创单请求 |

上述“保留”是为了本轮不混入业务验签规则变更，不代表无密钥的摘要可以用于正式验证。后续实现订单验签时，应统一确定密钥位置、分隔符、大小写等完整规则，再同时调整页面和后端。

`TILDA_ORDER_SECRET` 虽然名字包含 ORDER，当前也只是通知密钥的兼容别名，并没有启用创单验签。建议明确使用 `TILDA_NOTIFY_SECRET` 配置通知，勿将“设置了环境变量”理解为“已启用入站验签”。

正式接入前应完成：用 Tilda 生成的一笔订单验证正确签名可通过，并验证篡改金额或订单号后会拒绝创单。当前版本尚不能通过后一项。

## 8. Notification：按截图填写的值

这一块控制 Tilda 如何解释我们发回去的支付结果。

| 界面项目 | 是什么 | 你要如何填写或选择 | 原因 |
|---|---|---|---|
| Successful payment indicator / Field | 判断支付成功的通知字段名 | `paid` | 与本网关通知一致 |
| Successful payment indicator / Value | 表示支付成功的字段值 | `true` | 网关发送字符串 `true`，不是 `100`、`1` 或 `success` |
| Transaction ID / Field | 支付流水号字段名 | `transactionid` | 全小写，来自 PricPay 平台订单号 |
| Transaction ID / 类型 | 流水号的数据类型 | 在下拉选项中选择表示字符串的类型 | PricPay 官方样例含字母，不能沿用 `Integer`；没有字符串类型时先确认模板能力 |
| Notify success answer | Tilda 正常接收通知后的应答 | `OK` | 大写，保留截图中的值 |
| Notify error answer | Tilda 处理通知出错时的应答 | `ERROR` | 大写，保留截图中的值 |
| Answers for notify as json | 是否用 JSON 包装应答 | 不勾选 | 此配置使用纯文本 `OK` / `ERROR` |

`Notify success answer` 的 `OK` 是 Tilda → 本网关的响应。本网关给 PricPay 的通常应答是小写 `ok`，两者不是同一个方向。

仅在 PricPay 通知签名验证成功且 `orderStatus=100` 时，当前代码才尝试给 Tilda 发送成功通知。

### Tilda 实际收到的通知字段

| 字段 | 示例值 | 是否参与当前通知签名 |
|---|---|---|
| `orderid` | `12345:10001` | 是 |
| `amount` | `19.90` | 是 |
| `paid` | `true` | 是 |
| `transactionid` | `TX-DEMO-001` | 非空时是 |
| `signature` | MD5 大写结果 | 否 |
| `target` | Tilda 通知目标网址 | 否；代码在签名后追加此字段 |

## 9. Tilda 接收通知时的验签规则

本节是网关 → Tilda 的通知签名，不能用第 7 节的订单签名配置替代。

### Same for notify signature 要如何选择

| 界面项目 | 是什么 | 你要如何选择 | 原因 |
|---|---|---|---|
| Same for notify signature | 通知是否沿用订单签名规则 | 取消勾选 | 截图订单侧是空分隔符、No secret、非大写；与当前通知签名不一致 |
| 独立通知签名规则 | 取消共用后单独核对的规则 | 按下一张表配置，不能直接照搬第 7 节 | 两个方向处理的字段和拼接方式不同 |

取消共用后，若界面提供独立通知签名区块，应以该区块的实际选项配置。完整截图尚未展示取消勾选之后的界面，因此无法仅凭这张图给出 Special rules 文本框的可粘贴模板语法。

要与当前 `toTildaNotification()` 一致，通知验签需要：

| 通知侧配置 | 你要填写或达到的值 | 配置说明 |
|---|---|---|
| 使用的字段 | 非空的 `amount`、`orderid`、`paid`、`transactionid` | 不把其他字段自动混入 |
| Excluding fields（若采用 All fields） | 分别添加 `signature`、`target` | 如存在其他未签入字段，也需排除 |
| Do not use fields with empty values | 勾选 | 空值不参与 |
| Fields order | `Alpha, asc` | 顺序为 amount、orderid、paid、transactionid |
| 字段内容格式 | `key=value` | 必须包含字段名，不能只连接字段值 |
| 字段连接符 | `&` | 只有这个分隔符还不足以表达完整规则 |
| 末尾密钥规则 | 追加 `&secret=` 和实际通知密钥 | 不要把 `&secret=` 填进密钥本身；不能假定普通 Add secret 选项会自动补这个前缀 |
| Signature algorithm | `MD5` | 按 UTF-8 原始字符串计算 |
| Use secret as algorithm key (HMAC) | 不勾选 | 当前是 MD5，不是 HMAC-MD5 |
| Use uppercase | 勾选 | 当前结果为大写十六进制 |
| Encode result signature in base64 | 不勾选 | 当前不是 Base64 |
| Signature rules / Special rules | 仅当能表达完整拼接串时使用 | 需要核对独立通知规则实际支持的模板语法，不能编造占位符 |

下面使用虚构通知密钥 `TILDA_DEMO_SECRET`，已通过实际代码计算核对：

```text
amount=19.90&orderid=12345:10001&paid=true&transactionid=TX-DEMO-001&secret=TILDA_DEMO_SECRET
```

对应的 `signature`：

```text
C20699714DE7CE1E88F2E52D66060C69
```

用于计算的是原始字段值，不是 URL 编码后的整段表单文本。金额字符串 `19.90` 也不要擅自改成 `19.9` 再计算。

这一项仍需确认独立通知规则的实际模板能力；它是必须对齐的配置，不是可以假定已经完成的代码优化。当前截图中的 `Same for notify signature` 勾选状态不能作为已匹配方案。本文已列出所需值和验证样例，不声称当前页面已经能直接生成相同摘要。

### 表单显示设置：Form settings

这些 title / hint 只改变管理员看到的标签和提示，不改变接口参数名。Russian 项不使用时可保持原文，主要修改 English；下面所有文案都是要填的显示文字，不是密钥或接口字段值。

| 界面项目 | 是什么 | English 要如何填写 | Russian / 其他处理 |
|---|---|---|---|
| "LOGIN" field title | 顶部 Login 的标题 | `Merchant ID` | 保持原文即可 |
| "LOGIN" field hint | 顶部 Login 下方说明 | `Merchant number configured for this gateway.` | 保持原文即可 |
| "SECRET FOR ORDER SIGN" field title | 顶部订单签名密钥标题 | `Tilda order signing secret` | 保持原文即可 |
| Show field "Secret for notification" | 是否显示独立通知密钥输入框 | 勾选 | 出现后填入与 Vercel `TILDA_NOTIFY_SECRET` 相同的实际值；不要填写环境变量名称本身 |
| "NOTIFICATION URL" field title | 顶部通知地址标题 | `Tilda payment notification URL` | 保持原文即可 |
| "NOTIFICATION URL" field hint | 顶部通知地址的说明 | `Tilda URL that receives payment status notifications.` | 当前截图中的国家限制提示与此字段不符，应更正 |

如果勾选后出现额外的通知密钥标题或提示设置，可分别使用 `Tilda notification signing secret` 和 `Must match the gateway notification signing secret.`。这些是显示文案建议，不是新增后端字段。

### 模板标题与提交：Publishing the template

| 界面项目 | 是什么 | 你要如何填写或操作 | 说明 |
|---|---|---|---|
| Publishing the template | 公开模板发布说明 | 先完成当前站点联调，再按 Tilda 流程申请公开 | 页面说明公开模板需审核，填写配置不等于已获审核 |
| Title | 顾客在购物车中看到的支付方式名称 | `PricPay` | 也可用你希望顾客看到的明确名称；不是商户号或 API 字段 |
| Add | 添加或提交这个支付集成的操作 | 完成已确认项目、核对页面声明后由你提交 | 当前截图说明这是新集成申请，不把它描述成无条件的草稿保存 |
| Close | 关闭配置窗口 | 需要添加配置时不要用它代替 Add | 它不是提交配置的按钮 |

目前不能编造的两个实际值是：该模板的 Tilda Notification URL，以及独立通知签名 Special rules 的实际可用语法。其余已见字段均已逐项列出；这两项取得或确认后，才能把“页面配置完成”和“Tilda 可正确验签收款通知”同时验证。

## 10. 环境变量与健康检查

| 环境变量 | 配置要求 |
|---|---|
| `DATABASE_URL` | 现有 Neon pooled 连接串 |
| `DATABASE_URL_UNPOOLED` | 现有 Neon 直连串，供建表等管理操作使用 |
| `PRICPAY_MERCHANT_NO` | PricPay 实际商户号 |
| `PRICPAY_SECRET` | PricPay 实际签名密钥，仅服务端保存 |
| `PRICPAY_MERCHANT_WEBSITE` | 核对实际商户网站地址，对应 PricPay 的 `merchantWebsite` |
| `GATEWAY_HEALTH_TOKEN` | 现有健康检查令牌 |
| `GATEWAY_DB_TIMEOUT_MS` | 当前联调建议显式设置 `10000`；代码默认仍是 `1000`，本文没有修改默认值 |
| `TILDA_NOTIFY_SECRET` | 与 Tilda 通知验签配置一致的独立密钥 |
| `TILDA_NOTIFY_URL` | 可选兜底，使用 Tilda 实际通知地址；已有订单参数 `notifyUrl` 时优先参数 |
| `TILDA_SUCCESS_URL` / `TILDA_FAILURE_URL` / `TILDA_PENDING_URL` | 对应店铺页面的可选兜底 |

只使用 Cashier 时，不需要 `PRICPAY_MODE`、`PRICPAY_CREATE_MODE`、`PRICPAY_PAYMENT_METHOD`、`PRICPAY_PUB_ID`。Vercel 上修改 Production 变量后，需重新部署对应 Production 才会应用新值。

健康检查使用 `/api/neon/health?details=1`，以现有令牌通过 `Authorization: Bearer` 请求头或 `token` 查询参数鉴权。

| 响应 | 当前代码含义 |
|---|---|
| `ok: true`、`service: neon-postgres` | 本次健康检查日志写入已完成；details 模式会另外读取计数 |
| HTTP 404、`error: Not found` | 当前健康路由中的鉴权分支拒绝了请求；还没有检查数据库 |
| `Gateway log write timed out after 1000ms` | 进入数据库操作后超出配置等待时间；首次调用还包含串行 schema 检查 |
| `DATABASE_URL is not configured` | 当前实例未读取到数据库连接串 |

健康检查会写入一条 `neon.healthcheck` 事件。它成功不代表已经验证 Tilda 字段、商户权限、真实支付或回调闭环。

## 11. 保存配置后如何验证

先完成上述已明确的字段映射，再用 PricPay 测试环境或测试商户联调。本文验证期间没有向支付接口发起 POST，也没有创建真实订单。

1. 检查真实 Tilda 请求的方法是 POST，字段包含 `orderid`、`amount`、`currency`、`email`、`notifyUrl`。
2. 在原始请求中检查 `products` 是 JSON 字符串，内部包含 `goodsName`、`goodsPrice`、`quantity`；不能只看外层名是否存在。
3. 检查转出的 PricPay 请求中，金额、币种、客户信息正确；PricPay `notifyUrl` 是本网关 `/notify`，Tilda 通知地址另存于订单记录。
4. 用含运费、折扣的订单分别验证金额，核对各商品的实际单价与数量。
5. 支付成功后，确认收到签名有效、状态为 100 的 PricPay 异步通知。
6. 查看 `tilda.notify.forwarded` 事件记录的 HTTP 状态和响应正文，并在 Tilda 后台直接确认订单已支付。
7. 完成第 7 节所述入站签名验证及篡改拒绝测试后，再评估正式接入。

当前转发代码会在收到任意 HTTP 响应后记录 `tilda.notify.forwarded` 和 `forwardedToTilda: true`，没有检查 HTTP 成功状态或正文是否为 `OK`。因此这些日志只证明尝试发送并取得响应，不能单独证明 Tilda 已验签或更新订单。该应答判定也需要完善。

## 12. 本文核对依据

| 依据 | 本文结论 |
|---|---|
| [`lib/pricpay.ts`](../lib/pricpay.ts)：取字段、构建订单、商品封装 | 顶层字段转换和商品内部透传 |
| [`lib/pricpay-create-handler.ts`](../lib/pricpay-create-handler.ts)：创单入口 | 接收表单、记录订单、没有调用 Tilda 入站验签 |
| [`lib/pricpay.ts`](../lib/pricpay.ts)：`toTildaNotification()`、`sign()` | 通知字段、排除 target 的要求、MD5 示例 |
| [`app/api/pricpay/notify/route.ts`](../app/api/pricpay/notify/route.ts) | 仅成功状态转发；当前没有核验 Tilda 成功应答 |
| [`app/api/neon/health/route.ts`](../app/api/neon/health/route.ts) | 健康检查鉴权、写日志和响应含义 |

已用 TypeScript 实际源码在内存中执行虚构订单样例，验证 9 项顶层转换、两种通知地址的方向、商品字段原样保留、通知签名示例及 `target` 排除要求。该验证不等同于 Tilda 页面真实请求测试。

官方参考：

- [Tilda 自定义支付网关](https://help.tilda.cc/payments/custom-payment-gateway)：字段映射、订单签名、通知确认。
- [PricPay Cashier](https://www.pricpay.com/api/cashier.html)：上游请求与商品字段示例。
- [PricPay 签名](https://www.pricpay.com/api/signature.html)。
- [PricPay 异步通知](https://www.pricpay.com/api/notify.html)：平台流水号为字符串、支付状态定义。
- [Vercel 环境变量](https://vercel.com/docs/environment-variables)：变量修改后需新部署生效。
