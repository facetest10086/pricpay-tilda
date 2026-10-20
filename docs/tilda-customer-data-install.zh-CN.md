# Tilda 客户数据脚本安装

适用站点：https://hoteltoiletries.ru/。此更新会在创建 PricPay 订单前取得真实姓名和地址；仅部署服务器还不够，需要完成下面两处 Tilda 配置。

## 1. 删除 Additional 中的七组固定值

删除 `firstName=firstName`、`lastName=lastName`、`customerCountry=customerCountry`、`state=state`、`city=city`、`address=address`、`zip=zip`。

保留 `successUrl` 和 `failUrl` 的真实页面网址。邮箱、电话、订单号、金额、币种、商品、orderTime 等顶层 Mapping 保留。Customer name 的旧 name 可以保留作记录，不再用它覆盖真实 firstName。

Additional 的齿轮控制后台显示、只读、必填和文案；它没有在已确认截图中提供购物车动态取值绑定。不要再将两列同名文字理解为源字段和目标字段。

## 2. 保留购物车输入框

| 内容 | Variable name | 要求 |
|---|---|---|
| 名 | `firstName` | 必填，不填完整姓名代替名 |
| 姓 | `lastName` | 必填 |
| 国家 | `customerCountry` | 必填，两位代码，如 RU；不是 Russia 等全称 |
| 地区 | `state` | 可空，有实际地区时填写 |
| 城市 | `city` | 必填 |
| 详细地址 | `address` | 必填，换行会合并为一行账单地址 |
| 邮编 | `zip` | 必填，文本值，保留前导零 |
| 邮箱 | `email` 或 `Email` | 必填，与支付请求相同 |
| 电话 | `phone` 或 `Phone` | 必填，保留国家区号，与支付请求相同 |

地址字段当前用于 PricPay 的账单字段。如果配送地址与持卡人账单地址不同，需要分别收集，不能直接复用。脚本只读取上表字段，不上传其他表单内容或任何银行卡数据。

## 3. 部署程序后添加 T123

1. 在实际包含 ST100 购物车的页面，添加 Other → T123 / Embed HTML。若购物车在公共页脚中，可把脚本一并放在公共页脚，确保每个结账页面加载。
2. 在 T123 代码框填写下面一行；也可使用 [T123 代码文件](tilda-customer-data-t123.html)。

```html
<script src="https://pricpay-tilda.vercel.app/tilda-customer-data.js" defer></script>
```

3. 保存并发布购物车页面／受公共页脚影响的页面。编辑器预览不能替代已发布页面测试。
4. 确认脚本地址可访问。API URL 仍为 `https://pricpay-tilda.vercel.app/api/pricpay/cashier`，无需更换。

不需要为这个方案配置 Forms → Webhook，也不要把 `/api/pricpay/notify` 填成客户数据入口。现有 PricPay 通知、Tilda 通知签名和成功／失败页设置保持各自用途。

## 4. 实际传递顺序

1. Tilda 创建订单并触发 `tildaform:aftersuccess`；脚本读取 form.elements 对应的真实输入值，以及 form.tildaOrderId。
2. 用页面的项目 ID 与订单号组成 `项目ID:订单号`。form.tildaTranId 是 Lead 标识，不拿它代替订单号。
3. 脚本只在付款表单指向本程序的 cashier 或 create 时接管提交。使用随机 256 位 token，将真实数据 POST 到 `/api/tilda/customer-data`，等待成功确认后再提交原支付字段和 customerDataToken。
4. 接收接口限制来源和请求大小、校验必填值，按完整订单 ID 和 token 哈希写入 Neon。相同数据可重复上传，同一凭据不能改成其他地址。
5. Cashier 按订单 ID 和 token 哈希读取对应数据，最长等待 8 秒；核对邮箱和电话，合并客户字段后再调用 PricPay。金额、商品、币种、订单时间和原签名字段不能由客户数据覆盖。

浏览器单次上传最多等待 10 秒；数据未保存时不会放行支付 POST。数据缺失、已过期或数据库不可用时，服务器停止创单，不再把字段名文字或空地址当成成功传递。普通表单及其他支付域名不受脚本接管。

## 5. 服务器与数据表

继续使用现有 DATABASE_URL。不需要新增商户密钥或把密钥放进脚本。可选变量 `TILDA_SITE_ORIGIN` 默认是 `https://hoteltoiletries.ru`，需要其他正式域名时显式改为完整 origin（协议加主机，无末尾斜杠）后重新部署。其他域名、www 子域名及 tilda.ws 预览域名不会自动获准。

新表 `tilda_customer_data` 会在首次使用时自动创建，也已纳入 db/schema.sql。部署账户需有建表权限；已有 `npm run db:schema` 也可预先建表。

临时客户数据 30 分钟内可用于关联，过期行在后续上传时清理；原始订单与已合并请求仍按现有日志机制保存。token 在数据库中仅保存 SHA-256 哈希，订单日志中的 customerDataToken 由已有脱敏规则遮盖。

这个 token 用于关联同一次结账，不代表服务器已经验证 Tilda 的订单签名。当前订单入站验签及 Tilda 通知响应判断的已有缺口仍需另行补齐。

## 6. 验证与排错

用 PricPay 测试商户下单，检查以下三处均出现买家真实值：接收数据、`pricpay.cashier.request` 日志、`pricpay.cashier.gateway_request` 的 billing* 字段。原始订单日志会额外保留 customerData；姓名、国家、邮编不应再显示为变量名文字。

| 现象 | 检查内容 |
|---|---|
| Missing or invalid customer data token | T123 是否在实际结账页面加载，订单号映射是否仍为项目 ID:订单号 |
| Invalid customer field | 对应购物车字段是否有真实值，国家是否为两位代码，是否残留变量名占位文字 |
| 403 Origin is not allowed | 已发布页面域名是否与 TILDA_SITE_ORIGIN 完全一致 |
| 503 保存或读取失败 | 数据库配置、建表权限或临时连接问题；不会继续创单 |
| 504 Customer data did not arrive | 数据与支付 POST 的订单 ID/token 是否一致，是否已经超过 30 分钟 |
| 俄文提示无法传递订单数据 | 付款尚未放行；检查购物车字段后刷新并重新提交，不代表已经扣款 |

本地单元测试：`npm test`。真实数据库联调：先构建，再将 TEST_DATABASE_URL 指向隔离测试分支运行 `npm run test:customer-flow`。该脚本启动本地网关和模拟支付端，不能使用生产数据库。设置 PLAYWRIGHT_MODULE_PATH 指向已安装的 Playwright 模块可附加浏览器验证；PLAYWRIGHT_BROWSER_CHANNEL 可选择本机浏览器 channel，如 msedge。

官方依据：[购物车提交后、付款前的脚本事件](https://help.tilda.cc/tips/javascript)、[T123 嵌入 HTML](https://help.tilda.cc/html)。原生提交包装还覆盖了不触发 submit 事件的 form.submit()，并仅针对本站支付入口。
