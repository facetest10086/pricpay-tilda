import { NextResponse } from 'next/server'
import { postForm, parseBody, toTildaNotification, verifySignature } from '@/lib/pricpay'
import { recordGatewayEvent } from '@/lib/gateway-log'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const params = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    await recordGatewayEvent({
      eventType: 'pricpay.notify.request',
      direction: 'inbound',
      endpoint: '/api/pricpay/notify',
      method: 'POST',
      requestBody: params,
      tildaOrderId: String(params.order ?? params.orderNumber ?? ''),
      pricpayOrderNo: String(params.orderNo ?? params.platformOrderNo ?? ''),
    })

    if (!verifySignature(params)) {
      await recordGatewayEvent({
        eventType: 'pricpay.notify.invalid_signature',
        direction: 'internal',
        endpoint: '/api/pricpay/notify',
        method: 'POST',
        statusCode: 401,
        requestBody: params,
        errorMessage: 'Invalid signature',
      })
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
    }

    const target = String(params.target ?? '')
    if (target) {
      const body = toTildaNotification(params, target, String(params.order ?? ''), String(params.amount ?? ''))
      await postForm(target, body)
      await recordGatewayEvent({
        eventType: 'tilda.notify.forwarded',
        direction: 'outbound',
        endpoint: target,
        method: 'POST',
        statusCode: 200,
        requestBody: body,
        tildaOrderId: String(body.orderid ?? ''),
      })
    }

    return new Response('ok')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid notification'
    await recordGatewayEvent({
      eventType: 'pricpay.notify.error',
      direction: 'internal',
      endpoint: '/api/pricpay/notify',
      method: 'POST',
      statusCode: 400,
      errorMessage: message,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
