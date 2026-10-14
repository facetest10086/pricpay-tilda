import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

type GatewayEvent = {
  eventType: string
  direction: 'inbound' | 'outbound' | 'internal'
  endpoint?: string
  method?: string
  statusCode?: number
  tildaOrderId?: string
  pricpayOrderNo?: string
  requestBody?: unknown
  responseBody?: unknown
  redirectUrl?: string
  errorMessage?: string
}

type LogResult = { ok: true } | { ok: false; error: string; skipped?: boolean }

let sqlClient: ReturnType<typeof neon> | undefined
let schemaReady: Promise<void> | undefined

function getSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) return undefined
  sqlClient ??= neon(databaseUrl)
  return sqlClient
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
        lower.includes('card')
      ) {
        return [key, '[REDACTED]']
      }
      return [key, redact(entry)]
    }),
  )
}

async function ensureGatewayEventsTable(sql: ReturnType<typeof neon>) {
  schemaReady ??= sql`
      create table if not exists gateway_events (
        id text primary key,
        event_type text not null,
        direction text not null,
        endpoint text,
        http_method text,
        status_code integer,
        tilda_order_id text,
        pricpay_order_no text,
        request_body jsonb,
        response_body jsonb,
        redirect_url text,
        error_message text,
        created_at timestamptz not null default now()
      )
    `
    .then(() => undefined)
    .catch((error) => {
      schemaReady = undefined
      throw error
    })
  await schemaReady
}

export async function recordGatewayEvent(event: GatewayEvent): Promise<LogResult> {
  const sql = getSql()
  if (!sql) return { ok: false, skipped: true, error: 'DATABASE_URL is not configured' }

  try {
    await ensureGatewayEventsTable(sql)
    await sql`
      insert into gateway_events (
        id,
        event_type,
        direction,
        endpoint,
        http_method,
        status_code,
        tilda_order_id,
        pricpay_order_no,
        request_body,
        response_body,
        redirect_url,
        error_message
      )
      values (
        ${randomUUID()},
        ${event.eventType},
        ${event.direction},
        ${event.endpoint ?? null},
        ${event.method ?? null},
        ${event.statusCode ?? null},
        ${event.tildaOrderId ?? null},
        ${event.pricpayOrderNo ?? null},
        ${JSON.stringify(redact(event.requestBody ?? null))}::jsonb,
        ${JSON.stringify(redact(event.responseBody ?? null))}::jsonb,
        ${event.redirectUrl ?? null},
        ${event.errorMessage ?? null}
      )
    `
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to write gateway event'
    console.error('Gateway log write failed:', message)
    return { ok: false, error: message }
  }
}
