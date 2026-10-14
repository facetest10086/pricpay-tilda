import { NextResponse } from 'next/server'
import {
  getOrderAmount,
  getOrderCurrency,
  getOrderNumber,
  getTildaGatewayUrls,
  isConfigured,
  parseBody,
  preparePricpayCheckout,
  submitPricpayCheckout,
  value,
  type PricpayCreateMode,
} from '@/lib/pricpay'
import { recordGatewayEvent, updateGatewayOrder, upsertGatewayOrder } from '@/lib/gateway-log'

function publicCheckoutResponse(result: Awaited<ReturnType<typeof submitPricpayCheckout>>) {
  const orderNo = result.pricpayOrderNo || result.orderNumber
  return {
    ok: true,
    orderNo,
    target: result.target,
    redirectUrl: result.redirectUrl,
  }
}

function shouldReturnJson(request: Request) {
  const url = new URL(request.url)
  const accept = request.headers.get('accept') ?? ''
  return url.searchParams.get('response') === 'json' || accept.includes('application/json')
}

export async function handlePricpayCreate(request: Request, mode: PricpayCreateMode) {
  const endpoint = `/api/pricpay/${mode}`
  let orderId: string | undefined
  let tildaOrderId = ''

  try {
    const order = parseBody(await request.text(), request.headers.get('content-type') ?? '')
    tildaOrderId = getOrderNumber(order)
    const amount = getOrderAmount(order)
    const currency = getOrderCurrency(order)
    const urls = getTildaGatewayUrls(order)

    if (!tildaOrderId) {
      await recordGatewayEvent({
        eventType: `pricpay.${mode}.missing_order_id`,
        direction: 'inbound',
        endpoint,
        method: 'POST',
        statusCode: 400,
        requestBody: order,
        errorMessage: 'Missing Tilda order id',
      })
      return NextResponse.json({ ok: false, error: 'Missing Tilda order id' }, { status: 400 })
    }

    const prepared = preparePricpayCheckout(order, request.url, mode)
    const savedOrder = await upsertGatewayOrder({
      tildaOrderId,
      creationMode: mode,
      transactionAmount: amount,
      transactionCurrency: currency,
      customerEmail: value(order, 'email', 'billingEmail'),
      tildaNotifyUrl: urls.notifyUrl,
      tildaSuccessUrl: urls.successUrl,
      tildaFailureUrl: urls.failureUrl,
      tildaPendingUrl: urls.pendingUrl,
      pricpayNotifyUrl: prepared.notifyUrl,
      pricpayReturnUrl: prepared.returnUrl,
      rawTildaOrder: order,
    })
    orderId = savedOrder?.id

    await recordGatewayEvent({
      eventType: `pricpay.${mode}.request`,
      direction: 'inbound',
      endpoint,
      method: 'POST',
      orderId,
      tildaOrderId,
      requestBody: order,
    })

    if (!isConfigured(mode)) {
      const message = mode === 'cashier'
        ? 'PricPay cashier endpoint is not configured'
        : 'PricPay create endpoint is not configured'
      await updateGatewayOrder(orderId, { status: 'configuration_error', lastError: message })
      await recordGatewayEvent({
        eventType: `pricpay.${mode}.configuration_error`,
        direction: 'internal',
        endpoint,
        method: 'POST',
        statusCode: 500,
        orderId,
        tildaOrderId,
        requestBody: order,
        errorMessage: message,
      })
      return NextResponse.json({ ok: false, error: message }, { status: 500 })
    }

    await updateGatewayOrder(orderId, {
      status: 'gateway_request_ready',
      pricpayRequest: prepared.requestPayload,
    })
    await recordGatewayEvent({
      eventType: `pricpay.${mode}.gateway_request`,
      direction: 'outbound',
      endpoint: prepared.endpoint,
      method: 'POST',
      orderId,
      tildaOrderId,
      requestBody: prepared.requestPayload,
      signatureBase: prepared.signatureBase,
      signatureResult: prepared.signatureResult,
    })

    const result = await submitPricpayCheckout(prepared)
    await updateGatewayOrder(orderId, {
      status: 'redirect_created',
      pricpayOrderNo: result.pricpayOrderNo,
      pricpayRedirectUrl: result.redirectUrl,
      pricpayResponse: result.responseBody,
    })
    await recordGatewayEvent({
      eventType: `pricpay.${mode}.gateway_response`,
      direction: 'inbound',
      endpoint: prepared.endpoint,
      method: 'POST',
      statusCode: result.httpStatus,
      orderId,
      tildaOrderId,
      pricpayOrderNo: result.pricpayOrderNo,
      responseBody: result.responseBody,
      redirectUrl: result.redirectUrl,
    })

    if (shouldReturnJson(request)) {
      return NextResponse.json(publicCheckoutResponse(result))
    }

    return NextResponse.redirect(result.redirectUrl, { status: 303 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment'
    await updateGatewayOrder(orderId, { status: 'create_error', lastError: message })
    await recordGatewayEvent({
      eventType: `pricpay.${mode}.error`,
      direction: 'internal',
      endpoint,
      method: 'POST',
      statusCode: 400,
      orderId,
      tildaOrderId,
      errorMessage: message,
    })
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }
}
