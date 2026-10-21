import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePricpayReturn } from '../lib/pricpay-return.ts'

const order = {
  tildaSuccessUrl: 'https://shop.example.test/success',
  tildaFailureUrl: 'https://shop.example.test/failed',
  tildaPendingUrl: null,
}
const requestUrl = 'https://gateway.example.test/api/pricpay/return'

for (const reportedStatus of ['', 'PROCESSING', '103', 'SUCCESS', '100', 'unexpected']) {
  test(`unverified return ${JSON.stringify(reportedStatus)} cannot display payment success`, () => {
    const result = resolvePricpayReturn({ order, reportedStatus, verifiedPaid: false, requestUrl,
      defaults: { successUrl: 'https://shop.example.test/success' } })
    assert.equal(result.status, 'pending')
    assert.equal(result.target, 'https://shop.example.test/')
  })
}

for (const reportedStatus of ['120', 'FAILED', 'FAILURE', 'DECLINED', 'CANCEL', 'CANCELLED', 'CANCELED']) {
  test(`unpaid return ${reportedStatus} uses the failure page`, () => {
    const result = resolvePricpayReturn({ order, reportedStatus, verifiedPaid: false, requestUrl })
    assert.equal(result.target, order.tildaFailureUrl)
    assert.ok(['failed', 'cancelled'].includes(result.status))
  })
}

test('a verified payment takes precedence over stale browser cancellation', () => {
  const result = resolvePricpayReturn({ order, reportedStatus: 'CANCELLED', verifiedPaid: true, requestUrl })
  assert.deepEqual(result, { status: 'paid', target: order.tildaSuccessUrl })
})

test('unconfirmed payment uses an explicit pending page and never the success fallback', () => {
  const result = resolvePricpayReturn({ order: { ...order, tildaPendingUrl: 'https://shop.example.test/pending' },
    reportedStatus: 'SUCCESS', verifiedPaid: false, requestUrl })
  assert.deepEqual(result, { status: 'pending', target: 'https://shop.example.test/pending' })
})

test('missing orders and missing failure URLs return to the configured store', () => {
  for (const reportedStatus of ['', '100', 'FAILED', 'CANCELLED']) {
    const result = resolvePricpayReturn({ reportedStatus, verifiedPaid: false, requestUrl,
      defaults: { siteOrigin: 'https://another-shop.example.test', successUrl: order.tildaSuccessUrl } })
    assert.equal(result.target, 'https://another-shop.example.test/')
    assert.notEqual(result.status, 'paid')
  }
})
