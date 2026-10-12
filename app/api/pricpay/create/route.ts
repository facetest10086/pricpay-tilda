import { NextResponse } from 'next/server'
import { createPricpayCheckout, isConfigured, parseBody } from '@/lib/pricpay'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: 'Payment gateway is not configured' }, { status: 500 })
  }

  try {
    const order = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    const result = await createPricpayCheckout(order, request.url)
    return NextResponse.json({ ok: true, ...result, redirectUrl: result.target })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ service: 'tilda-pricpay-gateway', endpoint: 'POST /api/pricpay/create' })
}

