import { NextResponse } from 'next/server'
import { findGatewayOrder, recordGatewayEvent, updateGatewayOrder } from '@/lib/gateway-log'
import { pricpayStatusToOrderStatus, value } from '@/lib/pricpay'

export const runtime = 'nodejs'

function redirectFallback(requestUrl: string) {
  return new URL('/', requestUrl).toString()
}

function appendReturnParams(target: string, requestUrl: string, params: Record<string, string>) {
  const url = new URL(target, requestUrl)
  for (const [key, entry] of Object.entries(params)) {
    if (entry) url.searchParams.set(key, entry)
  }
  return url.toString()
}

function chooseRedirectUrl(orderStatus: string, order: Awaited<ReturnType<typeof findGatewayOrder>>, requestUrl: string) {
  if (orderStatus === '100' || order?.status === 'paid') {
    return order?.tildaSuccessUrl || process.env.TILDA_SUCCESS_URL || redirectFallback(requestUrl)
  }
  if (orderStatus === '120' || order?.status === 'failed') {
    return order?.tildaFailureUrl || process.env.TILDA_FAILURE_URL || redirectFallback(requestUrl)
  }
  return order?.tildaPendingUrl || order?.tildaSuccessUrl || process.env.TILDA_PENDING_URL || process.env.TILDA_SUCCESS_URL || redirectFallback(requestUrl)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = Object.fromEntries(url.searchParams.entries())
  const tildaOrderId = value(params, 'orderNumber', 'order', 'merchantOrderNo')
  const pricpayOrderNo = value(params, 'platformOrderNo', 'orderNo')
  const orderStatus = value(params, 'orderStatus')
  const order = await findGatewayOrder({ tildaOrderId, pricpayOrderNo })
  const nextStatus = orderStatus ? pricpayStatusToOrderStatus(orderStatus) : 'returned'

  if (order?.id && orderStatus) {
    await updateGatewayOrder(order.id, {
      status: nextStatus,
      pricpayOrderNo,
      pricpayResponse: params,
    })
  }

  const redirectUrl = appendReturnParams(chooseRedirectUrl(orderStatus, order, request.url), request.url, {
    orderid: tildaOrderId || order?.tildaOrderId || '',
    status: orderStatus || order?.status || '',
    pricpayOrderNo,
  })

  await recordGatewayEvent({
    eventType: 'pricpay.return.redirect',
    direction: 'inbound',
    endpoint: '/api/pricpay/return',
    method: 'GET',
    statusCode: 302,
    orderId: order?.id,
    tildaOrderId: tildaOrderId || order?.tildaOrderId,
    pricpayOrderNo,
    requestBody: params,
    redirectUrl,
  })

  return NextResponse.redirect(redirectUrl)
}
