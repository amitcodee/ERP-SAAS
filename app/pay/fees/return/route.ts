import { redirectHere } from '@/lib/http'
import { requestOrg } from '@/lib/tenant/request'
import { completeFeePayment, feeReturnPath, feeReturnUrl, verifyFeeReturn } from '@/modules/fees/online'

export const dynamic = 'force-dynamic'

// Back from a fee payment page, on the institute's own address. The provider signs what it sends; a right signature
// records the payment (once: the webhook may have done it already), even if the session ran out meanwhile. Then back
// to the student's Fees, or to the parents' page when a parent paid through their link, which says how it went.
export async function GET(req: Request) {
  const org = await requestOrg()
  const q = new URL(req.url).searchParams
  const paid = org ? await verifyFeeReturn(org.id, q) : null
  // which page opened it only picks the way back (the reference is checked when there is a payment to record)
  const back = org ? await feeReturnPath(org.id, paid?.ref ?? q.get('razorpay_payment_link_reference_id') ?? q.get('ref')) : '/'
  const to = (s: string, receipt?: string) => feeReturnUrl(back, s, receipt)
  if (!org || !paid) return redirectHere(to('failed'))
  const r = await completeFeePayment(org.id, paid)
  return redirectHere(to(!r.ok ? 'failed' : r.review ? 'review' : 'paid', r.receiptNo))
}
