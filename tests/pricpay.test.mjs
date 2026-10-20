import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.PRICPAY_MERCHANT_NO = 'TEST_MERCHANT'
process.env.PRICPAY_SECRET = 'test-only-not-a-real-secret'
const { parseBody, preparePricpayCheckout } = await import('../lib/pricpay.ts')

const requestUrl = 'https://gateway.example.test/api/pricpay/cashier'
const baseOrder = { orderid: '123:456', amount: '1490.00', currency: 'RUB' }

for (const mode of ['cashier', 'create']) {
  test(`${mode}: customer fields override the old full name and configured GB country`, () => {
    const order = parseBody(new URLSearchParams({
      ...baseOrder,
      firstName: 'Ivan',
      lastName: 'Ivanov',
      name: 'Old full name',
      customerCountry: ' ru ',
      country: 'GB',
      billingCountry: 'US',
      state: 'Moscow Oblast',
      city: 'Moscow',
      address: 'Example Street 12',
      zip: '001234',
      phone: '+79991234567',
      email: 'buyer@example.test',
      orderTime: '2026-10-20T10:15:30+03:00',
    }).toString(), 'application/x-www-form-urlencoded')
    const { requestPayload } = preparePricpayCheckout(order, requestUrl, mode)

    assert.deepEqual({
      firstName: requestPayload.billingFirstName,
      lastName: requestPayload.billingLastName,
      country: requestPayload.billingCountry,
      state: requestPayload.billingState,
      city: requestPayload.billingCity,
      address: requestPayload.billingAddress,
      zip: requestPayload.billingZip,
      phone: requestPayload.billingTelephone,
      email: requestPayload.billingEmail,
    }, {
      firstName: 'Ivan', lastName: 'Ivanov', country: 'RU',
      state: 'Moscow Oblast', city: 'Moscow', address: 'Example Street 12',
      zip: '001234', phone: '+79991234567', email: 'buyer@example.test',
    })
  })
}

for (const [label, fields, expectedName, expectedCountry] of [
  ['legacy fields', { name: 'Legacy buyer', country: 'GB' }, 'Legacy buyer', 'GB'],
  ['explicit billing fields', { billingFirstName: 'Billing buyer', billingCountry: 'RU', name: 'Legacy buyer', country: 'GB' }, 'Billing buyer', 'RU'],
  ['empty new fields', { firstName: ' ', customerCountry: '', name: 'Legacy buyer', country: 'GB' }, 'Legacy buyer', 'GB'],
]) {
  test(`${label} remain usable when customer fields are absent`, () => {
    const { requestPayload } = preparePricpayCheckout({ ...baseOrder, ...fields }, requestUrl, 'cashier')
    assert.equal(requestPayload.billingFirstName, expectedName)
    assert.equal(requestPayload.billingCountry, expectedCountry)
  })
}

for (const [orderTime, expected] of [
  ['2026-10-20T10:15:30.123Z', '2026-10-20 10:15:30'],
  ['2026-01-01T01:15:30+03:00', '2025-12-31 22:15:30'],
  ['2026-12-31T23:15:30-05:00', '2027-01-01 04:15:30'],
  ['2024-02-29T10:15:30Z', '2024-02-29 10:15:30'],
]) {
  test(`Tilda time ${orderTime} becomes the UTC merchant order date`, () => {
    for (const mode of ['cashier', 'create']) {
      const { requestPayload } = preparePricpayCheckout({ ...baseOrder, orderTime }, requestUrl, mode)
      assert.equal(requestPayload.merchantOrderDate, expected)
    }
  })
}

for (const orderTime of [
  'orderTime', '2026-02-30T10:15:30Z', '2026-02-29T10:15:30Z',
  '2026-10-20T10:15:30', '2026-10-20T24:00:00Z',
  '2026-10-20T10:15:30+25:00',
]) {
  test(`invalid or ambiguous Tilda time ${orderTime} cannot create a payment`, () => {
    assert.throws(
      () => preparePricpayCheckout({ ...baseOrder, orderTime }, requestUrl, 'cashier'),
      /Invalid Tilda orderTime/,
    )
  })
}

test('old requests without an order time retain the server time fallback', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T06:30:45Z') })
  const { requestPayload } = preparePricpayCheckout(baseOrder, requestUrl, 'cashier')
  assert.equal(requestPayload.merchantOrderDate, '2026-10-20 06:30:45')
})
