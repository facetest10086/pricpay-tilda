import { NextResponse } from 'next/server'
import { findGatewayOrder, hasVerifiedGatewayPayment, recordGatewayEvent } from '@/lib/gateway-log'
import { value } from '@/lib/pricpay'
import { resolvePricpayReturn } from '@/lib/pricpay-return'

export const runtime = 'nodejs'

function appendReturnParams(target: string, requestUrl: string, params: Record<string, string>) {
  const url = new URL(target, requestUrl)
  for (const [key, entry] of Object.entries(params)) {
    if (entry) url.searchParams.set(key, entry)
  }
  return url.toString()
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = Object.fromEntries(url.searchParams.entries())
  const tildaOrderId = value(params, 'orderNumber', 'order', 'merchantOrderNo')
  const pricpayOrderNo = value(params, 'platformOrderNo', 'orderNo')
  const orderStatus = value(params, 'orderStatus')
  const found = await findGatewayOrder({ tildaOrderId, pricpayOrderNo })
  const order = found && (!tildaOrderId || found.tildaOrderId === tildaOrderId) &&
    (!pricpayOrderNo || found.pricpayOrderNo === pricpayOrderNo) ? found : undefined
  const outcome = resolvePricpayReturn({
    order, reportedStatus: orderStatus, verifiedPaid: await hasVerifiedGatewayPayment(order), requestUrl: request.url,
    defaults: { successUrl: process.env.TILDA_SUCCESS_URL, failureUrl: process.env.TILDA_FAILURE_URL,
      pendingUrl: process.env.TILDA_PENDING_URL, siteOrigin: process.env.TILDA_SITE_ORIGIN },
  })
  const redirectUrl = appendReturnParams(outcome.target, request.url, {
    orderid: tildaOrderId || order?.tildaOrderId || '',
    status: outcome.status,
    pricpayOrderNo,
  })

  await recordGatewayEvent({
    eventType: 'pricpay.return.redirect',
    direction: 'inbound',
    endpoint: '/api/pricpay/return',
    method: 'GET',
    statusCode: 307,
    orderId: order?.id,
    tildaOrderId: tildaOrderId || order?.tildaOrderId,
    pricpayOrderNo,
    requestBody: params,
    redirectUrl,
  })

  const response = NextResponse.redirect(redirectUrl)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
