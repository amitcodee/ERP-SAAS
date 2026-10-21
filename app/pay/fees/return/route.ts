import { redirectHere } from '@/lib/http'
import { requestOrg } from '@/lib/tenant/request'
import { completeFeePayment, verifyFeeReturn } from '@/modules/fees/online'

export const dynamic = 'force-dynamic'

// Back from a student's fee payment page, on the institute's own address. The provider signs what it sends; a right
// signature records the payment (once: the webhook may have done it already), even if the session ran out meanwhile.
// Then back to the portal's Fees, which says how it went.
export async function GET(req: Request) {
  const org = await requestOrg()
  const paid = org ? await verifyFeeReturn(org.id, new URL(req.url).searchParams) : null
  if (!org || !paid) return redirectHere('/?tab=fees&payment=failed')
  const r = await completeFeePayment(org.id, paid)
  return redirectHere(`/?tab=fees&payment=${!r.ok ? 'failed' : r.review ? 'review' : 'paid'}${r.receiptNo ? `&receipt=${encodeURIComponent(r.receiptNo)}` : ''}`)
}
