import crypto from 'node:crypto'

export type TildaOrder = Record<string, unknown>
export type PricpayCreateMode = 'create' | 'cashier'

type PricpayConfig = {
  merchantNo: string
  secret: string
  pubId: string
  createMode: string
  paymentMethodCode: string
  website: string
  createEndpoint: string
  cashierEndpoint: string
  cashierBaseUrl: string
  tildaNotifySecret: string
}

export type PreparedPricpayCheckout = {
  mode: PricpayCreateMode
  endpoint: string
  orderNumber: string
  requestPayload: Record<string, unknown>
  signatureBase: string
  signatureResult: string
  notifyUrl: string
  returnUrl: string
}

export type PricpayCheckoutResult = {
  mode: PricpayCreateMode
  target: string
  redirectUrl: string
  orderNumber: string
  pricpayOrderNo?: string
  endpoint: string
  requestPayload: Record<string, unknown>
  responseBody: unknown
  rawResponse: string
  httpStatus: number
}

export type TildaGatewayUrls = {
  notifyUrl: string
  successUrl: string
  failureUrl: string
  pendingUrl: string
}

const defaultCreateEndpoint = 'https://gateway.pricpay.com/payment/gateway/payapi/v2/checkout'
const defaultCashierEndpoint = 'https://gateway.pricpay.com/payment/gateway/payapi/cache-merchant-info'
const defaultCashierBaseUrl = 'https://cashier.pricpay.com'

const config: PricpayConfig = {
  merchantNo: process.env.PRICPAY_MERCHANT_NO ?? '',
  secret: process.env.PRICPAY_SECRET ?? '',
  pubId: process.env.PRICPAY_PUB_ID ?? '',
  createMode: process.env.PRICPAY_CREATE_MODE ?? (process.env.PRICPAY_MODE?.toUpperCase() === 'HPP' ? 'EPP' : process.env.PRICPAY_MODE ?? 'EPP'),
  paymentMethodCode: process.env.PRICPAY_PAYMENT_METHOD ?? 'CardEmbed',
  website: process.env.PRICPAY_MERCHANT_WEBSITE ?? '',
  createEndpoint: process.env.PRICPAY_CREATE_ENDPOINT ?? defaultCreateEndpoint,
  cashierEndpoint: process.env.PRICPAY_CASHIER_ENDPOINT ?? defaultCashierEndpoint,
  cashierBaseUrl: process.env.PRICPAY_CASHIER_BASE_URL ?? defaultCashierBaseUrl,
  tildaNotifySecret: process.env.TILDA_NOTIFY_SECRET ?? process.env.TILDA_ORDER_SECRET ?? '',
}

export { config }

export function value(order: TildaOrder, ...keys: string[]) {
  for (const key of keys) {
    const result = order[key]
    if (result !== undefined && result !== null && String(result).trim() !== '') return String(result)
  }
  return ''
}

function withoutSignature(params: Record<string, unknown>) {
  const copy = { ...params }
  delete copy.signature
  delete copy.sign
  return copy
}

function sortedString(params: Record<string, unknown>) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&') + '&'
}

export function signatureBase(params: Record<string, unknown>) {
  return `${sortedString(withoutSignature(params))}secret=[REDACTED]`
}

export function sign(params: Record<string, unknown>, secret = config.secret) {
  return crypto.createHash('md5').update(`${sortedString(withoutSignature(params))}secret=${secret.trim()}`).digest('hex').toUpperCase()
}

export function verifySignature(params: Record<string, unknown>, secret = config.secret) {
  const supplied = value(params, 'signature', 'sign').toUpperCase()
  if (!supplied || !secret) return false
  const expected = sign(params, secret)
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

function productInformation(order: TildaOrder) {
  const raw = order.products ?? order.items ?? order.productInformation
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return JSON.stringify(raw)
  return JSON.stringify([
    {
      goodsName: value(order, 'description', 'product', 'title') || 'Order',
      goodsPrice: value(order, 'amount', 'sum'),
      quantity: 1,
    },
  ])
}

export function getOrderNumber(order: TildaOrder) {
  return value(order, 'orderid', 'orderId', 'order_number', 'orderNumber', 'id')
}

export function getOrderAmount(order: TildaOrder) {
  return value(order, 'amount', 'sum', 'price', 'total')
}

export function getOrderCurrency(order: TildaOrder) {
  return value(order, 'currency', 'currencyCode') || 'USD'
}

function merchantOrderDate(order: TildaOrder) {
  const orderTime = value(order, 'orderTime').trim()
  if (!orderTime) return new Date().toISOString().slice(0, 19).replace('T', ' ')

  const isoTime = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
  const parsed = new Date(orderTime)
  if (!isoTime.test(orderTime) || Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid Tilda orderTime: expected ISO-8601 with a timezone')
  }

  // Date parsing can roll impossible dates such as February 30 into March.
  const calendarDate = new Date(`${orderTime.slice(0, 10)}T00:00:00Z`)
  if (calendarDate.toISOString().slice(0, 10) !== orderTime.slice(0, 10)) {
    throw new Error('Invalid Tilda orderTime: calendar date does not exist')
  }

  return parsed.toISOString().slice(0, 19).replace('T', ' ')
}

export function getTildaGatewayUrls(order: TildaOrder): TildaGatewayUrls {
  return {
    notifyUrl: value(order, 'notifyUrl', 'notificationUrl', 'tildaNotifyUrl') || process.env.TILDA_NOTIFY_URL || '',
    successUrl: value(order, 'successUrl', 'returnUrl', 'url_success', 'tildaSuccessUrl') || process.env.TILDA_SUCCESS_URL || '',
    failureUrl: value(order, 'failUrl', 'failureUrl', 'url_fail', 'tildaFailureUrl') || process.env.TILDA_FAILURE_URL || '',
    pendingUrl: value(order, 'pendingUrl', 'url_pending', 'tildaPendingUrl') || process.env.TILDA_PENDING_URL || '',
  }
}

export function buildGatewayNotifyUrl(requestUrl: string, orderNumber: string) {
  const url = new URL('/api/pricpay/notify', requestUrl)
  if (orderNumber) url.searchParams.set('order', orderNumber)
  return url.toString()
}

export function buildGatewayReturnUrl(requestUrl: string, orderNumber: string) {
  const url = new URL('/api/pricpay/return', requestUrl)
  if (orderNumber) url.searchParams.set('order', orderNumber)
  return url.toString()
}

function buildPricpayOrder(order: TildaOrder, requestUrl: string, mode: PricpayCreateMode) {
  const orderNumber = getOrderNumber(order)
  const amount = getOrderAmount(order)
  const currency = getOrderCurrency(order)
  const notifyUrl = buildGatewayNotifyUrl(requestUrl, orderNumber)
  const returnUrl = buildGatewayReturnUrl(requestUrl, orderNumber)
  const params: Record<string, unknown> = {
    websiteVersionNumber: 'V1.0',
    signType: 'MD5',
    merchantNo: config.merchantNo,
    merchantOrderDate: merchantOrderDate(order),
    orderNumber,
    merchantWebsite: config.website || new URL(requestUrl).origin,
    transactionAmount: amount,
    transactionCurrency: currency,
    notifyUrl,
    returnUrl,
    ip: value(order, 'ip', 'userIp'),
    billingCountry: value(order, 'customerCountry', 'billingCountry', 'country').trim().toUpperCase(),
    billingState: value(order, 'state', 'billingState'),
    billingCity: value(order, 'city', 'billingCity'),
    billingAddress: value(order, 'address', 'billingAddress'),
    billingZip: value(order, 'zip', 'billingZip'),
    billingFirstName: value(order, 'firstName', 'billingFirstName', 'name'),
    billingLastName: value(order, 'lastName', 'billingLastName'),
    billingTelephone: value(order, 'phone', 'telephone', 'billingTelephone'),
    billingEmail: value(order, 'email', 'billingEmail'),
    productInformation: productInformation(order),
  }

  if (mode === 'create') {
    params.mode = config.createMode
    params.paymentMethodCode = config.paymentMethodCode
    params.pubId = config.pubId
  }

  return { params, notifyUrl, returnUrl }
}

export function preparePricpayCheckout(order: TildaOrder, requestUrl: string, mode: PricpayCreateMode): PreparedPricpayCheckout {
  const { params, notifyUrl, returnUrl } = buildPricpayOrder(order, requestUrl, mode)
  const requestPayload = { ...params, signature: sign(params) }

  return {
    mode,
    endpoint: mode === 'cashier' ? config.cashierEndpoint : config.createEndpoint,
    orderNumber: getOrderNumber(order),
    requestPayload,
    signatureBase: signatureBase(params),
    signatureResult: String(requestPayload.signature),
    notifyUrl,
    returnUrl,
  }
}

export async function submitPricpayCheckout(prepared: PreparedPricpayCheckout): Promise<PricpayCheckoutResult> {
  const response = await fetch(prepared.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prepared.requestPayload),
    cache: 'no-store',
  })
  const raw = await response.text()

  if (!response.ok) {
    throw new Error(`PricPay checkout creation failed (${response.status})`)
  }

  if (prepared.mode === 'cashier') {
    const cashier = raw.trim()
    if (!cashier) throw new Error('PricPay returned an empty cashier token')
    const target = `${config.cashierBaseUrl}?cashier=${encodeURIComponent(cashier)}`
    return {
      mode: prepared.mode,
      target,
      redirectUrl: target,
      orderNumber: prepared.orderNumber,
      endpoint: prepared.endpoint,
      requestPayload: prepared.requestPayload,
      responseBody: { cashier: '[REDACTED]' },
      rawResponse: '[REDACTED]',
      httpStatus: response.status,
    }
  }

  let data: Record<string, any>
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('PricPay returned a non-JSON checkout response')
  }

  if (data.code !== 200 || !data.data) {
    throw new Error(String(data.message || 'PricPay checkout creation failed'))
  }

  const pricpayOrderNo = String(data.data.orderNo ?? '')
  const target =
    data.data.directFlag === 1 && data.data.thirdUrl
      ? String(data.data.thirdUrl)
      : `${data.data.shopUrl}?orderFlag=b&orderNo=${encodeURIComponent(pricpayOrderNo)}`

  return {
    mode: prepared.mode,
    target,
    redirectUrl: target,
    orderNumber: prepared.orderNumber,
    pricpayOrderNo,
    endpoint: prepared.endpoint,
    requestPayload: prepared.requestPayload,
    responseBody: data,
    rawResponse: raw,
    httpStatus: response.status,
  }
}

export async function createPricpayCheckout(order: TildaOrder, requestUrl: string, mode: PricpayCreateMode) {
  return submitPricpayCheckout(preparePricpayCheckout(order, requestUrl, mode))
}

export function toTildaNotification(params: Record<string, unknown>, target: string, order: string, amount: string) {
  if (!order || !amount) throw new Error('Verified order and normalized amount are required for Tilda notification')
  const body: Record<string, unknown> = {
    orderid: order,
    amount,
    paid: 'true',
    transactionid: value(params, 'platformOrderNo', 'orderNo'),
  }
  const secret = config.tildaNotifySecret || config.secret
  body.signature = sign(body, secret)
  body.target = target
  return body
}

export function isConfigured(mode: PricpayCreateMode) {
  const commonConfigured = Boolean(config.merchantNo && config.secret)
  return mode === 'cashier' ? commonConfigured : Boolean(commonConfigured && config.pubId)
}

export function parseBody(raw: string, contentType: string): TildaOrder {
  if (!raw) return {}
  if (contentType.includes('application/json')) return JSON.parse(raw) as TildaOrder
  return Object.fromEntries(new URLSearchParams(raw).entries())
}

export function postForm(target: string, params: Record<string, unknown>) {
  return fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(params).map(([key, entry]) => [key, String(entry)])),
  })
}

export function pricpayStatusToOrderStatus(orderStatus: string) {
  if (orderStatus === '100') return 'paid'
  if (orderStatus === '103') return 'pending'
  if (orderStatus === '120') return 'failed'
  return orderStatus ? `pricpay_${orderStatus}` : 'notified'
}

export function safeCompare(a: string, b: string) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export { safeCompare as timingSafeCompare }
