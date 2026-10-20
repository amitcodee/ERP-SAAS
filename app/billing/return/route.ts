import { redirectHere } from '@/lib/http'
import { requestOrg } from '@/lib/tenant/request'
import { billingProvider } from '@/modules/billing/providers'
import { completePayment } from '@/modules/billing/service'

export const dynamic = 'force-dynamic'

// Back from the payment page, on the institute's own address. The provider signs what it sends; a right signature
// completes the payment (once: the webhook may have done it already). Then back to Settings → Plan & billing.
export async function GET(req: Request) {
  const provider = billingProvider()
  const org = await requestOrg()
  const paid = provider && org ? provider.verifyCallback(new URL(req.url).searchParams) : null
  if (!provider || !paid) return redirectHere('/settings?tab=billing&payment=failed')
  const r = await completePayment(provider.name, paid)
  return redirectHere(`/settings?tab=billing&payment=${r.ok && r.orgId === org!.id ? 'paid' : 'failed'}`)
}
