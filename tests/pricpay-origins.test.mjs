import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.TILDA_SITE_ORIGIN = 'https://shop.example.test'
process.env.PRICPAY_MERCHANT_WEBSITE = 'https://gateway.example.test'
process.env.PRICPAY_SECRET = 'test-only-key'
const { config, preparePricpayCheckout, verifySignature } = await import('../lib/pricpay.ts')
const order = { orderid: '123:456', amount: '10.00', currency: 'RUB' }

for (const mode of ['cashier', 'create']) {
  test(`${mode}: merchant website and public gateway callbacks use their own configured domains`, () => {
    const { requestPayload } = preparePricpayCheckout(order, `https://preview.example.test/api/pricpay/${mode}`, mode)
    assert.equal(requestPayload.merchantWebsite, 'https://shop.example.test')
    for (const [key, path] of [['notifyUrl', '/api/pricpay/notify'], ['returnUrl', '/api/pricpay/return']]) {
      const url = new URL(requestPayload[key])
      assert.equal(url.origin, 'https://gateway.example.test')
      assert.equal(url.pathname, path)
      assert.equal(url.searchParams.get('order'), order.orderid)
    }
    assert.equal(verifySignature(requestPayload), true)
  })

  test(`${mode}: migrating the gateway preserves the merchant website and signs the new callback URLs`, (t) => {
    const previous = { ...config }
    t.after(() => Object.assign(config, previous))
    const requestUrl = `https://preview.example.test/api/pricpay/${mode}`
    const original = preparePricpayCheckout(order, requestUrl, mode).requestPayload
    config.gatewayOrigin = 'https://migrated-gateway.example.test/'
    const migrated = preparePricpayCheckout(order, requestUrl, mode).requestPayload
    assert.equal(migrated.merchantWebsite, 'https://shop.example.test')
    assert.equal(new URL(migrated.notifyUrl).origin, 'https://migrated-gateway.example.test')
    assert.equal(new URL(migrated.returnUrl).origin, 'https://migrated-gateway.example.test')
    assert.notEqual(migrated.signature, original.signature)
    assert.equal(verifySignature(migrated), true)
    config.gatewayOrigin = ''
    const inferred = preparePricpayCheckout(order, requestUrl, mode).requestPayload
    assert.equal(inferred.merchantWebsite, 'https://shop.example.test')
    assert.equal(new URL(inferred.notifyUrl).origin, 'https://preview.example.test')
    assert.equal(new URL(inferred.returnUrl).origin, 'https://preview.example.test')
  })
}
