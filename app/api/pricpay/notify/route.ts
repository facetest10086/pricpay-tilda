import { NextResponse } from 'next/server'
import { parseBody, postForm, pricpayStatusToOrderStatus, toTildaNotification, value, verifySignature } from '@/lib/pricpay'
import { findGatewayOrder, recordGatewayEvent, recordPaymentNotification, updateGatewayOrder } from '@/lib/gateway-log'

export const runtime = 'nodejs'

function queryParams(requestUrl: string) {
  return Object.fromEntries(new URL(requestUrl).searchParams.entries())
}

export async function POST(request: Request) {
  let orderId: string | undefined
  let tildaOrderId = ''
  let pricpayOrderNo = ''

  try {
    const bodyParams = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    const params = { ...queryParams(request.url), ...bodyParams }
    tildaOrderId = value(params, 'orderNumber', 'order', 'merchantOrderNo')
    pricpayOrderNo = value(params, 'platformOrderNo', 'orderNo')
    const orderStatus = value(params, 'orderStatus')
    const amount = value(params, 'transactionAmount', 'amount')
    const currency = value(params, 'transactionCurrency', 'currency')

    const order = await findGatewayOrder({ tildaOrderId, pricpayOrderNo })
    orderId = order?.id
    const verified = verifySignature(bodyParams)

    await recordGatewayEvent({
      eventType: 'pricpay.notify.request',
      direction: 'inbound',
      endpoint: '/api/pricpay/notify',
      method: 'POST',
      orderId,
      tildaOrderId,
      pricpayOrderNo,
      requestBody: params,
    })

    await recordPaymentNotification({
      orderId,
      platformOrderNo: pricpayOrderNo,
      tildaOrderId,
      orderStatus,
      amount,
      currency,
      verified,
      rawBody: params,
    })

    if (!verified) {
      await updateGatewayOrder(orderId, { status: 'invalid_notify_signature', lastError: 'Invalid PricPay notification signature' })
      await recordGatewayEvent({
        eventType: 'pricpay.notify.invalid_signature',
        direction: 'internal',
        endpoint: '/api/pricpay/notify',
        method: 'POST',
        statusCode: 401,
        orderId,
        tildaOrderId,
        pricpayOrderNo,
        requestBody: params,
        errorMessage: 'Invalid signature',
      })
      return new Response('ok')
    }

    const nextStatus = pricpayStatusToOrderStatus(orderStatus)
    await updateGatewayOrder(orderId, {
      status: nextStatus,
      pricpayOrderNo,
      pricpayResponse: params,
    })

    const target = order?.tildaNotifyUrl || value(params, 'target') || process.env.TILDA_NOTIFY_URL || ''
    if (orderStatus === '100' && target) {
      const tildaBody = toTildaNotification(params, target, tildaOrderId, amount)
      try {
        const response = await postForm(target, tildaBody)
        const responseText = await response.text().catch(() => '')
        await recordPaymentNotification({
          orderId,
          platformOrderNo: pricpayOrderNo,
          tildaOrderId,
          orderStatus,
          amount,
          currency,
          verified: true,
          forwardedToTilda: true,
          tildaResponseStatus: response.status,
          rawBody: { request: tildaBody, response: responseText.slice(0, 1000) },
        })
        await recordGatewayEvent({
          eventType: 'tilda.notify.forwarded',
          direction: 'outbound',
          endpoint: target,
          method: 'POST',
          statusCode: response.status,
          orderId,
          tildaOrderId,
          pricpayOrderNo,
          requestBody: tildaBody,
          responseBody: { body: responseText.slice(0, 1000) },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to forward notification to Tilda'
        await updateGatewayOrder(orderId, { status: 'tilda_notify_error', lastError: message })
        await recordGatewayEvent({
          eventType: 'tilda.notify.error',
          direction: 'internal',
          endpoint: target,
          method: 'POST',
          statusCode: 502,
          orderId,
          tildaOrderId,
          pricpayOrderNo,
          requestBody: tildaBody,
          errorMessage: message,
        })
      }
    } else if (orderStatus === '100') {
      await updateGatewayOrder(orderId, { status: 'paid_tilda_notify_missing', lastError: 'Missing Tilda notify URL' })
      await recordGatewayEvent({
        eventType: 'tilda.notify.missing_target',
        direction: 'internal',
        endpoint: '/api/pricpay/notify',
        method: 'POST',
        statusCode: 200,
        orderId,
        tildaOrderId,
        pricpayOrderNo,
        requestBody: params,
        errorMessage: 'Missing Tilda notify URL',
      })
    }

    return new Response('ok')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid notification'
    await updateGatewayOrder(orderId, { status: 'notify_error', lastError: message })
    await recordGatewayEvent({
      eventType: 'pricpay.notify.error',
      direction: 'internal',
      endpoint: '/api/pricpay/notify',
      method: 'POST',
      statusCode: 400,
      orderId,
      tildaOrderId,
      pricpayOrderNo,
      errorMessage: message,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
