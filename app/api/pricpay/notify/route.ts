import { NextResponse } from 'next/server'
import { parseBody, postForm, pricpayStatusToOrderStatus, toTildaNotification, value, verifySignature } from '@/lib/pricpay'
import { findGatewayOrder, recordGatewayEvent, recordPaymentNotification, updateGatewayOrder } from '@/lib/gateway-log'
import { isTildaNotificationAccepted, normalizeNotificationAmount } from '@/lib/pricpay-notification'

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
    tildaOrderId = value(bodyParams, 'orderNumber', 'merchantOrderNo')
    pricpayOrderNo = value(bodyParams, 'platformOrderNo', 'orderNo')
    const orderStatus = value(bodyParams, 'orderStatus')
    const amount = value(bodyParams, 'transactionAmount', 'amount')
    const currency = value(bodyParams, 'transactionCurrency', 'currency')

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
      return new Response('Invalid signature', { status: 401 })
    }

    let normalizedAmount = amount
    if (orderStatus === '100') {
      const signedOrderId = value(bodyParams, 'orderNumber', 'merchantOrderNo')
      if (!order || !signedOrderId || order.tildaOrderId !== signedOrderId) {
        await recordGatewayEvent({
          eventType: 'pricpay.notify.order_missing', direction: 'internal', endpoint: '/api/pricpay/notify',
          method: 'POST', statusCode: 503, tildaOrderId, pricpayOrderNo,
          errorMessage: 'Original order is unavailable for payment verification',
        })
        return new Response('Original order is unavailable', { status: 503 })
      }
      try {
        const payment = normalizeNotificationAmount(bodyParams, order, process.env.PRICPAY_NOTIFY_AMOUNT_UNIT ?? 'minor')
        normalizedAmount = payment.amount
        await recordGatewayEvent({
          eventType: 'pricpay.notify.amount_verified', direction: 'internal', endpoint: '/api/pricpay/notify',
          method: 'POST', statusCode: 200, orderId, tildaOrderId, pricpayOrderNo,
          responseBody: { receivedAmount: amount, normalizedAmount, currency: payment.currency, amountUnit: payment.amountUnit },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to verify notification amount'
        await updateGatewayOrder(orderId, { status: 'notify_amount_mismatch', lastError: message })
        await recordGatewayEvent({
          eventType: 'pricpay.notify.amount_mismatch', direction: 'internal', endpoint: '/api/pricpay/notify',
          method: 'POST', statusCode: 400, orderId, tildaOrderId, pricpayOrderNo,
          requestBody: bodyParams, errorMessage: message,
        })
        return new Response('Notification amount or currency verification failed', { status: 400 })
      }
    }

    const nextStatus = pricpayStatusToOrderStatus(orderStatus)
    await updateGatewayOrder(orderId, {
      status: nextStatus,
      pricpayOrderNo,
      pricpayResponse: params,
      lastError: '',
    })

    const target = order?.tildaNotifyUrl || value(bodyParams, 'target') || process.env.TILDA_NOTIFY_URL || ''
    if (orderStatus === '100' && target) {
      const tildaBody = toTildaNotification(bodyParams, target, tildaOrderId, normalizedAmount)
      try {
        const response = await postForm(target, tildaBody)
        const responseText = await response.text().catch(() => '')
        const accepted = isTildaNotificationAccepted(response.status, responseText)
        await recordPaymentNotification({
          orderId,
          platformOrderNo: pricpayOrderNo,
          tildaOrderId,
          orderStatus,
          amount: normalizedAmount,
          currency,
          verified: true,
          forwardedToTilda: accepted,
          tildaResponseStatus: response.status,
          rawBody: { request: tildaBody, response: responseText.slice(0, 1000) },
        })
        await recordGatewayEvent({
          eventType: accepted ? 'tilda.notify.forwarded' : 'tilda.notify.rejected',
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
        if (!accepted) {
          await updateGatewayOrder(orderId, {
            status: 'tilda_notify_error',
            lastError: `Tilda rejected notification (HTTP ${response.status}): ${responseText.slice(0, 200)}`,
          })
          return new Response('Tilda rejected notification', { status: 502 })
        }
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
        return new Response('Unable to notify Tilda', { status: 502 })
      }
    } else if (orderStatus === '100') {
      await updateGatewayOrder(orderId, { status: 'paid_tilda_notify_missing', lastError: 'Missing Tilda notify URL' })
      await recordGatewayEvent({
        eventType: 'tilda.notify.missing_target',
        direction: 'internal',
        endpoint: '/api/pricpay/notify',
        method: 'POST',
        statusCode: 503,
        orderId,
        tildaOrderId,
        pricpayOrderNo,
        requestBody: params,
        errorMessage: 'Missing Tilda notify URL',
      })
      return new Response('Missing Tilda notify URL', { status: 503 })
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
