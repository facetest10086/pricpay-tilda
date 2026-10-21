import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { neon } from '@neondatabase/serverless'
import { customerTokenHash } from '../lib/tilda-customer-data.ts'

const require = createRequire(import.meta.url)
const databaseUrl = process.env.TEST_DATABASE_URL
assert.ok(databaseUrl, 'Set TEST_DATABASE_URL to an isolated Neon test branch, not production')
assert.notEqual(databaseUrl, process.env.DATABASE_URL, 'The test database must differ from the application database')
const sql = neon(databaseUrl)
const statements = (await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  .split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean)
await sql.transaction(statements.map((statement) => sql.query(statement)))
const receivedPayments = []
const receivedNotifications = []
let gateway
const upstream = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url?.startsWith('/tilda-')) {
    let body = ''
    for await (const chunk of request) body += chunk
    receivedNotifications.push(Object.fromEntries(new URLSearchParams(body)))
    response.statusCode = request.url === '/tilda-http-error' ? 500 : 200
    response.end(request.url === '/tilda-reject' ? 'Signature not correct.' : 'OK')
    return
  }
  if (request.method === 'POST' && request.url === '/upstream') {
    let body = ''
    for await (const chunk of request) body += chunk
    receivedPayments.push(JSON.parse(body))
    response.end('fixture-token')
    return
  }
  if (request.url === '/shop') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(`<div id="allrecords" data-tilda-project-id="38252103"></div>
      <form id="cart"><input name="firstName" value="Ivan"><input name="lastName" value="Ivanov">
      <input name="customerCountry" value="\u0420\u043e\u0441\u0441\u0438\u044f"><input name="state" value="Moscow Oblast">
      <input name="city" value="Moscow"><input name="address" value="Example Street 12">
      <input name="zip" value="001234"><input name="Email" value="buyer@example.test">
      <input name="Phone" value="+79991234567"></form>
      <script src="${gateway}/tilda-customer-data.js" defer></script>`)
    return
  }
  response.end('local payment fixture')
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const shop = `http://127.0.0.1:${upstream.address().port}`
const portProbe = createServer()
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve))
const gatewayPort = portProbe.address().port
await new Promise((resolve) => portProbe.close(resolve))
gateway = `http://127.0.0.1:${gatewayPort}`
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(gatewayPort)], {
  env: { ...process.env, DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: databaseUrl,
    PRICPAY_MERCHANT_NO: 'TEST_MERCHANT', PRICPAY_SECRET: 'test-only-not-a-real-secret',
    PRICPAY_PUB_ID: 'test', PRICPAY_CASHIER_ENDPOINT: `${shop}/upstream`,
    PRICPAY_MERCHANT_WEBSITE: gateway,
    PRICPAY_CREATE_ENDPOINT: `${shop}/upstream`, PRICPAY_CASHIER_BASE_URL: `${shop}/cashier`,
    TILDA_NOTIFY_URL: `${shop}/tilda-ok`, TILDA_NOTIFY_SECRET: 'independent-test-tilda-key',
    TILDA_SUCCESS_URL: `${shop}/payment-success`, TILDA_FAILURE_URL: `${shop}/payment-failed`, TILDA_PENDING_URL: '',
    PRICPAY_NOTIFY_AMOUNT_UNIT: 'minor',
    TILDA_SITE_ORIGIN: shop, GATEWAY_DB_TIMEOUT_MS: '10000' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk })
server.stderr.on('data', (chunk) => { serverOutput += chunk })
const customer = { firstName: 'Ivan', lastName: 'Ivanov', customerCountry: 'RU', state: 'Moscow Oblast',
  city: 'Moscow', address: 'Example Street 12', zip: '001234', email: 'buyer@example.test', phone: '+79991234567' }
const fixturePrefix = String(Date.now())
const orderId = (suffix) => `38252103:${fixturePrefix}${suffix}`
const postCustomer = (body, origin = shop) => fetch(`${gateway}/api/tilda/customer-data`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})
const postPayment = (id, token) => fetch(`${gateway}/api/pricpay/cashier?response=json`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ orderid: id, customerDataToken: token, amount: '1490.00', currency: 'RUB',
    country: 'GB', name: 'Legacy name', firstName: 'firstName', zip: 'zip',
    email: customer.email, phone: customer.phone, orderTime: '2026-10-20T10:15:30+03:00' }),
})
let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local server exited: ${serverOutput.slice(-1000)}`)
    try { ready = (await fetch(`${gateway}/api/pricpay/cashier`)).ok } catch {}
    if (ready) break
    await delay(200)
  }
  assert.ok(ready, 'Local gateway did not start')
  const token = randomBytes(32).toString('hex')
  const submission = { orderId: orderId('1'), token, customer }
  assert.equal((await postCustomer(submission, 'https://untrusted.example')).status, 403)
  assert.equal((await postCustomer('x'.repeat(9000))).status, 413)
  const invalidCustomer = await postCustomer({ ...submission, customer: { ...customer, lastName: 'lastName' } })
  assert.equal(invalidCustomer.status, 400)
  assert.equal((await invalidCustomer.json()).field, 'lastName')
  assert.equal((await postCustomer(submission)).status, 200)
  assert.equal((await postCustomer(submission)).status, 200)
  assert.equal((await postCustomer({ ...submission, customer: { ...customer, address: 'Changed address' } })).status, 409)
  assert.equal((await postPayment(submission.orderId, '')).status, 400)
  assert.equal(receivedPayments.length, 0)
  const checkout = await postPayment(submission.orderId, token)
  assert.equal(checkout.status, 200, await checkout.text())
  const payload = receivedPayments.at(-1)
  assert.equal(payload.billingFirstName, 'Ivan')
  assert.equal(payload.billingCountry, 'RU')
  assert.equal(payload.billingZip, '001234')
  assert.equal(payload.transactionAmount, '1490.00')
  assert.equal(payload.transactionCurrency, 'RUB')
  assert.equal(payload.merchantOrderDate, '2026-10-20 07:15:30')
  assert.equal(payload.customerDataToken, undefined)
  const isolated = await sql.query('select customer_data from tilda_customer_data where tilda_order_id = $1 and token_hash = $2',
    [submission.orderId, customerTokenHash(randomBytes(32).toString('hex'))])
  assert.equal(isolated.length, 0)
  const lateToken = randomBytes(32).toString('hex')
  const latePayment = postPayment(orderId('2'), lateToken)
  await delay(100)
  assert.equal((await postCustomer({ orderId: orderId('2'), token: lateToken, customer })).status, 200)
  assert.equal((await latePayment).status, 200)
  await sql.query("update tilda_customer_data set expires_at = now() - interval '1 minute' where tilda_order_id = $1", [submission.orderId])
  const expired = await postPayment(submission.orderId, token)
  assert.equal(expired.status, 504)
  assert.equal(receivedPayments.length, 2)
  console.log('PASS: real Neon storage, validation, immutable retries, token isolation, late arrival, expiry, cashier merge and unchanged payment amount')

  function callbackSignature(body) {
    const base = Object.keys(body).filter((key) => key !== 'signature').sort().map((key) => `${key}=${body[key]}`).join('&')
    return createHash('md5').update(`${base}&secret=test-only-not-a-real-secret`).digest('hex').toUpperCase()
  }
  function notify(id, overrides = {}, validSignature = true, queryOverrides = {}) {
    const body = { merchantNo: 'TEST_MERCHANT', orderNumber: id, platformOrderNo: `TX_TEST_${id}`,
      orderStatus: '100', amount: '149000.00000000', currency: 'RUB', ...overrides }
    body.signature = validSignature ? callbackSignature(body) : 'INVALID'
    const url = new URL(`${gateway}/api/pricpay/notify`)
    url.searchParams.set('order', id)
    for (const [key, value] of Object.entries(queryOverrides)) url.searchParams.set(key, value)
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
    })
  }
  const storedStatus = async (id) => (await sql.query('select status, last_error from gateway_orders where tilda_order_id = $1', [id]))[0]
  const returnFromCashier = (id, status = '') => fetch(`${gateway}/api/pricpay/return?` +
    new URLSearchParams({ order: id, orderStatus: status }), { redirect: 'manual' })
  for (const status of ['PROCESSING', 'SUCCESS', '100', 'CANCELLED']) {
    const returned = await returnFromCashier(submission.orderId, status)
    assert.equal(returned.status, 307)
    assert.equal(new URL(returned.headers.get('location')).pathname, status === 'CANCELLED' ? '/payment-failed' : '/')
    assert.notEqual(new URL(returned.headers.get('location')).searchParams.get('status'), 'paid')
    assert.equal((await storedStatus(submission.orderId)).status, 'redirect_created')
  }
  await sql.query("update gateway_orders set status = 'paid' where tilda_order_id = $1", [submission.orderId])
  assert.equal(new URL((await returnFromCashier(submission.orderId, '100')).headers.get('location')).searchParams.get('status'), 'pending')
  await sql.query("update gateway_orders set status = 'redirect_created' where tilda_order_id = $1", [submission.orderId])
  assert.equal((await notify(submission.orderId, {}, false)).status, 401)
  assert.equal((await storedStatus(submission.orderId)).status, 'redirect_created')
  assert.equal((await notify(submission.orderId, { amount: '1490.00' })).status, 400)
  assert.equal((await storedStatus(submission.orderId)).status, 'notify_amount_mismatch')
  assert.equal((await notify(submission.orderId, { currency: 'USD' })).status, 400)
  assert.equal(new URL((await returnFromCashier(submission.orderId, '100')).headers.get('location')).searchParams.get('status'), 'pending')
  assert.equal(receivedNotifications.length, 0)
  assert.equal((await notify(submission.orderId)).status, 200)
  assert.equal(receivedNotifications.length, 1)
  const notification = receivedNotifications[0]
  assert.equal(notification.amount, '1490.00')
  const signatureBase = `amount=1490.00&orderid=${submission.orderId}&paid=true&transactionid=TX_TEST_${submission.orderId}&secret=independent-test-tilda-key`
  assert.equal(notification.signature, createHash('md5').update(signatureBase).digest('hex').toUpperCase())
  assert.deepEqual(await storedStatus(submission.orderId), { status: 'paid', last_error: null })
  const mismatchedReturn = await fetch(`${gateway}/api/pricpay/return?` + new URLSearchParams({
    order: submission.orderId, orderNo: 'TX_DIFFERENT_ORDER', orderStatus: '100',
  }), { redirect: 'manual' })
  assert.equal(new URL(mismatchedReturn.headers.get('location')).searchParams.get('status'), 'pending')
  const paidReturn = await returnFromCashier(submission.orderId, 'CANCELLED')
  assert.equal(new URL(paidReturn.headers.get('location')).searchParams.get('status'), 'paid')
  assert.deepEqual(await storedStatus(submission.orderId), { status: 'paid', last_error: null })
  assert.equal((await notify(orderId('2'), { orderStatus: '103' }, true, { orderNumber: submission.orderId })).status, 200)
  assert.equal((await storedStatus(submission.orderId)).status, 'paid')
  assert.equal((await storedStatus(orderId('2'))).status, 'pending')
  await sql.query('update gateway_orders set tilda_notify_url = $1 where tilda_order_id = $2', [`${shop}/tilda-reject`, orderId('2')])
  assert.equal((await notify(orderId('2'))).status, 502)
  assert.equal((await storedStatus(orderId('2'))).status, 'tilda_notify_error')
  assert.match((await storedStatus(orderId('2'))).last_error, /Signature not correct/)
  assert.equal(new URL((await returnFromCashier(orderId('2'), 'PROCESSING')).headers.get('location')).searchParams.get('status'), 'paid')
  assert.equal((await storedStatus(orderId('2'))).status, 'tilda_notify_error')
  const acceptedRows = await sql.query(`select count(*)::int as total from payment_notifications
    where tilda_order_id = $1 and forwarded_to_tilda`, [orderId('2')])
  assert.equal(acceptedRows[0].total, 0)
  await sql.query('update gateway_orders set tilda_notify_url = $1 where tilda_order_id = $2', [`${shop}/tilda-http-error`, orderId('2')])
  assert.equal((await notify(orderId('2'))).status, 502)
  await sql.query('update gateway_orders set tilda_notify_url = $1 where tilda_order_id = $2', [`${shop}/tilda-ok`, orderId('2')])
  assert.equal((await notify(orderId('2'))).status, 200)
  assert.deepEqual(await storedStatus(orderId('2')), { status: 'paid', last_error: null })
  const countBeforeUnknown = receivedNotifications.length
  assert.equal((await notify(orderId('999'))).status, 503)
  assert.equal(receivedNotifications.length, countBeforeUnknown)
  console.log('PASS: callback signature before conversion, exact amount/currency checks, corrected independently signed Tilda amount, HTTP-200 rejection, retry recovery, and no false forwarded flag')

  if (process.env.PLAYWRIGHT_MODULE_PATH) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH)
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined })
    const page = await browser.newPage()
    const dialogs = []
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
    const scriptErrors = []
    page.on('pageerror', (error) => scriptErrors.push(error.message))
    async function browserPayment(suffix, useRequestSubmit, invalid = false) {
      await page.goto(`${shop}/shop`)
      await page.waitForFunction(() => window.__pricpayCustomerBridge)
      await page.evaluate(({ id, gateway, useRequestSubmit, invalid }) => {
        const cart = document.getElementById('cart')
        cart.tildaOrderId = id.split(':')[1]
        cart.tildaTranId = '38252103:999'
        if (invalid === 'country') cart.elements.namedItem('customerCountry').value = 'unknown country'
        else if (invalid) cart.elements.namedItem('zip').value = ''
        cart.dispatchEvent(new Event('tildaform:aftersuccess', { bubbles: true }))
        const payment = document.createElement('form')
        payment.method = 'POST'
        payment.action = gateway + '/api/pricpay/cashier'
        for (const [name, value] of Object.entries({ orderid: id, amount: '1490.00', currency: 'RUB',
          country: 'GB', email: 'buyer@example.test', phone: '+79991234567', orderTime: '2026-10-20T10:15:30+03:00' })) {
          const input = document.createElement('input')
          input.type = 'hidden'; input.name = name; input.value = value
          payment.appendChild(input)
        }
        document.body.appendChild(payment)
        if (useRequestSubmit) payment.requestSubmit()
        else { payment.submit(); payment.submit(); payment.remove() }
      }, { id: orderId(suffix), gateway, useRequestSubmit, invalid })
    }
    await browserPayment('3', false)
    await page.waitForURL(`${shop}/cashier?cashier=fixture-token`)
    assert.equal(receivedPayments.length, 3)
    assert.equal(receivedPayments.at(-1).billingLastName, 'Ivanov')
    assert.equal(receivedPayments.at(-1).billingCountry, 'RU')
    await page.setViewportSize({ width: 390, height: 844 })
    await browserPayment('4', true)
    await page.waitForURL(`${shop}/cashier?cashier=fixture-token`)
    assert.equal(receivedPayments.length, 4)
    await browserPayment('5', false, true)
    await page.waitForFunction(() => document.getElementById('cart'))
    for (let attempt = 0; attempt < 100 && dialogs.length === 0; attempt++) await delay(100)
    assert.equal(dialogs.length, 1)
    assert.match(dialogs[0], /\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u0438\u043d\u0434\u0435\u043a\u0441/)
    assert.equal(receivedPayments.length, 4)
    assert.equal(page.url(), `${shop}/shop`)
    await browserPayment('6', false, 'country')
    for (let attempt = 0; attempt < 100 && dialogs.length < 2; attempt++) await delay(100)
    assert.equal(dialogs.length, 2)
    assert.match(dialogs[1], /\u0421\u0442\u0440\u0430\u043d\u0430/)
    assert.equal(receivedPayments.length, 4)
    await page.goto(`${shop}/shop`)
    await page.waitForFunction(() => window.__pricpayCustomerBridge)
    await page.evaluate((shop) => {
      const other = document.createElement('form'); other.method = 'POST'; other.action = shop + '/other'
      document.body.appendChild(other); other.submit()
    }, shop)
    await page.waitForURL(`${shop}/other`)
    assert.deepEqual(scriptErrors, [])
    console.log('PASS: Chromium desktop/mobile Russian country-name submission, native submit and requestSubmit, CORS, duplicate suppression, localized field errors, unrelated form passthrough')
  }
} finally {
  if (browser) await browser.close()
  server.kill()
  await new Promise((resolve) => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  await new Promise((resolve) => upstream.close(resolve))
}
