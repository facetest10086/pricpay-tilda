# Tilda 客户地址采集与网关传递

店铺：`https://hoteltoiletries.ru/`。币种：RUB。核对日期：2026-10-20。

Additional field list 中保留 successUrl 和 failUrl 固定链接，删除七组同名固定客户字段。已实现 T123 脚本 → 客户数据接口 → 按订单 ID/token 关联 → Cashier 的传递方案，部署后按 [安装说明](tilda-customer-data-install.zh-CN.md) 添加脚本并发布购物车页面。

## 1. 目前缺什么

你已在购物车增加客户字段；实际支付截图显示 Additional 的同名值被原样发送，导致姓名出现 firstName lastName、邮编出现 zip。问题在数据传递，不能通过重复修改购物车变量名解决。

本项目已经能接收 `lastName`、`state`、`city`、`address`、`zip` 等参数，但没有参数来源时会将对应账单字段留空。这说明“代码支持字段”不等于“已从买家收集并传入”。

## 2. 在 ST100 购物车增加客户填写框

打开实际承载购物车的页面或公共页脚中的 **ST100 → Content → Input fields**。保留已有姓名、邮箱、电话，在这里添加地址输入框。

下面的 Variable name 是建议用于表单采集的数据名称，不是让你把这些键单独放进 Additional field list。Value 来自每位买家的实际输入。

| 顾客看到的俄文标签 | 建议 Variable name | 输入方式 | 必填建议 | 动态值来源 |
|---|---|---|---|---|
| Имя | `firstName` | 姓名或单行输入 | 必填 | 买家输入的名，后端优先于旧 name |
| Фамилия | `lastName` | 单行输入 | 必填 | 买家输入的姓，不从全名强行猜测 |
| Email | `email` | Email 输入 | 必填 | 买家邮箱 |
| Телефон | `phone` | 电话输入 | 必填 | 买家电话，面向俄罗斯时核对默认区号设置 |
| Страна | `customerCountry` | 真实国家选择或文本输入 | 必填 | 两位代码如 RU；也识别 Россия、Russia 等明确俄罗斯名称并转为 RU，不猜测其他未知名称 |
| Регион / область | `state` | 单行输入或合适的地区选择 | 可空 | 买家实际地区，例如 Московская область |
| Город | `city` | 单行输入 | 发货订单建议必填 | 买家实际城市 |
| Улица, дом, квартира | `address` | 单行或多行输入 | 发货订单建议必填 | 实际街道、门牌和房间信息 |
| Почтовый индекс | `zip` | 单行文本输入 | 必填 | 买家实际邮编，保留字符串形式 |

上述 Variable name 同时是约定发给本网关的参数名。邮箱和电话已有顶层映射时不重复添加；姓名使用 firstName、lastName 分开采集，不使用 fullname，也不自动猜测拆分。旧 name 仅作为后端兼容备用。

每个输入框的“标题”和“Variable name”是不同设置；例如标题是 `Город`，变量名才是 `city`。不要将“Москва”固定成所有客户的城市。

如果使用简单配送选项，Tilda 不会自动显示地址输入框，需要手动添加；也可以使用其高级配送设置收集实际配送地址。保存并发布包含购物车的页面，然后在 Tilda 的实际订单记录中确认地址数据已收到。

配送地址与银行卡账单地址可能不同。当前网关把这些键映射成 PricPay 的 billing* 字段；只有客户确认地址一致时才应复用为账单地址，不能把两者无条件等同。

## 3. 必须再验证传递到支付网关

给购物车输入框设好变量名，只能确定表单采集的目标名称，不能直接证明自定义支付模板会自动把全部自定义字段发送出来。

| 需核对的位置 | 正确现象 |
|---|---|
| Tilda 订单／表单记录 | 能看到客户实际填写的地区、城市、地址和邮编 |
| 客户数据接口和支付 POST | 客户接口收到真实字段；支付 POST 携带完整项目 ID:订单号和 customerDataToken，服务器按两者精确关联 |
| 网关 `pricpay.cashier.request` 日志／原始订单记录 | 原始请求保留了这些值 |
| 网关 `pricpay.cashier.gateway_request` 日志 | `billingState`、`billingCity`、`billingAddress`、`billingZip` 等为客户真实值 |

已新增 POST /api/tilda/customer-data。脚本读取 form.tildaOrderId 和页面项目 ID，不以邮箱、最近订单或 form.tildaTranId 猜测支付订单；在服务器确认数据保存后才提交原付款表单。Cashier 只合并校验过的客户字段，不允许它们覆盖金额、币种或商品。

此方案不使用 Additional 动态模板语法，也不要求配置表单 Webhook。不要将 /api/pricpay/notify 当成客户数据入口，那是 PricPay 支付结果通知入口。真实数据与 token 缺失时停止创单，避免继续发送错误地址。

## 4. Country 与俄罗斯收据选项

上方固定 Country 按你的决定暂时保留 GB。底层映射仍按 customerCountry → billingCountry → country 取第一个非空值，但现在 HTTP 创单前必须取得客户数据，customerCountry 为必填。真实 RU 不会被固定 GB 覆盖；客户数据缺失时停止创单，不依赖固定 GB 补齐。

只处理俄罗斯地址且确认账单国家为俄罗斯时可以使用 RU；跨国订单应取得真实账单国家。RUB 是币种，RU 是国家代码，两者不能互相替代。

截图中 OSN、VAT、delivery VAT、FFD 是俄罗斯电子收据／财政数据设置。当前网关代码没有将这些参数转给 PricPay，也没有实现俄罗斯电子收据服务。它们出现不代表当前 PricPay 集成已经具备开票能力；也不能随意将默认 OSN 或 VAT Free 判定为适合你的业务。应按实际接入的收据服务和真实税务配置核对，本说明不替你选择税制。

面向俄罗斯买家的 Tilda 组件语言建议 RU。当前网关未将 language 转给 PricPay，因此该设置不能单独保证 PricPay 收银台变为俄文。

## 5. 依据

- [Tilda 配送和地址输入](https://help.tilda.cc/online-store/shipping)。
- [Tilda 购物车表单配置](https://help.tilda.cc/online-store/cart)。
- [Tilda 表单 Webhook](https://help.tilda.cc/forms/webhook)。
- [Tilda 自定义脚本及表单数据读取](https://help.tilda.cc/tips/javascript)。
- [Tilda 俄罗斯电子收据说明](https://help-ru.tilda.cc/online-store/online-kassa)。
- [当前账单字段映射](../lib/pricpay.ts)。
