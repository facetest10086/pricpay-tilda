import { NextResponse } from 'next/server'
import { recordGatewayEvent } from '@/lib/gateway-log'

export const runtime = 'nodejs'

function isAuthorized(request: Request) {
  if (!process.env.VERCEL) return true

  const token = process.env.GATEWAY_HEALTH_TOKEN
  if (!token) return false

  const url = new URL(request.url)
  return request.headers.get('authorization') === `Bearer ${token}` || url.searchParams.get('token') === token
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const result = await recordGatewayEvent({
    eventType: 'neon.healthcheck',
    direction: 'internal',
    endpoint: '/api/neon/health',
    method: 'GET',
    statusCode: 200,
    requestBody: { source: 'healthcheck' },
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error, skipped: result.skipped ?? false }, { status: 500 })
  }

  return NextResponse.json({ ok: true, service: 'neon-postgres' })
}
