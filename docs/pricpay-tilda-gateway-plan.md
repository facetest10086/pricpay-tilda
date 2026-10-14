# PricPay + Tilda Gateway Remediation Plan

Status: Proposed
Date: 2026-10-14

## Context

This project is a Next.js gateway deployed on Vercel at:

- Production gateway: https://pricpay-tilda.vercel.app/
- Git repository: https://github.com/facetest10086/pricpay-tilda/

The current code is already a Git clone of the repository. The local checkout is under:

```text
C:\Users\kejop\Documents\Codex\2026-10-12\https-github-com-facetest10086-pricpay-tilda\work\pricpay-tilda
```

The local Git remote is:

```text
origin https://github.com/facetest10086/pricpay-tilda.git
```

The current implementation has one order creation route and one PricPay notification route:

- `POST /api/pricpay/create`
- `POST /api/pricpay/notify`

The next version should separate PricPay's two order creation modes, handle browser return and asynchronous notification correctly, and persist audit logs outside Vercel runtime logs.

## Official Documents Used

- Tilda custom payment gateway:
  https://help.tilda.cc/payments/custom-payment-gateway
- PricPay checkout/create API:
  https://www.pricpay.com/api/create.html
- PricPay cashier API:
  https://www.pricpay.com/api/cashier.html
- PricPay signature:
  https://www.pricpay.com/api/signature.html
- PricPay asynchronous notification:
  https://www.pricpay.com/api/notify.html
- Vercel runtime logs:
  https://vercel.com/docs/logs/runtime
- Neon pricing:
  https://neon.com/pricing

## What Tilda Expects

Tilda's custom payment gateway flow is not a pure JSON API flow.

Expected flow from Tilda's documentation:

1. Buyer checks out in Tilda.
2. Tilda redirects the buyer to the payment system API URL using `POST`.
3. The payment system validates the order signature and displays or redirects to a payment form.
4. After payment, the payment system can redirect the buyer to success/failure pages.
5. The payment system must also send a `POST` notification to Tilda's notification URL.
6. Tilda marks the order as paid only after it receives a notification with a correct signature, order number, amount, and success indicator.

Implication for this gateway:

- The Tilda-facing create endpoints should return a browser redirect or an HTML auto-submit/redirect page, not only JSON.
- JSON responses are still useful for manual testing, but should not be the only production behavior.
- Tilda order signature verification should be implemented before creating a PricPay order.
- Tilda's notification URL must be captured and stored for the order, because PricPay's later callback will not include that Tilda URL by default.

## What PricPay Expects

PricPay exposes two relevant order creation APIs.

### Checkout/create API

Route to expose in this project:

```text
POST /api/pricpay/create
```

PricPay endpoint:

```text
POST https://gateway.pricpay.com/payment/gateway/payapi/v2/checkout
Content-Type: application/json
```

Use this for PricPay's normal checkout/create flow. The request includes fields such as `mode`, `paymentMethodCode`, `merchantNo`, `orderNumber`, `transactionAmount`, `transactionCurrency`, `notifyUrl`, `returnUrl`, `productInformation`, `pubId`, and `signature`.

The successful response contains `data.orderNo`, `data.shopUrl`, `data.thirdUrl`, and `data.directFlag`.

Redirect rule:

- If `directFlag === 1` and `thirdUrl` exists, redirect the buyer to `thirdUrl`.
- Otherwise redirect to `shopUrl + '?orderFlag=b&orderNo=' + orderNo`.

### Cashier API

Route to expose in this project:

```text
POST /api/pricpay/cashier
```

PricPay endpoint:

```text
POST https://gateway.pricpay.com/payment/gateway/payapi/cache-merchant-info
Content-Type: application/json
```

Use this for PricPay's cashier/HPP flow. The request does not need `mode`, `paymentMethodCode`, or `pubId` in the final payload. PricPay returns a cashier token string.

Redirect rule:

```text
https://cashier.pricpay.com?cashier=<token>
```

## Current Code Problems

1. `POST /api/pricpay/create` mixes two PricPay creation modes behind `PRICPAY_MODE`.
   - Current behavior defaults to HPP/Cashier.
   - This hides which PricPay document is being used.
   - The requested design should split this into `/api/pricpay/create` and `/api/pricpay/cashier`.

2. The create route returns JSON only.
   - Current response is `{ ok, orderNo, target, redirectUrl }`.
   - Tilda's documented custom gateway flow redirects the user to the payment system URL by `POST`; the payment system should then display or redirect to payment.
   - Production behavior should redirect the browser to PricPay after successful creation.
   - JSON can remain available for diagnostics by checking `Accept: application/json` or a debug query parameter.

3. Tilda order signature is not verified.
   - Tilda expects the order request to include an order signature generated with configured rules.
   - Current code accepts any POST to the create route and creates a PricPay order.
   - This allows forged order creation requests.

4. The current PricPay notify route loses routing context.
   - Current code places `target`, `order`, and `amount` in PricPay `notifyUrl` query parameters.
   - The notify route only reads the POST body and ignores `request.url` query parameters.
   - PricPay's notify body does not include the Tilda notification URL.
   - As a result, the gateway may return `{ ok: true }` but never notify Tilda.

5. The notify route does not check PricPay order status.
   - PricPay documents `orderStatus=100` as success, `120` as failure, and `103` as processing.
   - Current code forwards `paid=true` for any valid PricPay signature.
   - This can incorrectly mark failed or processing payments as paid.

6. Return URL points to a missing route.
   - Current fallback `returnUrl` is `/api/pricpay/return`.
   - No `app/api/pricpay/return/route.ts` exists.
   - Browser return after payment may hit a 404 unless Tilda supplies `returnUrl` or `successUrl`.

7. There is no persistent order state.
   - Without a database, the gateway cannot reliably map PricPay callbacks back to the original Tilda notification URL, Tilda order ID, amount, customer email, selected creation mode, or redirect URLs.
   - Query-string state in notify URLs is fragile and should not be the source of truth.

8. There is no persistent audit log.
   - Vercel Hobby runtime logs are retained for a short time and are not suitable as the only payment audit trail.
   - Logs should be written to an external database with sensitive fields redacted.

9. There is no duplicate notification handling.
   - Payment providers commonly retry notifications.
   - The gateway should make callbacks idempotent by order number and event type.

10. There is no test or build verification script beyond `dev`, `build`, and `start`.
    - The project should add focused tests for signing, payload construction, return handling, and notification handling before changing payment behavior.

## Proposed Endpoint Design

### `POST /api/pricpay/create`

Purpose: Tilda-facing endpoint for PricPay checkout/create API.

Behavior:

1. Parse `application/json` and `application/x-www-form-urlencoded`.
2. Log raw Tilda request metadata and sanitized body.
3. Verify Tilda order signature when `TILDA_ORDER_SECRET` is configured.
4. Normalize Tilda fields into an internal order model.
5. Store or update an `orders` row.
6. Build PricPay checkout payload.
7. Generate PricPay signature.
8. Store a `gateway_events` log entry before the outbound request.
9. Call PricPay `v2/checkout`.
10. Store PricPay raw response and parsed redirect decision.
11. Redirect the buyer to PricPay checkout.

Diagnostic mode:

- If request has `Accept: application/json` or `?format=json`, return `{ ok, orderId, pricpayOrderNo, redirectUrl }` for manual testing.

### `POST /api/pricpay/cashier`

Purpose: Tilda-facing endpoint for PricPay cashier/HPP API.

Behavior:

1. Same Tilda parsing, verification, normalization, order persistence, and logging steps as `/create`.
2. Build cashier payload without `mode`, `paymentMethodCode`, or `pubId`.
3. Generate PricPay signature over the cashier payload.
4. Call PricPay `cache-merchant-info`.
5. Treat the raw text response as cashier token.
6. Redirect the buyer to `https://cashier.pricpay.com?cashier=<token>`.

Diagnostic mode:

- If request has `Accept: application/json` or `?format=json`, return `{ ok, orderId, cashierToken, redirectUrl }`.

### `GET /api/pricpay/return`

Purpose: Browser return endpoint after PricPay sends the buyer back.

Important distinction:

- Browser return is only for user experience.
- It must not be the authority for marking an order as paid.
- The authoritative payment state should come from PricPay asynchronous notify.

Behavior:

1. Parse return query/body from PricPay.
2. Store sanitized return event.
3. Resolve the original order by `orderNumber` or PricPay order number.
4. If successful, redirect buyer to Tilda success page.
5. If failed, redirect buyer to Tilda failure page.
6. If unknown or processing, redirect buyer to a configurable pending page or Tilda order page.

Recommended stored fields:

- `tilda_success_url`
- `tilda_failure_url`
- `tilda_pending_url`

Fallback environment variables:

- `TILDA_SUCCESS_URL`
- `TILDA_FAILURE_URL`
- `TILDA_PENDING_URL`

### `POST /api/pricpay/notify`

Purpose: PricPay asynchronous notification endpoint.

Behavior:

1. Parse `application/x-www-form-urlencoded`.
2. Log sanitized raw body.
3. Verify PricPay signature with `PRICPAY_SECRET`.
4. Resolve order by `orderNumber`.
5. Store notification event and current status.
6. If `orderStatus=100`, notify Tilda with paid success fields.
7. If `orderStatus=120`, mark order failed and do not notify paid success.
8. If `orderStatus=103`, mark processing and do not notify paid success.
9. Return the response format PricPay expects. If PricPay does not document a strict body, use a simple 200 response such as `OK`.

Tilda notification should use the Tilda notification URL captured at order creation time, not a value received from PricPay notify.

## Callback and Redirect Handling

There are two separate callback concerns.

### Buyer return

This is the browser redirect after payment. It controls where the buyer lands.

Recommended handling:

- Pass this gateway's `/api/pricpay/return` as PricPay `returnUrl`.
- Store Tilda's desired success and failure URLs in the database during order creation.
- `/api/pricpay/return` redirects the browser to the correct Tilda page based on known order state and PricPay return parameters.
- If payment state is still unknown, use a pending page rather than marking paid.

### Server notification

This is the authoritative payment status callback.

Recommended handling:

- Pass this gateway's `/api/pricpay/notify` as PricPay `notifyUrl`.
- Do not rely on browser return to update order status.
- Verify PricPay signature.
- Only treat `orderStatus=100` as paid.
- Notify Tilda using its notification URL, original order number, original amount, success indicator, and Tilda-compatible signature.
- Make this idempotent so repeated PricPay notifications do not create inconsistent state.

## Logging and Persistence

Vercel logs alone are not enough for this gateway. Vercel runtime logs are useful for short-term debugging, but payment audit logs should be persisted in a database.

Recommended initial stack:

```text
Vercel + Neon Postgres
```

Reason:

- Current traffic is expected to be small because there is one Tilda site.
- Neon Free currently provides a free Postgres tier with enough capacity for low-volume gateway logs.
- Postgres is a good fit for structured orders, callbacks, idempotency keys, and searchable audit events.
- This avoids buying and maintaining a server before traffic proves the need.

Important caveat:

- This is acceptable for a first production version with low volume, but a paid Neon plan or another managed Postgres should be considered once the gateway processes real revenue and needs stronger availability expectations.

Alternatives:

- Supabase Postgres: good managed Postgres alternative with dashboard and auth ecosystem.
- Turso/LibSQL: lightweight and cheap, but less natural for relational audit queries and external reporting than Postgres.
- A small VPS: more control and local logs, but adds system administration, backups, monitoring, deployment hardening, and security patching.
- Self-hosted backend in another language: reasonable later if the gateway grows, but not necessary for the current single-site scope.

Recommendation:

- Use Vercel + Neon first.
- Keep the gateway in Next.js for now.
- Revisit VPS or another backend only after the integration is stable and there is sustained traffic or compliance/retention pressure.

## Proposed Database Tables

### `orders`

Stores one row per Tilda order.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
tilda_order_id text not null,
pricpay_order_no text,
creation_mode text not null, -- create | cashier
status text not null default 'created',
amount numeric(18, 8) not null,
currency text not null,
customer_email text,
tilda_notify_url text,
tilda_success_url text,
tilda_failure_url text,
tilda_pending_url text,
pricpay_redirect_url text,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
unique(tilda_order_id)
```

### `gateway_events`

Append-only event log.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
order_id uuid references orders(id),
tilda_order_id text,
pricpay_order_no text,
event_type text not null,
direction text not null, -- inbound | outbound | internal
endpoint text,
http_method text,
status_code integer,
request_headers jsonb,
request_body jsonb,
response_body jsonb,
signature_base text,
signature_result text,
redirect_url text,
error_message text,
created_at timestamptz not null default now()
```

### `payment_notifications`

Optional normalized callback table for idempotency.

Suggested columns:

```sql
id uuid primary key default gen_random_uuid(),
order_id uuid references orders(id),
platform_order_no text,
order_number text not null,
order_status text not null,
amount numeric(18, 8),
currency text,
signature text,
raw_body jsonb not null,
received_at timestamptz not null default now(),
unique(platform_order_no, order_status)
```

## Log Redaction Rules

Do log:

- Tilda order ID
- PricPay order number
- amount and currency
- endpoint names
- timestamps
- sanitized request/response bodies
- signature base string after redaction
- generated signature result
- redirect decisions
- callback status
- errors and retry outcomes

Do not log:

- `PRICPAY_SECRET`
- Tilda payment secret
- raw card data
- full authorization tokens
- full customer phone number if not required
- unnecessary PII

Recommended redaction:

- Email: keep full email only if needed for support; otherwise store masked value.
- Phone: mask middle digits.
- Secrets: replace with `[REDACTED]`.
- Headers: store only useful headers such as content type, user agent, request ID, and forwarded IP.

## Implementation Phases

### Phase 1: Stabilize interfaces without database

1. Split current creation logic into explicit create and cashier builders.
2. Add `/api/pricpay/cashier`.
3. Change Tilda-facing successful create behavior to browser redirect.
4. Add JSON diagnostic mode.
5. Add `/api/pricpay/return`.
6. Fix notify parsing to include status checks.

This phase can still be limited because it lacks durable order state.

### Phase 2: Add Neon persistence

1. Add Neon/Postgres dependency.
2. Add schema migration SQL.
3. Add an internal `orders` repository.
4. Add an internal `gateway_events` logger.
5. Store Tilda notify/success/failure URLs at order creation.
6. Resolve callbacks from the database.
7. Make notifications idempotent.

This is the recommended minimum before real orders.

### Phase 3: Add verification and operational tooling

1. Add tests for PricPay signature.
2. Add tests for Tilda signature.
3. Add tests for redirect decisions.
4. Add tests for notify status handling.
5. Add a protected internal endpoint or script for inspecting order logs.
6. Add README deployment instructions for Vercel environment variables and Neon setup.

## Environment Variables

Current variables to keep:

```text
PRICPAY_MERCHANT_NO
PRICPAY_SECRET
PRICPAY_PUB_ID
PRICPAY_PAYMENT_METHOD
PRICPAY_MERCHANT_WEBSITE
TILDA_NOTIFY_URL
```

Variables to add:

```text
DATABASE_URL
TILDA_ORDER_SECRET
TILDA_NOTIFY_SECRET
TILDA_SUCCESS_URL
TILDA_FAILURE_URL
TILDA_PENDING_URL
GATEWAY_DEFAULT_MODE=create
LOG_RAW_PAYLOADS=false
```

`PRICPAY_MODE` should no longer decide which endpoint is used. The route should decide:

- `/api/pricpay/create` uses PricPay checkout/create.
- `/api/pricpay/cashier` uses PricPay cashier/HPP.

## Recommendation

For the current single Tilda site, the best path is:

```text
Keep Next.js on Vercel.
Add Neon Postgres for order state and audit logs.
Split create and cashier into explicit routes.
Use server-side redirects for the buyer flow.
Use PricPay async notify as the source of truth for payment state.
Forward only verified successful payments to Tilda.
```

Do not move to a VPS or another backend language yet. That adds operational work before the integration itself is correct. Move later only if there is a clear need for always-on compute, longer-running jobs, stricter log retention, custom network controls, or lower predictable cost at higher traffic.
