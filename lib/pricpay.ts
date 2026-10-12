import crypto from 'node:crypto'

export type TildaOrder = Record<string, unknown>

const config = {
  merchantNo: process.env.PRICPAY_MERCHANT_NO ?? '',
  secret: process.env.PRICPAY_SECRET ?? '',
  pubId: process.env.PRICPAY_PUB_ID ?? '',
  mode: process.env.PRICPAY_MODE ?? 'HPP',
  paymentMethodCode: process.env.PRICPAY_PAYMENT_METHOD ?? 'CardEmbed',
  website: process.env.PRICPAY_MERCHANT_WEBSITE ?? '',
  gateway: 'https://gateway.pricpay.com/payment/gateway/payapi/v2/checkout',
}

function value(order: TildaOrder, ...keys: string[]) {
  for (const key of keys) {
    const result = order[key]
    if (result !== undefined && result !== null && String(result).trim() !== '') return String(result)
  }
  return ''
}

function sortedString(params: Record<string, unknown>) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&') + '&'
}

export function sign(params: Record<string, unknown>) {
  return crypto.createHash('md5').update(`${sortedString(params)}secret=${config.secret.trim()}`).digest('hex').toUpperCase()
}

export function verifySignature(params: Record<string, unknown>) {
  const supplied = value(params, 'signature', 'sign').toUpperCase()
  if (!supplied || !config.secret) return false
  const copy = { ...params }
  delete copy.signature
  delete copy.sign
  const expected = sign(copy)
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

function productInformation(order: TildaOrder) {
  const raw = order.products ?? order.items ?? order.productInformation
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return JSON.stringify(raw)
  return JSON.stringify([{ goodsName: value(order, 'description', 'product', 'title') || 'Order', goodsPrice: value(order, 'amount', 'sum'), quantity: 1 }])
}

export function buildPricpayOrder(order: TildaOrder, requestUrl: string) {
  const orderNumber = value(order, 'orderid', 'orderId', 'order_number', 'orderNumber', 'id')
  const amount = value(order, 'amount', 'sum', 'price', 'total')
  const currency = value(order, 'currency', 'currencyCode') || 'USD'
  const tildaNotify = value(order, 'notifyUrl', 'notificationUrl') || process.env.TILDA_NOTIFY_URL || ''
  const notifyUrl = `${new URL('/api/pricpay/notify', requestUrl).toString()}?target=${encodeURIComponent(tildaNotify)}&order=${encodeURIComponent(orderNumber)}&amount=${encodeURIComponent(amount)}`
  const params: Record<string, unknown> = {
    websiteVersionNumber: 'V1.0', signType: 'MD5', mode: config.mode,
    paymentMethodCode: config.paymentMethodCode, merchantNo: config.merchantNo,
    merchantOrderDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
    orderNumber, merchantWebsite: config.website || new URL(requestUrl).origin,
    transactionAmount: amount, transactionCurrency: currency, notifyUrl,
    returnUrl: value(order, 'returnUrl', 'successUrl') || new URL('/api/pricpay/return', requestUrl).toString(),
    ip: value(order, 'ip', 'userIp'), billingCountry: value(order, 'country', 'billingCountry'),
    billingState: value(order, 'state', 'billingState'), billingCity: value(order, 'city', 'billingCity'),
    billingAddress: value(order, 'address', 'billingAddress'), billingZip: value(order, 'zip', 'billingZip'),
    billingFirstName: value(order, 'name', 'firstName', 'billingFirstName'), billingLastName: value(order, 'lastName', 'billingLastName'),
    billingTelephone: value(order, 'phone', 'telephone', 'billingTelephone'), billingEmail: value(order, 'email', 'billingEmail'),
    productInformation: productInformation(order), pubId: config.pubId,
  }
  return { ...params, signature: sign(params) }
}

export { config }
export { value }

export async function createPricpayCheckout(order: TildaOrder, requestUrl: string) {
  const payload = buildPricpayOrder(order, requestUrl)
  const isHpp = config.mode.toUpperCase() === 'HPP'
  const endpoint = isHpp
    ? 'https://gateway.pricpay.com/payment/gateway/payapi/cache-merchant-info'
    : config.gateway
  const requestPayload = isHpp
    ? (() => {
        const { mode, paymentMethodCode, pubId, ...cashierPayload } = payload
        return { ...cashierPayload, signature: sign(cashierPayload) }
      })()
    : payload
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestPayload),
    cache: 'no-store',
  })
  const raw = await response.text()
  if (!response.ok) throw new Error(`PricPay checkout creation failed (${response.status})`)
  if (isHpp) {
    const cashier = raw.trim()
    if (!cashier) throw new Error('PricPay returned an empty cashier token')
    return { target: `https://cashier.pricpay.com?cashier=${encodeURIComponent(cashier)}`, orderNo: value(order, 'orderid', 'orderId', 'order_number', 'orderNumber', 'id') }
  }
  const data = JSON.parse(raw)
  if (data.code !== 200 || !data.data) throw new Error(data.message || 'PricPay checkout creation failed')
  const target = data.data.directFlag === 1 && data.data.thirdUrl ? data.data.thirdUrl : `${data.data.shopUrl}?orderFlag=b&orderNo=${encodeURIComponent(data.data.orderNo)}`
  return { target, orderNo: data.data.orderNo }
}

export function toTildaNotification(params: Record<string, unknown>, target: string, order: string, amount: string) {
  return { orderid: order || value(params, 'orderNumber', 'orderNo'), amount: amount || value(params, 'transactionAmount', 'amount'), paid: 'true', signature: sign({ orderid: order, amount, paid: 'true' }), target }
}

export function isConfigured() {
  const commonConfigured = Boolean(config.merchantNo && config.secret)
  return config.mode.toUpperCase() === 'HPP' ? commonConfigured : Boolean(commonConfigured && config.pubId)
}

export function parseBody(raw: string, contentType: string): TildaOrder {
  if (contentType.includes('application/json')) return JSON.parse(raw) as TildaOrder
  return Object.fromEntries(new URLSearchParams(raw).entries())
}

export function postForm(target: string, params: Record<string, unknown>) {
  return fetch(target, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) })
}

export function safeCompare(a: string, b: string) { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) }

export { safeCompare as timingSafeCompare }
