import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.TILDA_NOTIFY_SECRET = 'TILDA_DEMO_SECRET'
const { normalizeNotificationAmount, isTildaNotificationAccepted } = await import('../lib/pricpay-notification.ts')
const { toTildaNotification } = await import('../lib/pricpay.ts')

for (const [currency, rawAmount, expectedAmount, result] of [
  ['RUB', '7263589.00000000', '72635.89000000', '72635.89'],
  ['USD', '1990.00000000', '19.90000000', '19.90'],
  ['JPY', '500.00000000', '500.00000000', '500'],
  ['KWD', '1234.00000000', '1.23400000', '1.234'],
  ['RUB', '9007199254740993', '90071992547409.93000000', '90071992547409.93'],
]) {
  test(`${currency}: validates minor-unit callback ${rawAmount} against the original order`, () => {
    const normalized = normalizeNotificationAmount({ amount: rawAmount, currency },
      { transactionAmount: expectedAmount, transactionCurrency: currency }, 'minor')
    assert.equal(normalized.amount, result)
  })
}

test('uses major units only when explicitly configured or in transactionAmount', () => {
  const order = { transactionAmount: '19.90000000', transactionCurrency: 'USD' }
  assert.equal(normalizeNotificationAmount({ amount: '19.90', currency: 'USD' }, order, 'major').amount, '19.90')
  assert.equal(normalizeNotificationAmount({ transactionAmount: '19.90', transactionCurrency: 'USD' }, order, 'minor').amount, '19.90')
  assert.equal(normalizeNotificationAmount({ transactionAmount: '19.90', amount: '1990', currency: 'USD' }, order, 'minor').amount, '19.90')
})

for (const [label, params] of [
  ['does not guess that a major-looking value is in major units', { amount: '100.00', currency: 'RUB' }],
  ['rejects another currency', { amount: '10000', currency: 'USD' }],
  ['rejects conflicting currency aliases', { amount: '10000', currency: 'RUB', transactionCurrency: 'USD' }],
  ['rejects conflicting amount aliases', { amount: '10000', transactionAmount: '1.00', currency: 'RUB' }],
  ['rejects fractional minor units', { amount: '10000.01', currency: 'RUB' }],
  ['rejects a missing amount', { currency: 'RUB' }],
  ['rejects exponent notation', { amount: '1e4', currency: 'RUB' }],
  ['rejects negative amounts', { amount: '-10000', currency: 'RUB' }],
]) {
  test(label, () => {
    assert.throws(() => normalizeNotificationAmount(params,
      { transactionAmount: '100.00000000', transactionCurrency: 'RUB' }, 'minor'))
  })
}

test('cannot approve an order with missing data, unsupported currency, or an invalid unit configuration', () => {
  assert.throws(() => normalizeNotificationAmount({ amount: '10000', currency: 'RUB' },
    { transactionAmount: null, transactionCurrency: 'RUB' }, 'minor'))
  assert.throws(() => normalizeNotificationAmount({ amount: '10000', currency: 'ZZZ' },
    { transactionAmount: '100', transactionCurrency: 'ZZZ' }, 'minor'))
  assert.throws(() => normalizeNotificationAmount({ amount: '10000', currency: 'RUB' },
    { transactionAmount: '100', transactionCurrency: 'RUB' }, 'auto'))
})

test('signs the normalized Tilda amount with the independent notification key', () => {
  const { amount } = normalizeNotificationAmount({ amount: '1990.00000000', currency: 'USD' },
    { transactionAmount: '19.90000000', transactionCurrency: 'USD' }, 'minor')
  const body = toTildaNotification({ platformOrderNo: 'TX-DEMO-001', amount: '1990' },
    'https://example.test/notify', '12345:10001', amount)
  assert.equal(body.amount, '19.90')
  assert.equal(body.signature, 'C20699714DE7CE1E88F2E52D66060C69')
  assert.throws(() => toTildaNotification({}, 'https://example.test/notify', '12345:10001', ''))
})

for (const [status, body, accepted] of [
  [200, 'OK', true], [200, ' OK\n', true],
  [200, 'Signature not correct.', false], [200, '', false],
  [200, 'ERROR', false], [500, 'OK', false], [302, 'OK', false],
]) {
  test(`Tilda response ${status} ${JSON.stringify(body)} is ${accepted ? 'accepted' : 'rejected'}`, () => {
    assert.equal(isTildaNotificationAccepted(status, body), accepted)
  })
}
