import { NextResponse } from 'next/server'
import { createPricpayCheckout, isConfigured, parseBody } from '@/lib/pricpay'
import { recordGatewayEvent } from '@/lib/gateway-log'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const order = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    await recordGatewayEvent({
      eventType: 'pricpay.create.request',
      direction: 'inbound',
      endpoint: '/api/pricpay/create',
      method: 'POST',
      requestBody: order,
      tildaOrderId: String(order.orderid ?? order.orderId ?? order.order_number ?? order.orderNumber ?? order.id ?? ''),
    })

    if (!isConfigured()) {
      await recordGatewayEvent({
        eventType: 'pricpay.create.error',
        direction: 'internal',
        endpoint: '/api/pricpay/create',
        method: 'POST',
        statusCode: 500,
        requestBody: order,
        errorMessage: 'Payment gateway is not configured',
      })
      return NextResponse.json({ error: 'Payment gateway is not configured' }, { status: 500 })
    }

    const result = await createPricpayCheckout(order, request.url)
    await recordGatewayEvent({
      eventType: 'pricpay.create.response',
      direction: 'outbound',
      endpoint: '/api/pricpay/create',
      method: 'POST',
      statusCode: 200,
      requestBody: order,
      responseBody: result,
      redirectUrl: result.target,
      pricpayOrderNo: result.orderNo,
    })
    return NextResponse.json({ ok: true, ...result, redirectUrl: result.target })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment'
    await recordGatewayEvent({
      eventType: 'pricpay.create.error',
      direction: 'internal',
      endpoint: '/api/pricpay/create',
      method: 'POST',
      statusCode: 400,
      errorMessage: message,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ service: 'tilda-pricpay-gateway', endpoint: 'POST /api/pricpay/create' })
}

