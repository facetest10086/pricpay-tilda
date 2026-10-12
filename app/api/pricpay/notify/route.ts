import { NextResponse } from 'next/server'
import { postForm, parseBody, toTildaNotification, verifySignature } from '@/lib/pricpay'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  console.info('[pricpay:notify] callback received', { contentType: request.headers.get('content-type') })

  try {
    const params = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    console.info('[pricpay:notify] callback parsed', { keys: Object.keys(params), orderNumber: params.orderNumber ?? params.orderNo })
    const signatureValid = verifySignature(params)
    console.info('[pricpay:notify] signature verified', { valid: signatureValid })
    if (!signatureValid) {
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
    }

    const target = String(params.target ?? '')
    if (target) {
      const body = toTildaNotification(params, target, String(params.order ?? ''), String(params.amount ?? ''))
      console.info('[pricpay:notify] forwarding to Tilda', { target, orderid: body.orderid, amount: body.amount })
      const response = await postForm(target, body)
      console.info('[pricpay:notify] Tilda response', { status: response.status, ok: response.ok })
    } else {
      console.warn('[pricpay:notify] no Tilda target provided')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid notification'
    console.error('[pricpay:notify] failed', { message })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
