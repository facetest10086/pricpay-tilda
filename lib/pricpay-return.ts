type ReturnOrderUrls = {
  tildaSuccessUrl?: string | null
  tildaFailureUrl?: string | null
  tildaPendingUrl?: string | null
}

type ReturnDefaults = {
  successUrl?: string
  failureUrl?: string
  pendingUrl?: string
  siteOrigin?: string
}

export function resolvePricpayReturn({ order, verifiedPaid, reportedStatus, requestUrl, defaults = {} }: {
  order?: ReturnOrderUrls
  verifiedPaid: boolean
  reportedStatus: string
  requestUrl: string
  defaults?: ReturnDefaults
}) {
  const reported = reportedStatus.toUpperCase()
  const status = verifiedPaid ? 'paid'
    : ['120', 'FAILED', 'FAILURE', 'DECLINED'].includes(reported) ? 'failed'
      : ['CANCEL', 'CANCELED', 'CANCELLED'].includes(reported) ? 'cancelled' : 'pending'
  let target: string | null | undefined
  if (status === 'paid') target = order?.tildaSuccessUrl || defaults.successUrl
  else if (status === 'failed' || status === 'cancelled') target = order?.tildaFailureUrl || defaults.failureUrl
  else target = order?.tildaPendingUrl || defaults.pendingUrl
  const shopUrl = defaults.siteOrigin || order?.tildaFailureUrl || order?.tildaSuccessUrl ||
    defaults.failureUrl || defaults.successUrl || requestUrl
  return { status, target: target || new URL('/', shopUrl).toString() }
}
