# Tilda 客户地址采集与网关传递

店铺：`https://hoteltoiletries.ru/`。币种：RUB。核对日期：2026-10-20。

Additional field list 中的 `successUrl` 和 `failUrl` 保留固定链接。客户字段已约定为下表的参数名，后端已适配；Additional 的动态源字段绑定方式仍需检查实际 POST，不能用同名固定字符串冒充客户输入。

## 1. 目前缺什么

公开首页 HTML 上次可见表单字段主要是 Name、Email、Phone、Checkbox，未见地区、城市、详细地址、邮编输入；这只是公开首页的检查，不排除其他页面、动态字段或尚未发布的改动。

本项目已经能接收 `lastName`、`state`、`city`、`address`、`zip` 等参数，但没有参数来源时会将对应账单字段留空。这说明“代码支持字段”不等于“已从买家收集并传入”。

## 2. 在 ST100 购物车增加客户填写框

打开实际承载购物车的页面或公共页脚中的 **ST100 → Content → Input fields**。保留已有姓名、邮箱、电话，在这里添加地址输入框。

下面的 Variable name 是建议用于表单采集的数据名称，不是让你把这些键单独放进 Additional field list。Value 来自每位买家的实际输入。

| 顾客看到的俄文标签 | 建议 Variable name | 输入方式 | 必填建议 | 动态值来源 |
|---|---|---|---|---|
| Имя | `firstName` | 姓名或单行输入 | 必填 | 买家输入的名，后端优先于旧 name |
| Фамилия | `lastName` | 单行输入 | 结合物流及 PricPay 实际要求设置 | 买家输入的姓，不从全名强行猜测 |
| Email | `email` | Email 输入 | 必填 | 买家邮箱 |
| Телефон | `phone` | 电话输入 | 必填 | 买家电话，面向俄罗斯时核对默认区号设置 |
| Страна | `customerCountry` | 真实国家选择 | 必填 | 买家实际地址国家，两位代码如 RU；优先于站点固定 country，不编造下拉项编码语法 |
| Регион / область | `state` | 单行输入或合适的地区选择 | 结合物流及 PricPay 实际要求设置 | 买家实际地区，例如 Московская область |
| Город | `city` | 单行输入 | 发货订单建议必填 | 买家实际城市 |
| Улица, дом, квартира | `address` | 单行或多行输入 | 发货订单建议必填 | 实际街道、门牌和房间信息 |
| Почтовый индекс | `zip` | 单行文本输入 | 结合实际物流要求设置 | 买家实际邮编，保留字符串形式 |

上述 Variable name 同时是约定发给本网关的参数名。邮箱和电话已有顶层映射时不重复添加；姓名使用 firstName、lastName 分开采集，不使用 fullname，也不自动猜测拆分。旧 name 仅作为后端兼容备用。

每个输入框的“标题”和“Variable name”是不同设置；例如标题是 `Город`，变量名才是 `city`。不要将“Москва”固定成所有客户的城市。

如果使用简单配送选项，Tilda 不会自动显示地址输入框，需要手动添加；也可以使用其高级配送设置收集实际配送地址。保存并发布包含购物车的页面，然后在 Tilda 的实际订单记录中确认地址数据已收到。

配送地址与银行卡账单地址可能不同。当前网关把这些键映射成 PricPay 的 billing* 字段；只有客户确认地址一致时才应复用为账单地址，不能把两者无条件等同。

## 3. 必须再验证传递到支付网关

给购物车输入框设好变量名，只能确定表单采集的目标名称，不能直接证明自定义支付模板会自动把全部自定义字段发送出来。

| 需核对的位置 | 正确现象 |
|---|---|
| Tilda 订单／表单记录 | 能看到客户实际填写的地区、城市、地址和邮编 |
| 发往 `/api/pricpay/cashier` 的实际 POST | 包含真实的 `firstName`、`lastName`、`customerCountry`、`state`、`city`、`address`、`zip`，不是这些变量名的字面字符串 |
| 网关 `pricpay.cashier.request` 日志／原始订单记录 | 原始请求保留了这些值 |
| 网关 `pricpay.cashier.gateway_request` 日志 | `billingState`、`billingCity`、`billingAddress`、`billingZip` 等为客户真实值 |

目前没有从 Tilda 官方通用帮助确认 Additional field list 能用何种语法读取任意购物车自定义字段，因此不把 `{{city}}` 等未经该处界面验证的写法交给你照填。签名 Custom rules 支持双大括号，不代表所有 Value 输入框都支持同样模板语法。

如果实际支付 POST 没有带出这些字段，就需要补动态传递适配。Tilda 官方支持将表单字段通过 Webhook POST 到自己的服务，也支持在表单提交后读取字段的脚本机制；这些可以作为接入方案，但需要实现接收、校验和与支付订单关联，不能只填一个不存在的接口。

当前项目 API 只有健康检查及 PricPay 的 create、cashier、notify、return，没有专门接收完整 Tilda 地址表单的接口。不要将 Tilda 表单 Webhook 填成 `/api/pricpay/notify`，那是 PricPay 支付结果通知入口。

因此目前能通过 Tilda 配置完成“采集客户地址”，但“这些自定义字段动态进入支付请求”尚未验收；如果模板不支持直接绑定，这段适配属于完成接入所必需的工作，而不是固定字段值能替代的配置。

## 4. Country 与俄罗斯收据选项

上方固定 Country 按你的决定暂时保留 GB。后端账单国家现在按 `customerCountry` → `billingCountry` → `country` 取第一个非空值，并去掉首尾空格、转大写；收到真实 customerCountry=RU 时，不会被固定 country=GB 覆盖。若新字段没有传到，旧 country 仍会作为兼容兜底，不能认定 GB 永远不影响请求。

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
