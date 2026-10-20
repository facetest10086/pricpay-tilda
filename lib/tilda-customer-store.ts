import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import type { CustomerFields } from './tilda-customer-data'

export const customerSchemaStatements = [
  `create table if not exists tilda_customer_data (
    tilda_order_id text not null,
    token_hash text not null,
    customer_data jsonb not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '30 minutes'),
    primary key (tilda_order_id, token_hash)
  )`,
  `create index if not exists tilda_customer_data_expires_at_idx on tilda_customer_data (expires_at)`,
]

let client: NeonQueryFunction<false, false> | undefined
let schemaReady: Promise<void> | undefined

function customerSql() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Customer data database is not configured')
  client ??= neon(databaseUrl)
  return client
}

async function ensureCustomerSchema(signal: AbortSignal) {
  const sql = customerSql()
  schemaReady ??= (async () => {
    for (const statement of customerSchemaStatements) await sql.query(statement, [], { fetchOptions: { signal } })
  })().catch((error) => {
    schemaReady = undefined
    throw error
  })
  await schemaReady
  return sql
}

export async function saveCustomerData(orderId: string, tokenHash: string, customer: CustomerFields) {
  const signal = AbortSignal.timeout(5000)
  const sql = await ensureCustomerSchema(signal)
  const rows = await sql.query(`
    with expired as (delete from tilda_customer_data where expires_at < now())
    insert into tilda_customer_data (tilda_order_id, token_hash, customer_data)
    values ($1, $2, $3::jsonb)
    on conflict (tilda_order_id, token_hash) do update
      set customer_data = tilda_customer_data.customer_data
      where tilda_customer_data.customer_data = excluded.customer_data
        and tilda_customer_data.expires_at > now()
    returning tilda_order_id`, [orderId, tokenHash, JSON.stringify(customer)], { fetchOptions: { signal } })
  return rows.length === 1
}

export async function findCustomerData(orderId: string, tokenHash: string, signal: AbortSignal) {
  const sql = await ensureCustomerSchema(signal)
  const rows = await sql.query(`select customer_data from tilda_customer_data
    where tilda_order_id = $1 and token_hash = $2 and expires_at > now()`,
  [orderId, tokenHash], { fetchOptions: { signal } })
  return rows[0]?.customer_data
}
