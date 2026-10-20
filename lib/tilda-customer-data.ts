import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export type CustomerFields = {
  firstName: string
  lastName: string
  customerCountry: string
  state: string
  city: string
  address: string
  zip: string
  email: string
  phone: string
}

export class CustomerDataError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CustomerDataError'
    this.status = status
  }
}

export function customerTokenHash(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new CustomerDataError('Missing or invalid customer data token')
  return createHash('sha256').update(token).digest('hex')
}

function objectFields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CustomerDataError('Invalid customer data')
  }
  return input as Record<string, unknown>
}

function customerText(input: Record<string, unknown>, key: string, required = true, maxLength = 200) {
  const raw = input[key]
  const text = typeof raw === 'string' ? raw.trim() : ''
  const value = key === 'address' ? text.replace(/\r\n?|\n/g, ', ') : text
  if ((required && !value) || (raw !== undefined && typeof raw !== 'string') ||
      value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value) || value.toLowerCase() === key.toLowerCase()) {
    throw new CustomerDataError(`Invalid customer field: ${key}`)
  }
  return value
}

export function parseCustomerFields(input: unknown): CustomerFields {
  const fields = objectFields(input)
  const customer = {
    firstName: customerText(fields, 'firstName'),
    lastName: customerText(fields, 'lastName'),
    customerCountry: customerText(fields, 'customerCountry').toUpperCase(),
    state: customerText(fields, 'state', false),
    city: customerText(fields, 'city'),
    address: customerText(fields, 'address', true, 500),
    zip: customerText(fields, 'zip', true, 32),
    email: customerText(fields, 'email', true, 254),
    phone: customerText(fields, 'phone', true, 64),
  }
  if (!/^[A-Z]{2}$/.test(customer.customerCountry)) throw new CustomerDataError('Invalid customer field: customerCountry')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new CustomerDataError('Invalid customer field: email')
  if (!/^\+?[\d\s().-]+$/.test(customer.phone) || !/^\d{7,20}$/.test(customer.phone.replace(/\D/g, ''))) {
    throw new CustomerDataError('Invalid customer field: phone')
  }
  return customer
}

function orderIdText(input: unknown) {
  if (typeof input !== 'string' || !/^[1-9]\d{0,19}:[1-9]\d{0,19}$/.test(input)) {
    throw new CustomerDataError('Invalid Tilda order ID: expected projectId:orderId')
  }
  return input
}

export function parseCustomerSubmission(input: unknown) {
  const body = objectFields(input)
  return {
    orderId: orderIdText(body.orderId),
    tokenHash: customerTokenHash(typeof body.token === 'string' ? body.token : ''),
    customer: parseCustomerFields(body.customer),
  }
}

type CustomerLoader = (orderId: string, tokenHash: string, signal: AbortSignal) => Promise<unknown | undefined>

export async function resolveCustomerOrder(
  order: Record<string, unknown>,
  load: CustomerLoader,
  { timeoutMs = 8000, pollMs = 250 } = {},
) {
  const orderId = orderIdText(order.orderid ?? order.orderId ?? order.order_number ?? order.orderNumber ?? order.id)
  const hash = customerTokenHash(typeof order.customerDataToken === 'string' ? order.customerDataToken : '')
  const signal = AbortSignal.timeout(timeoutMs)
  while (!signal.aborted) {
    let stored: unknown
    try {
      stored = await load(orderId, hash, signal)
    } catch {
      if (signal.aborted) break
      throw new CustomerDataError('Customer data is temporarily unavailable. Please retry checkout.', 503)
    }
    if (signal.aborted) break
    if (stored !== undefined) {
      const customer = parseCustomerFields(stored)
      const email = String(order.email ?? order.billingEmail ?? '').trim().toLowerCase()
      const phone = String(order.phone ?? order.telephone ?? order.billingTelephone ?? '').replace(/\D/g, '')
      if (email && email !== customer.email.toLowerCase()) throw new CustomerDataError('Customer email does not match the payment order')
      if (phone && phone !== customer.phone.replace(/\D/g, '')) throw new CustomerDataError('Customer phone does not match the payment order')
      // Only validated customer fields can override the payment request.
      return { ...order, ...customer }
    }
    try {
      await delay(pollMs, undefined, { signal })
    } catch (error) {
      if (!signal.aborted) throw error
    }
  }
  throw new CustomerDataError('Customer data did not arrive. Please return to the store and submit the cart again.', 504)
}
