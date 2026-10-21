import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { parseCustomerSubmission, resolveCustomerOrder } from '../lib/tilda-customer-data.ts'

process.env.PRICPAY_MERCHANT_NO = 'TEST_MERCHANT'
process.env.PRICPAY_SECRET = 'test-only-not-a-real-secret'
const { parseBody, preparePricpayCheckout } = await import('../lib/pricpay.ts')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const bridgeScript = await readFile(new URL('../public/tilda-customer-data.js', import.meta.url), 'utf8')
const customers = new Map()
const payments = []
const customerResponses = []
const heldKeepalives = new Set()
let shopOrigin
const gateway = createServer(async (request, response) => {
  if (request.url === '/tilda-customer-data.js') {
    response.setHeader('Content-Type', 'application/javascript')
    response.end(bridgeScript)
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  if (request.url === '/keepalive-fixture') {
    heldKeepalives.add(response)
    response.on('close', () => heldKeepalives.delete(response))
    return
  }
  if (request.url === '/api/tilda/customer-data') {
    assert.equal(request.headers.origin, shopOrigin)
    response.setHeader('Access-Control-Allow-Origin', shopOrigin)
    response.setHeader('Content-Type', 'application/json')
    try {
      const submission = parseCustomerSubmission(JSON.parse(body))
      customers.set(`${submission.orderId}:${submission.tokenHash}`, submission.customer)
      customerResponses.push({ status: 200 })
      response.end(JSON.stringify({ ok: true }))
    } catch (error) {
      response.statusCode = error.status || 400
      customerResponses.push({ status: response.statusCode, field: error.field })
      response.end(JSON.stringify({ ok: false, error: error.message, field: error.field }))
    }
    return
  }
  if (request.url === '/api/pricpay/cashier' || request.url === '/api/pricpay/create') {
    const order = parseBody(body, 'application/x-www-form-urlencoded')
    const merged = await resolveCustomerOrder(order, async (id, hash) => customers.get(`${id}:${hash}`))
    const mode = request.url.endsWith('/create') ? 'create' : 'cashier'
    payments.push(preparePricpayCheckout(merged, 'https://gateway.example.test' + request.url, mode).requestPayload)
    response.end('local payment fixture')
    return
  }
  response.statusCode = 404
  response.end()
})
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
const gatewayOrigin = `http://127.0.0.1:${gateway.address().port}`
const shop = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<div id="allrecords" data-tilda-project-id="38252103"></div><form id="cart">
    <input name="firstName" value="\u0410\u043b\u0435\u043a\u0441\u0430\u043d\u0434\u0440"><input name="lastName" value="\u0418\u0432\u0430\u043d\u043e\u0432">
    <input name="customerCountry" value="\u0420\u043e\u0441\u0441\u0438\u044f"><input name="state" value="Test region">
    <input name="city" value="Test city"><input name="address" value="Test street 1"><input name="zip" value="101000">
    <input name="Email" value="buyer@example.test"><input name="Phone" value="+7(999)123-45-67"></form>
    <script src="${gatewayOrigin}/tilda-customer-data.js" defer></script>
    <script src="${gatewayOrigin}/tilda-customer-data.js" defer></script>`)
})
await new Promise((resolve) => shop.listen(0, '127.0.0.1', resolve))
shopOrigin = `http://127.0.0.1:${shop.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined })
  const page = await browser.newPage()
  const dialogs = []
  const errors = []
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
  page.on('pageerror', (error) => errors.push(error.message))
  async function checkout(orderId, invalidField, useRequestSubmit = false, scenario = {}) {
    await page.goto(shopOrigin)
    await page.waitForFunction(() => window.__pricpayCustomerBridge)
    await page.evaluate(({ gatewayOrigin, orderId, invalidField, useRequestSubmit, scenario }) => {
      if (scenario.occupyKeepalive) {
        void fetch(gatewayOrigin + '/keepalive-fixture', {
          method: 'POST', mode: 'no-cors', keepalive: true, body: 'x'.repeat(65536),
        }).catch(() => {})
      }
      const cart = document.getElementById('cart')
      if (invalidField === 'zip') cart.elements.namedItem('zip').value = ''
      if (invalidField === 'customerCountry') cart.elements.namedItem('customerCountry').value = 'unknown country'
      cart.tildaOrderId = scenario.cartOrderId ?? orderId
      if (!scenario.skipCapture) cart.dispatchEvent(new Event('tildaform:aftersuccess', { bubbles: true }))
      const payment = document.createElement('form')
      payment.method = 'POST'
      payment.action = gatewayOrigin + (scenario.paymentPath || '/api/pricpay/cashier')
      for (const [name, value] of Object.entries({ orderid: scenario.paymentOrderId ?? ('38252103:' + orderId), amount: '27596.96', currency: 'RUB',
        country: 'GB', email: 'buyer@example.test', phone: '+79991234567' })) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value
        payment.appendChild(input)
      }
      document.body.appendChild(payment)
      if (useRequestSubmit) payment.requestSubmit()
      else { payment.submit(); payment.submit(); payment.remove() }
      if (scenario.clearCart) { cart.reset(); cart.tildaOrderId = '0'; cart.remove() }
    }, { gatewayOrigin, orderId, invalidField, useRequestSubmit, scenario })
  }
  await checkout('10001')
  await page.waitForURL(`${gatewayOrigin}/api/pricpay/cashier`)
  assert.equal(payments.length, 1)
  assert.equal(payments[0].billingCountry, 'RU')
  assert.equal(payments[0].billingFirstName, '\u0410\u043b\u0435\u043a\u0441\u0430\u043d\u0434\u0440')
  assert.equal(payments[0].billingZip, '101000')
  assert.equal(payments[0].transactionAmount, '27596.96')
  // Production incident: Tilda displayed T202610-1730916364 while the payment form used project:1730916364.
  for (const [paymentPath, useRequestSubmit] of [['/api/pricpay/cashier', false], ['/api/pricpay/create', true]]) {
    const paymentsBefore = payments.length
    await checkout('1730916364', undefined, useRequestSubmit, { cartOrderId: 'T202610-1730916364', paymentPath, clearCart: true })
    await page.waitForURL(gatewayOrigin + paymentPath, { timeout: 5000 })
    assert.equal(payments.length, paymentsBefore + 1)
    assert.equal(payments.at(-1).orderNumber, '38252103:1730916364')
    assert.equal(payments.at(-1).billingFirstName, '\u0410\u043b\u0435\u043a\u0441\u0430\u043d\u0434\u0440')
    assert.equal(payments.at(-1).billingZip, '101000')
    assert.equal(payments.at(-1).transactionAmount, '27596.96')
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await checkout('10002', undefined, true)
  await page.waitForURL(`${gatewayOrigin}/api/pricpay/cashier`)
  assert.equal(payments.length, 4)
  for (const [index, field, label] of [[0, 'zip', '\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u0438\u043d\u0434\u0435\u043a\u0441'], [1, 'customerCountry', '\u0421\u0442\u0440\u0430\u043d\u0430']]) {
    await checkout(String(10003 + index), field)
    for (let attempt = 0; attempt < 100 && dialogs.length <= index; attempt++) await delay(50)
    assert.equal(dialogs.length, index + 1)
    assert.ok(dialogs[index].includes(label))
    assert.ok(!dialogs[index].includes('Invalid customer field'))
    assert.deepEqual(customerResponses.at(-1), { status: 400, field })
    assert.equal(payments.length, 4)
    assert.equal(page.url(), shopOrigin + '/')
  }
  const diagnosticKeys = ['version', 'stage', 'successEvents', 'capturedOrders', 'cartOrderFormat',
    'paymentOrderFormat', 'matched', 'code', 'status', 'field'].sort()
  for (const [scenario, code] of [
    [{ skipCapture: true, clearCart: true }, 'ORDER_NOT_CAPTURED'],
    [{ cartOrderId: '0', clearCart: true }, 'CART_ORDER_MISSING'],
    [{ paymentOrderId: '', clearCart: true }, 'PAYMENT_ORDER_MISSING'],
    [{ paymentOrderId: '38252103:99999', clearCart: true }, 'ORDER_NOT_CAPTURED'],
    [{ cartOrderId: 'T202610-1730916364', paymentOrderId: '38252103:99999', clearCart: true }, 'ORDER_NOT_CAPTURED'],
    [{ cartOrderId: 'T202610-1730916364', paymentOrderId: '99999:1730916364', clearCart: true }, 'ORDER_NOT_CAPTURED'],
    [{ cartOrderId: 'T202613-1730916364', clearCart: true }, 'CART_ORDER_MISSING'],
  ]) {
    const uploadsBefore = customerResponses.length
    const dialogsBefore = dialogs.length
    await checkout('10005', undefined, false, scenario)
    const diagnostics = await page.evaluate(() => window.__pricpayCustomerDiagnostics)
    assert.equal(diagnostics.code, code)
    assert.equal(diagnostics.stage, 'failed')
    assert.equal(diagnostics.matched, false)
    assert.deepEqual(Object.keys(diagnostics).sort(), diagnosticKeys)
    assert.ok(dialogs[dialogsBefore].includes('PD_' + code))
    assert.equal(customerResponses.length, uploadsBefore)
    assert.equal(payments.length, 4)
  }
  for (const [fixture, code, status] of [
    [{ status: 503, contentType: 'application/json', body: '{"ok":false}' }, 'UPLOAD_REJECTED', 503],
    [{ status: 502, contentType: 'text/html', body: 'upstream error' }, 'UPLOAD_RESPONSE', 502],
    [null, 'UPLOAD_NETWORK', null],
  ]) {
    await page.route('**/api/tilda/customer-data', (route) => fixture ? route.fulfill(fixture) : route.abort())
    const dialogsBefore = dialogs.length
    await checkout('10006', undefined, false, { clearCart: true })
    await page.waitForFunction(() => window.__pricpayCustomerDiagnostics.stage === 'failed')
    const diagnostics = await page.evaluate(() => window.__pricpayCustomerDiagnostics)
    assert.equal(diagnostics.code, code)
    assert.equal(diagnostics.status, status)
    assert.equal(diagnostics.matched, true)
    assert.equal(diagnostics.capturedOrders, 1)
    assert.deepEqual(Object.keys(diagnostics).sort(), diagnosticKeys)
    assert.ok(dialogs[dialogsBefore].includes('PD_' + code))
    assert.equal(payments.length, 4)
    await page.unroute('**/api/tilda/customer-data')
  }
  await page.route('**/api/tilda/customer-data', async (route) => { await delay(1200); await route.continue() })
  const paymentsBeforeSlowUpload = payments.length
  await checkout('10007', undefined, false, { occupyKeepalive: true, clearCart: true })
  assert.equal(payments.length, paymentsBeforeSlowUpload)
  await page.waitForURL(`${gatewayOrigin}/api/pricpay/cashier`, { timeout: 5000 })
  assert.equal(payments.length, paymentsBeforeSlowUpload + 1)
  assert.equal(payments.at(-1).billingZip, '101000')
  assert.equal(payments.at(-1).transactionAmount, '27596.96')
  assert.ok(heldKeepalives.size > 0)
  for (const response of heldKeepalives) response.end('released')
  await page.unroute('**/api/tilda/customer-data')
  assert.deepEqual(errors, [])
  console.log('PASS: real desktop/mobile browser, Russian country name -> RU, Cyrillic customer fields, unchanged amount, duplicate-script/submit suppression, localized zip/country errors')
  console.log('Storage and payment HTTP services were local fixtures; no database or real payment was used.')
  console.log('PASS: missing/mismatched orders, rejected/non-JSON/network responses stop payment; diagnostic codes survive Tilda form cleanup and expose only approved metadata')
  console.log('PASS: Tilda TYYYYMM-order references join exact project:order payment forms on both endpoints; other orders/projects remain blocked')
  console.log('PASS: upload completes with the keepalive budget occupied and cart removed; delayed upload acknowledgement still gates payment')
} finally {
  for (const response of heldKeepalives) response.end('released')
  if (browser) await browser.close()
  gateway.closeAllConnections()
  shop.closeAllConnections()
  await new Promise((resolve) => gateway.close(resolve))
  await new Promise((resolve) => shop.close(resolve))
}
