import { NextResponse } from 'next/server'
import { postForm, parseBody, toTildaNotification, verifySignature } from '@/lib/pricpay'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const params = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    if (!verifySignature(params)) {
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
    }

    const target = String(params.target ?? '')
    if (target) {
      const body = toTildaNotification(params, target, String(params.order ?? ''), String(params.amount ?? ''))
      await postForm(target, body)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid notification'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
