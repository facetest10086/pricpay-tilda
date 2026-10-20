# 在 Tilda 建立俄文支付返回页面

已提供两份自包含的 T123 模板，包含 HTML、局部 CSS 和内嵌 Lucide 图标，不依赖外部图片、字体或脚本：

| 页面 | 模板文件 | Tilda 页面地址路径 | 最终网址 |
|---|---|---|---|
| 支付后返回页 | [payment-success.html](payment-success.html) | `payment-success` | `https://hoteltoiletries.ru/payment-success` |
| 未完成支付返回页 | [payment-failed.html](payment-failed.html) | `payment-failed` | `https://hoteltoiletries.ru/payment-failed` |

当前文件只是在本地准备好的模板，还没有添加或发布到你的 Tilda 网站。浏览器工具因 URL 安全策略禁止 file:// 预览，未完成浏览器视觉检查；静态检查不能代替发布后的显示确认。

## 1. 建立 payment-success 页面

1. 进入 hoteltoiletries.ru 对应的 Tilda 项目，新建空白页面。
2. 打开 Page Settings，页面标题可填写 `Спасибо за заказ`，页面地址路径填写 `payment-success`。
3. 添加 Block Library → Other → **T123 / Embed HTML code**。
4. 将 `payment-success.html` 的全部内容放入该 T123 的代码输入框，保存。
5. 发布页面，直接打开 `https://hoteltoiletries.ru/payment-success`，确认能显示俄文结果页面，而不是 404。

T123 中的自定义代码可能在编辑或预览状态只显示为代码，应以已发布页面为准。

## 2. 建立 payment-failed 页面

按相同步骤新建页面，标题可填写 `Оплата не завершена`，页面地址路径填写 `payment-failed`，T123 中使用 `payment-failed.html` 的全部内容。

发布后打开 `https://hoteltoiletries.ru/payment-failed`，确认页面可访问。

这两个页面只展示结果提示并链接回真实店铺，不会修改订单状态、发起重试付款或调用网关 API。

## 3. 填入支付模板的 Additional field list

| Field | Value |
|---|---|
| `successUrl` | `https://hoteltoiletries.ru/payment-success` |
| `failUrl` | `https://hoteltoiletries.ru/payment-failed` |

字段名是 `successUrl`，不是 `successl`。不要把本网关 `/api/pricpay/return` 填成成功页面。

## 4. 发布后检查

- 两个地址都能直接打开，页面中文字没有乱码。
- 手机窄屏下标题、正文和按钮不溢出或重叠。
- 键盘 Tab 能聚焦店铺链接和返回按钮，焦点可见。
- 返回按钮进入 `https://hoteltoiletries.ru/`。
- 页面没有宣称“访问到这里就已经收款”。实际支付结果仍由服务端验证通知决定。

模板使用俄罗斯语内容和独立 class 前缀，降低与 Tilda 页面已有样式冲突的可能性；实际站点主题仍需发布后核对。Lucide 的授权声明已保留在每份 HTML 的注释里。

官方操作依据：[Tilda 创建 Thank You Page](https://help.tilda.cc/thank-you-page)、[T123 嵌入 HTML](https://help.tilda.cc/html)。
