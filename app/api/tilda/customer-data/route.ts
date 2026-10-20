import { CustomerDataError, parseCustomerSubmission } from '@/lib/tilda-customer-data'
import { saveCustomerData } from '@/lib/tilda-customer-store'

export const runtime = 'nodejs'
const maxBodyBytes = 8192

function response(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get('origin')
  const allowed = process.env.TILDA_SITE_ORIGIN ?? 'https://hoteltoiletries.ru'
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' }
  if (origin === allowed) headers['Access-Control-Allow-Origin'] = allowed
  return Response.json(body, { status, headers })
}

export function OPTIONS(request: Request) {
  const result = response(request, null)
  result.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  result.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return result
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== (process.env.TILDA_SITE_ORIGIN ?? 'https://hoteltoiletries.ru')) {
    return response(request, { ok: false, error: 'Origin is not allowed' }, 403)
  }
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^(application\/json|text\/plain)(?:;|$)/i.test(contentType)) {
    return response(request, { ok: false, error: 'Expected JSON customer data' }, 415)
  }
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new CustomerDataError('Missing customer data')
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBodyBytes) {
        await reader.cancel()
        throw new CustomerDataError('Customer data is too large', 413)
      }
      chunks.push(value)
    }
    let input: unknown
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new CustomerDataError('Invalid customer data JSON')
    }
    const { orderId, tokenHash, customer } = parseCustomerSubmission(input)
    if (!await saveCustomerData(orderId, tokenHash, customer)) {
      throw new CustomerDataError('This customer-data submission cannot be changed. Please submit the cart again.', 409)
    }
    return response(request, { ok: true })
  } catch (error) {
    if (error instanceof CustomerDataError) return response(request, { ok: false, error: error.message }, error.status)
    console.error('Tilda customer data storage failed')
    return response(request, { ok: false, error: 'Unable to save customer data. Please retry checkout.' }, 503)
  }
}
