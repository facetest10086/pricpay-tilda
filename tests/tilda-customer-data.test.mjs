import assert from 'node:assert/strict'
import { test } from 'node:test'

const { parseCustomerSubmission, resolveCustomerOrder, customerTokenHash } = await import('../lib/tilda-customer-data.ts')
const token = 'a'.repeat(64)
const customer = {
  firstName: 'Ivan', lastName: 'Ivanov', customerCountry: 'ru',
  state: 'Moscow Oblast', city: 'Moscow', address: 'Example Street 12', zip: '001234',
  email: 'buyer@example.test', phone: '+79991234567',
}

test('normalizes a real form submission and rejects placeholder values', () => {
  const submission = parseCustomerSubmission({ orderId: '38252103:123', token, customer })
  assert.equal(submission.customer.customerCountry, 'RU')
  assert.equal(submission.customer.zip, '001234')
  assert.equal(submission.tokenHash, customerTokenHash(token))
  for (const field of ['firstName', 'lastName', 'city', 'address', 'zip', 'customerCountry']) {
    assert.throws(() => parseCustomerSubmission({
      orderId: '38252103:123', token, customer: { ...customer, [field]: field },
    }), /Invalid customer field/)
  }
})

test('rejects malformed IDs and missing correlation tokens', () => {
  for (const orderId of ['123', '0:123', '38252103:0', '../orders']) {
    assert.throws(() => parseCustomerSubmission({ orderId, token, customer }), /order ID/)
  }
  assert.throws(() => parseCustomerSubmission({ orderId: '38252103:123', customer }), /token/)
})

test('preserves a multiline address as one billing address without accepting control characters', () => {
  const submission = parseCustomerSubmission({ orderId: '38252103:123', token,
    customer: { ...customer, address: 'Example Street 12\nApartment 3' } })
  assert.equal(submission.customer.address, 'Example Street 12, Apartment 3')
  assert.throws(() => parseCustomerSubmission({ orderId: '38252103:123', token,
    customer: { ...customer, firstName: 'Ivan\u0000' } }), /Invalid customer field/)
})

test('joins only the exact order and token and never imports payment fields from customer storage', async () => {
  const order = {
    orderid: '38252103:123', customerDataToken: token,
    amount: '1490.00', currency: 'RUB', signature: 'TILDA_SIGNATURE',
    name: 'Old name', country: 'GB', firstName: 'firstName', zip: 'zip',
  }
  const resolved = await resolveCustomerOrder(order, async (orderId, hash) => {
    return orderId === '38252103:123' && hash === customerTokenHash(token)
      ? { ...customer, amount: '0.01', currency: 'USD', signature: 'FAKE', orderid: 'WRONG' }
      : undefined
  })
  assert.equal(resolved.firstName, 'Ivan')
  assert.equal(resolved.customerCountry, 'RU')
  assert.equal(resolved.zip, '001234')
  assert.equal(resolved.amount, '1490.00')
  assert.equal(resolved.currency, 'RUB')
  assert.equal(resolved.signature, 'TILDA_SIGNATURE')
  assert.equal(resolved.orderid, '38252103:123')
})

test('waits for a late customer-data write before creating a checkout', async () => {
  let calls = 0
  const result = await resolveCustomerOrder({ orderid: '38252103:123', customerDataToken: token },
    async () => ++calls === 1 ? undefined : customer,
    { timeoutMs: 100, pollMs: 1 })
  assert.equal(result.lastName, 'Ivanov')
})

test('missing data, mismatched identity, and database failures cannot silently create a payment', async () => {
  const order = { orderid: '38252103:123', customerDataToken: token, email: 'different@example.test' }
  await assert.rejects(resolveCustomerOrder(order, async () => customer), /email does not match/)
  await assert.rejects(resolveCustomerOrder({ orderid: order.orderid }, async () => customer), /token/)
  await assert.rejects(resolveCustomerOrder(order, async () => undefined,
    { timeoutMs: 10, pollMs: 1 }), /Customer data did not arrive/)
  await assert.rejects(resolveCustomerOrder(order, async () => { throw new Error('database unavailable') }),
    /Customer data is temporarily unavailable/)
})
