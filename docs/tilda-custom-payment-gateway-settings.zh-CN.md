# Tilda 独立站自定义支付网关逐项配置

核对日期：2026-10-20。代码基线：`2dfca40`。适用接口：本项目的 PricPay Cashier。

本文按实际代码和用户提供的界面截图说明配置，供模板配置和联调使用。已验证本地字段转换及通知签名示例；未验证真实 Tilda 模板生成的请求、PricPay 实际支付或 Tilda 通知验签。

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
| Login | 留空；如需记录可填 `login` | 无 | 不用于 PricPay 鉴权，实际商户号来自 `PRICPAY_MERCHANT_NO` |
| Currency | `currency` | `USD/EUR/...` | 转为 `transactionCurrency`，实际币种在上层支付配置选择 |
| Language | 留空；如需记录可填 `language` | 填字段时保留 `Upper case` | 当前不传给 PricPay |
| Country | `country` | `Upper case` | 转为 `billingCountry`，例如 `US` |
| Notification URL | `notifyUrl` | 无 | 保存为 Tilda 通知目标，不直接作为 PricPay 通知地址 |
| Order number | `orderid` | 保持截图的 `<project ID>:<order ID>` | 转为 `orderNumber`，原样保留完整订单号 |
| Order description | `description` | Max length 先留空 | 未传商品数组时用于默认商品名称 |
| Amount | `amount` | `In USD/EUR/...` | 转为 `transactionAmount`，例如 `19.90`，不用 cents/分格式 |
| Order time | 留空；如需记录可填 `orderTime` | 填字段时保留 ISO-8601 | PricPay 的 `merchantOrderDate` 由服务器生成 |
| Customer email | `email` | 无 | 转为 `billingEmail` |
| Customer phone | `phone` | `Unchanged` | 转为 `billingTelephone`，保留国家区号 |
| Customer name | `name` | 保持截图的 `Name (or Full Name, if empty)` | 转为 `billingFirstName`，代码不会自动拆分全名和姓氏 |
| Signature | `signature` | 无 | Tilda 发出签名，但当前创单处理没有验证它，见第 7 节 |
| Products | `products` | `Array in JSON` | 整体转入 PricPay 的 `productInformation`，内部字段原样保留 |

Country 的来源必须核对。当前代码把它当成客户账单国家；如果 Tilda 在此发送的是站点固定国家，不能据此认为已经收集到每位客户的真实账单国家。

Login、Language、Order time 在本项目中不是必需输入。此前建议填写 `login`、`language`、`orderTime` 只是可选的记录名称；界面允许不需要的字段留空，填这些名称也不会让后台新增处理逻辑。

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

| 设置 | 当前项目要求 |
|---|---|
| API URL | `https://pricpay-tilda.vercel.app/api/pricpay/cashier` |
| 请求方法 | POST |
| Login 的实际值 | 当前网关不使用它决定商户号；若平台要求填写，使用你的公开网关标识，勿填写密钥 |
| Currency 的实际值 | 按店铺和 PricPay 商户实际支持的币种设置；字母格式选项不等于已选 USD |
| Tilda 的 Notification URL | 使用 Tilda 提供的实际通知地址，通过 `notifyUrl` 传入或写入 `TILDA_NOTIFY_URL` |
| Tilda 通知验签密钥 | 与网关的 `TILDA_NOTIFY_SECRET` 一致，具体绑定到模板的通知验签规则 |

Tilda 的 Secret for order sign 属于 Tilda 发给网关的订单签名配置。它与“网关发给 Tilda 的通知验签密钥”是不同方向；是否共用由模板设置决定，不能仅凭相似的名称认为自动相同。

PricPay 的商户密钥保留在服务器环境变量 `PRICPAY_SECRET` 中。Tilda 通知建议配置独立的 `TILDA_NOTIFY_SECRET`。当前代码在未配置它时会回退到 `PRICPAY_SECRET`，这是现有行为，不是要求将 PricPay 密钥填写到 Tilda。

## 7. Order signature：当前存在服务端校验缺口

截图里的项目可以逐项解释，但目前没有一套已完成服务端验证的 Tilda 入站签名配置。

| 截图项目 | Tilda 侧可先设置的基线 | 当前实现状态 |
|---|---|---|
| Signature rules | `All fields` | 网关没有按此规则验证 Tilda 入站签名 |
| Excluding fields | `signature` | 签名本身不应参与生成；这是模板配置，不代表服务端已经执行排除和验证 |
| Do not use fields with empty values for signature | 勾选 | 属于拟定的非空字段签名基线，尚未由当前创单代码验证 |
| Fields order | `Alpha, asc` | 同上 |
| 签名输出字段 | 上方 Mapping 中填写 `signature` | 当前字段可接收，但不会据此拒绝伪造创单请求 |

后续未出现在截图中的拼接、散列、密钥位置等选项，不能仅根据 PricPay 使用 MD5 就认定 Tilda 也应填相同规则。应先确定并实现 Tilda → 网关的入站签名规范，再把完整生成规则与验证代码对齐。

`TILDA_ORDER_SECRET` 虽然名字包含 ORDER，当前也只是通知密钥的兼容别名，并没有启用创单验签。建议明确使用 `TILDA_NOTIFY_SECRET` 配置通知，勿将“设置了环境变量”理解为“已启用入站验签”。

正式接入前应完成：用 Tilda 生成的一笔订单验证正确签名可通过，并验证篡改金额或订单号后会拒绝创单。当前版本尚不能通过后一项。

## 8. Notification：按截图填写的值

这一块控制 Tilda 如何解释我们发回去的支付结果。

| 截图项目 | 填写或选择 | 原因 |
|---|---|---|
| Successful payment indicator / Field | `paid` | 网关通知字段名 |
| Successful payment indicator / Value | `true` | 网关发送的是字符串 `true`，不是 `100`、`1` 或 `success` |
| Transaction ID / Field | `transactionid` | 全小写，来自 PricPay 平台订单号 |
| Transaction ID / 类型 | 在下拉选项中选择表示字符串的类型 | PricPay 官方样例流水号包含字母，不能沿用 `Integer`；若下拉没有字符串类型，应先确认模板能力 |
| Notify success answer | `OK` | Tilda 返回给本网关的成功应答内容 |

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

要与当前 `toTildaNotification()` 一致，通知验签需要：

| 规则 | 必须满足的行为 |
|---|---|
| 使用的字段 | 非空的 `amount`、`orderid`、`paid`、`transactionid` |
| 排除字段 | `signature`、`target`；如使用 All fields 还需排除其他未签入字段 |
| 空值 | 不参与 |
| 顺序 | 按字段名升序，即 `amount`、`orderid`、`paid`、`transactionid` |
| 字段格式 | `key=value` |
| 字段连接符 | `&` |
| 末尾密钥 | 在最后一个字段后追加 `&secret=` 和实际通知密钥 |
| 编码和散列 | 按当前 Node 代码的 UTF-8 字符串计算 MD5，结果转大写 |

下面使用虚构通知密钥 `TILDA_DEMO_SECRET`，已通过实际代码计算核对：

```text
amount=19.90&orderid=12345:10001&paid=true&transactionid=TX-DEMO-001&secret=TILDA_DEMO_SECRET
```

对应的 `signature`：

```text
C20699714DE7CE1E88F2E52D66060C69
```

用于计算的是原始字段值，不是 URL 编码后的整段表单文本。金额字符串 `19.90` 也不要擅自改成 `19.9` 再计算。

截图没有展示 Tilda 的完整通知签名配置界面，官方通用帮助也没有给出该模板的所有控件选项。必须确认模板能表达上述规则；若通用拼接不支持，可核对 Special rules 的实际能力，但本文不编造占位符语法。不能仅选择 MD5、升序就认为已经匹配了完整签名。

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
