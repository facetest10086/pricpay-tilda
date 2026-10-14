import { NextResponse } from 'next/server'
import { handlePricpayCreate } from '@/lib/pricpay-create-handler'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handlePricpayCreate(request, 'create')
}

export async function GET() {
  return NextResponse.json({
    service: 'tilda-pricpay-gateway',
    endpoint: 'POST /api/pricpay/create',
    mode: 'PricPay v2 checkout',
  })
}
