import assert from 'node:assert/strict'
import { test } from 'node:test'

const { config, isConfigured, preparePricpayCheckout, verifySignature } = await import('../lib/pricpay.ts')

for (const [createMode, paymentMethodCode, pubId, ready] of [
  ['HPP', 'CARD', '', true],
  ['HPP', 'CardRussia', 'unused-legacy-pub-id', true],
  ['EPP', 'CardEmbed', '', false],
  ['EPP', 'CardEmbed', 'test-pre-form-pub-id', true],
]) {
  test(`${createMode}/${paymentMethodCode} ${pubId ? 'with' : 'without'} pubId respects its mode requirements`, (t) => {
    const previous = { ...config }
    t.after(() => Object.assign(config, previous))
    Object.assign(config, { merchantNo: 'TEST_MERCHANT', secret: 'test-only-key', createMode, paymentMethodCode, pubId })
    assert.equal(isConfigured('create'), ready)
    assert.equal(isConfigured('cashier'), true)
    const order = { orderid: '123:456', amount: '10.00', currency: 'RUB' }
    const payload = preparePricpayCheckout(order, 'https://gateway.example.test/api/pricpay/create', 'create').requestPayload
    assert.equal(payload.mode, createMode)
    assert.equal(payload.paymentMethodCode, paymentMethodCode)
    if (createMode === 'HPP') assert.equal(Object.hasOwn(payload, 'pubId'), false)
    else assert.equal(payload.pubId, pubId)
    assert.equal(payload.transactionAmount, '10.00')
    assert.equal(verifySignature(payload), true)
    const cashier = preparePricpayCheckout(order, 'https://gateway.example.test/api/pricpay/cashier', 'cashier').requestPayload
    for (const key of ['mode', 'paymentMethodCode', 'pubId']) assert.equal(Object.hasOwn(cashier, key), false)
  })
}
