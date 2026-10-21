type OriginalPayment = {
  transactionAmount: string | null
  transactionCurrency: string | null
}

function scaledAmount(input: unknown) {
  if (typeof input !== 'string' || !/^\d{1,30}(?:\.\d{1,8})?$/.test(input)) {
    throw new Error('Invalid payment amount: expected a positive decimal string with at most 8 decimal places')
  }
  const [whole, fraction = ''] = input.split('.')
  return BigInt(whole + fraction.padEnd(8, '0'))
}

function currencyCode(input: unknown) {
  const currency = typeof input === 'string' ? input.trim().toUpperCase() : ''
  if (!Intl.supportedValuesOf('currency').includes(currency)) throw new Error('Missing or unsupported payment currency')
  return currency
}

export function normalizeNotificationAmount(
  params: Record<string, unknown>,
  order: OriginalPayment,
  amountUnit: string,
) {
  if (amountUnit !== 'minor' && amountUnit !== 'major') throw new Error('Invalid PRICPAY_NOTIFY_AMOUNT_UNIT: use minor or major')
  const currency = currencyCode(order.transactionCurrency)
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
  if (digits === undefined || digits > 8) throw new Error('Unsupported payment currency precision')
  const divisor = BigInt('1' + '0'.repeat(digits))
  const precision = BigInt('1' + '0'.repeat(8 - digits))
  const original = scaledAmount(order.transactionAmount)
  if (original <= BigInt(0) || original % precision !== BigInt(0)) throw new Error('Original order amount has invalid currency precision')
  const currencies = ['transactionCurrency', 'currency'].filter((key) => params[key] !== undefined && params[key] !== '')
  if (!currencies.length || currencies.some((key) => currencyCode(params[key]) !== currency)) {
    throw new Error('Notification currency does not match the original order')
  }
  const amounts = ['transactionAmount', 'amount'].filter((key) => params[key] !== undefined && params[key] !== '')
  if (!amounts.length) throw new Error('Notification amount is missing')
  for (const key of amounts) {
    const received = scaledAmount(params[key])
    const minor = key === 'amount' && amountUnit === 'minor'
    if (minor && received % BigInt(100000000) !== BigInt(0)) throw new Error('Notification contains fractional minor units')
    if ((minor ? received / divisor : received) !== original) {
      throw new Error('Notification amount does not match the original order')
    }
  }
  const units = original / precision
  const whole = (units / divisor).toString()
  const fraction = (units % divisor).toString().padStart(digits, '0')
  return { amount: digits ? `${whole}.${fraction}` : whole, currency, amountUnit }
}

export function isTildaNotificationAccepted(status: number, body: string) {
  return status >= 200 && status < 300 && body.trim() === 'OK'
}
