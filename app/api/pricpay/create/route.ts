import { NextResponse } from 'next/server'
import { createPricpayCheckout, isConfigured, parseBody } from '@/lib/pricpay'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  console.info('[pricpay:create] request received', { method: request.method, contentType: request.headers.get('content-type') })

  if (!isConfigured()) {
    console.error('[pricpay:create] gateway is not configured')
    return NextResponse.json({ error: 'Payment gateway is not configured' }, { status: 500 })
  }

  try {
    const order = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    console.info('[pricpay:create] order parsed', { keys: Object.keys(order), orderNumber: order.orderid ?? order.orderId ?? order.orderNumber })
    const result = await createPricpayCheckout(order, request.url)
    console.info('[pricpay:create] redirect prepared', { orderNo: result.orderNo, target: result.target })
    return NextResponse.json({ ok: true, ...result, redirectUrl: result.target })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment'
    console.error('[pricpay:create] failed', { message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ service: 'tilda-pricpay-gateway', endpoint: 'POST /api/pricpay/create' })
}

