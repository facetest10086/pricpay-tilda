import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

type GatewayEvent = {
  eventType: string
  direction: 'inbound' | 'outbound' | 'internal'
  endpoint?: string
  method?: string
  statusCode?: number
  orderId?: string
  tildaOrderId?: string
  pricpayOrderNo?: string
  requestBody?: unknown
  responseBody?: unknown
  signatureBase?: string
  signatureResult?: string
  redirectUrl?: string
  errorMessage?: string
}

type GatewayOrderInput = {
  tildaOrderId: string
  creationMode: string
  transactionAmount?: string
  transactionCurrency?: string
  customerEmail?: string
  tildaNotifyUrl?: string
  tildaSuccessUrl?: string
  tildaFailureUrl?: string
  tildaPendingUrl?: string
  pricpayNotifyUrl?: string
  pricpayReturnUrl?: string
  rawTildaOrder?: unknown
}

type GatewayOrderUpdate = {
  status?: string
  pricpayOrderNo?: string
  pricpayRedirectUrl?: string
  pricpayRequest?: unknown
  pricpayResponse?: unknown
  lastError?: string
}

type PaymentNotificationInput = {
  orderId?: string
  platformOrderNo?: string
  tildaOrderId?: string
  orderStatus?: string
  amount?: string
  currency?: string
  verified: boolean
  forwardedToTilda?: boolean
  tildaResponseStatus?: number
  rawBody: unknown
}

export type GatewayOrderRecord = {
  id: string
  tildaOrderId: string
  pricpayOrderNo: string | null
  creationMode: string
  status: string
  transactionAmount: string | null
  transactionCurrency: string | null
  customerEmail: string | null
  tildaNotifyUrl: string | null
  tildaSuccessUrl: string | null
  tildaFailureUrl: string | null
  tildaPendingUrl: string | null
  pricpayNotifyUrl: string | null
  pricpayReturnUrl: string | null
  pricpayRedirectUrl: string | null
  lastError: string | null
}

type LogResult = { ok: true } | { ok: false; error: string; skipped?: boolean }

let sqlClient: ReturnType<typeof neon> | undefined
let schemaReady: Promise<void> | undefined

const databaseTimeoutMs = Number(process.env.GATEWAY_DB_TIMEOUT_MS ?? 1000)

const schemaStatements = [
  `create table if not exists gateway_orders (
    id text primary key,
    tilda_order_id text not null unique,
    pricpay_order_no text,
    creation_mode text not null,
    status text not null default 'created',
    transaction_amount numeric(18, 8),
    transaction_currency text,
    customer_email text,
    tilda_notify_url text,
    tilda_success_url text,
    tilda_failure_url text,
    tilda_pending_url text,
    pricpay_notify_url text,
    pricpay_return_url text,
    pricpay_redirect_url text,
    raw_tilda_order jsonb not null default '{}'::jsonb,
    pricpay_request jsonb,
    pricpay_response jsonb,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  `create index if not exists gateway_orders_pricpay_order_no_idx on gateway_orders (pricpay_order_no)`,
  `create index if not exists gateway_orders_status_idx on gateway_orders (status)`,
  `create index if not exists gateway_orders_created_at_idx on gateway_orders (created_at desc)`,
  `create table if not exists gateway_events (
    id text primary key,
    order_id text references gateway_orders (id) on delete set null,
    event_type text not null,
    direction text not null,
    endpoint text,
    http_method text,
    status_code integer,
    tilda_order_id text,
    pricpay_order_no text,
    request_body jsonb,
    response_body jsonb,
    signature_base text,
    signature_result text,
    redirect_url text,
    error_message text,
    created_at timestamptz not null default now()
  )`,
  `alter table gateway_events add column if not exists order_id text references gateway_orders (id) on delete set null`,
  `alter table gateway_events add column if not exists signature_base text`,
  `alter table gateway_events add column if not exists signature_result text`,
  `create index if not exists gateway_events_order_id_idx on gateway_events (order_id)`,
  `create index if not exists gateway_events_event_type_idx on gateway_events (event_type)`,
  `create index if not exists gateway_events_tilda_order_id_idx on gateway_events (tilda_order_id)`,
  `create index if not exists gateway_events_pricpay_order_no_idx on gateway_events (pricpay_order_no)`,
  `create index if not exists gateway_events_created_at_idx on gateway_events (created_at desc)`,
  `create table if not exists payment_notifications (
    id text primary key,
    order_id text references gateway_orders (id) on delete set null,
    platform_order_no text,
    tilda_order_id text,
    order_status text,
    amount numeric(18, 8),
    currency text,
    verified boolean not null default false,
    forwarded_to_tilda boolean not null default false,
    tilda_response_status integer,
    raw_body jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists payment_notifications_order_id_idx on payment_notifications (order_id)`,
  `create index if not exists payment_notifications_platform_order_no_idx on payment_notifications (platform_order_no)`,
  `create index if not exists payment_notifications_tilda_order_id_idx on payment_notifications (tilda_order_id)`,
  `create index if not exists payment_notifications_created_at_idx on payment_notifications (created_at desc)`,
]

function getSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return undefined
  sqlClient ??= neon(databaseUrl)
  return sqlClient
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function withDatabaseTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  operation.catch(() => undefined)

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${databaseTimeoutMs}ms`)), databaseTimeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const lower = key.toLowerCase()
      if (
        lower.includes('secret') ||
        lower.includes('password') ||
        lower.includes('token') ||
        lower.includes('authorization') ||
        lower.includes('api_key') ||
        lower.includes('apikey') ||
        lower.includes('card') ||
        lower.includes('cvv')
      ) {
        return [key, '[REDACTED]']
      }
      return [key, redact(entry)]
    }),
  )
}

function nullableText(value: string | undefined) {
  if (value === undefined || value === null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function nullableJson(value: unknown) {
  return JSON.stringify(redact(value ?? null))
}

function normalizeOrder(row: Record<string, unknown>): GatewayOrderRecord {
  return {
    id: String(row.id),
    tildaOrderId: String(row.tilda_order_id),
    pricpayOrderNo: row.pricpay_order_no === null ? null : String(row.pricpay_order_no),
    creationMode: String(row.creation_mode),
    status: String(row.status),
    transactionAmount: row.transaction_amount === null ? null : String(row.transaction_amount),
    transactionCurrency: row.transaction_currency === null ? null : String(row.transaction_currency),
    customerEmail: row.customer_email === null ? null : String(row.customer_email),
    tildaNotifyUrl: row.tilda_notify_url === null ? null : String(row.tilda_notify_url),
    tildaSuccessUrl: row.tilda_success_url === null ? null : String(row.tilda_success_url),
    tildaFailureUrl: row.tilda_failure_url === null ? null : String(row.tilda_failure_url),
    tildaPendingUrl: row.tilda_pending_url === null ? null : String(row.tilda_pending_url),
    pricpayNotifyUrl: row.pricpay_notify_url === null ? null : String(row.pricpay_notify_url),
    pricpayReturnUrl: row.pricpay_return_url === null ? null : String(row.pricpay_return_url),
    pricpayRedirectUrl: row.pricpay_redirect_url === null ? null : String(row.pricpay_redirect_url),
    lastError: row.last_error === null ? null : String(row.last_error),
  }
}

async function ensureGatewaySchema(sql: ReturnType<typeof neon>) {
  schemaReady ??= (async () => {
    for (const statement of schemaStatements) {
      await sql.query(statement)
    }
  })().catch((error) => {
    schemaReady = undefined
    throw error
  })
  await schemaReady
}

export async function recordGatewayEvent(event: GatewayEvent): Promise<LogResult> {
  const sql = getSql()
  if (!sql) return { ok: false, skipped: true, error: 'DATABASE_URL is not configured' }

  try {
    await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        await sql`
          insert into gateway_events (
            id,
            order_id,
            event_type,
            direction,
            endpoint,
            http_method,
            status_code,
            tilda_order_id,
            pricpay_order_no,
            request_body,
            response_body,
            signature_base,
            signature_result,
            redirect_url,
            error_message
          )
          values (
            ${randomUUID()},
            ${event.orderId ?? null},
            ${event.eventType},
            ${event.direction},
            ${event.endpoint ?? null},
            ${event.method ?? null},
            ${event.statusCode ?? null},
            ${event.tildaOrderId ?? null},
            ${event.pricpayOrderNo ?? null},
            ${nullableJson(event.requestBody)}::jsonb,
            ${nullableJson(event.responseBody)}::jsonb,
            ${event.signatureBase ?? null},
            ${event.signatureResult ?? null},
            ${event.redirectUrl ?? null},
            ${event.errorMessage ?? null}
          )
        `
      })(),
      'Gateway log write',
    )
    return { ok: true }
  } catch (error) {
    const message = errorMessage(error, 'Unable to write gateway event')
    console.error('Gateway log write failed:', message)
    return { ok: false, error: message }
  }
}

export async function upsertGatewayOrder(input: GatewayOrderInput): Promise<GatewayOrderRecord | undefined> {
  const sql = getSql()
  if (!sql) return undefined

  try {
    return await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        const rows = (await sql`
          insert into gateway_orders (
            id,
            tilda_order_id,
            creation_mode,
            transaction_amount,
            transaction_currency,
            customer_email,
            tilda_notify_url,
            tilda_success_url,
            tilda_failure_url,
            tilda_pending_url,
            pricpay_notify_url,
            pricpay_return_url,
            raw_tilda_order
          )
          values (
            ${randomUUID()},
            ${input.tildaOrderId},
            ${input.creationMode},
            ${nullableText(input.transactionAmount)},
            ${nullableText(input.transactionCurrency)},
            ${nullableText(input.customerEmail)},
            ${nullableText(input.tildaNotifyUrl)},
            ${nullableText(input.tildaSuccessUrl)},
            ${nullableText(input.tildaFailureUrl)},
            ${nullableText(input.tildaPendingUrl)},
            ${nullableText(input.pricpayNotifyUrl)},
            ${nullableText(input.pricpayReturnUrl)},
            ${nullableJson(input.rawTildaOrder)}::jsonb
          )
          on conflict (tilda_order_id) do update set
            creation_mode = excluded.creation_mode,
            transaction_amount = excluded.transaction_amount,
            transaction_currency = excluded.transaction_currency,
            customer_email = excluded.customer_email,
            tilda_notify_url = excluded.tilda_notify_url,
            tilda_success_url = excluded.tilda_success_url,
            tilda_failure_url = excluded.tilda_failure_url,
            tilda_pending_url = excluded.tilda_pending_url,
            pricpay_notify_url = excluded.pricpay_notify_url,
            pricpay_return_url = excluded.pricpay_return_url,
            raw_tilda_order = excluded.raw_tilda_order,
            updated_at = now()
          returning *
        `) as Record<string, unknown>[]
        return rows[0] ? normalizeOrder(rows[0]) : undefined
      })(),
      'Gateway order upsert',
    )
  } catch (error) {
    const message = errorMessage(error, 'Unable to upsert gateway order')
    console.error('Gateway order upsert failed:', message)
    return undefined
  }
}

export async function updateGatewayOrder(orderId: string | undefined, update: GatewayOrderUpdate) {
  if (!orderId) return undefined
  const sql = getSql()
  if (!sql) return undefined

  try {
    return await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        const rows = (await sql`
          update gateway_orders
          set
            status = coalesce(${nullableText(update.status)}, status),
            pricpay_order_no = coalesce(${nullableText(update.pricpayOrderNo)}, pricpay_order_no),
            pricpay_redirect_url = coalesce(${nullableText(update.pricpayRedirectUrl)}, pricpay_redirect_url),
            pricpay_request = coalesce(${update.pricpayRequest === undefined ? null : nullableJson(update.pricpayRequest)}::jsonb, pricpay_request),
            pricpay_response = coalesce(${update.pricpayResponse === undefined ? null : nullableJson(update.pricpayResponse)}::jsonb, pricpay_response),
            last_error = case when ${update.lastError !== undefined} then ${nullableText(update.lastError)} else last_error end,
            updated_at = now()
          where id = ${orderId}
          returning *
        `) as Record<string, unknown>[]
        return rows[0] ? normalizeOrder(rows[0]) : undefined
      })(),
      'Gateway order update',
    )
  } catch (error) {
    const message = errorMessage(error, 'Unable to update gateway order')
    console.error('Gateway order update failed:', message)
    return undefined
  }
}

export async function findGatewayOrder(params: { tildaOrderId?: string; pricpayOrderNo?: string }) {
  const tildaOrderId = nullableText(params.tildaOrderId)
  const pricpayOrderNo = nullableText(params.pricpayOrderNo)
  if (!tildaOrderId && !pricpayOrderNo) return undefined

  const sql = getSql()
  if (!sql) return undefined

  try {
    return await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        const rows = (await sql`
          select *
          from gateway_orders
          where (${tildaOrderId}::text is not null and tilda_order_id = ${tildaOrderId})
            or (${pricpayOrderNo}::text is not null and pricpay_order_no = ${pricpayOrderNo})
          order by updated_at desc
          limit 1
        `) as Record<string, unknown>[]
        return rows[0] ? normalizeOrder(rows[0]) : undefined
      })(),
      'Gateway order lookup',
    )
  } catch (error) {
    const message = errorMessage(error, 'Unable to find gateway order')
    console.error('Gateway order lookup failed:', message)
    return undefined
  }
}

export async function recordPaymentNotification(input: PaymentNotificationInput) {
  const sql = getSql()
  if (!sql) return undefined

  try {
    await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        await sql`
          insert into payment_notifications (
            id,
            order_id,
            platform_order_no,
            tilda_order_id,
            order_status,
            amount,
            currency,
            verified,
            forwarded_to_tilda,
            tilda_response_status,
            raw_body
          )
          values (
            ${randomUUID()},
            ${input.orderId ?? null},
            ${nullableText(input.platformOrderNo)},
            ${nullableText(input.tildaOrderId)},
            ${nullableText(input.orderStatus)},
            ${nullableText(input.amount)},
            ${nullableText(input.currency)},
            ${input.verified},
            ${input.forwardedToTilda ?? false},
            ${input.tildaResponseStatus ?? null},
            ${nullableJson(input.rawBody)}::jsonb
          )
        `
      })(),
      'Payment notification write',
    )
  } catch (error) {
    const message = errorMessage(error, 'Unable to record payment notification')
    console.error('Payment notification write failed:', message)
  }
}

export async function getGatewayLogCounts() {
  const sql = getSql()
  if (!sql) return undefined

  try {
    return await withDatabaseTimeout(
      (async () => {
        await ensureGatewaySchema(sql)
        const rows = (await sql`
          select
            (select count(*) from gateway_orders) as orders,
            (select count(*) from gateway_events) as events,
            (select count(*) from payment_notifications) as notifications
        `) as Record<string, unknown>[]
        const row = rows[0] ?? {}
        return {
          orders: Number(row.orders ?? 0),
          events: Number(row.events ?? 0),
          notifications: Number(row.notifications ?? 0),
        }
      })(),
      'Gateway count query',
    )
  } catch (error) {
    const message = errorMessage(error, 'Unable to count gateway logs')
    console.error('Gateway count query failed:', message)
    return undefined
  }
}
