import { log } from '@/lib/log'
import { billingProvider } from '@/modules/billing/providers'
import { completePayment, recordBillingEvent } from '@/modules/billing/service'

export const dynamic = 'force-dynamic'

// Razorpay's webhook (set it to https://<root>/api/webhooks/razorpay with the payment_link.paid event). Signed with
// RAZORPAY_WEBHOOK_SECRET; each event is handled once (Razorpay retries); a payment completes once whichever of
// this and the browser's return comes first.
export async function POST(req: Request) {
  const provider = billingProvider()
  if (provider?.name !== 'razorpay') return Response.json({ error: 'not set up' }, { status: 404 })
  const raw = await req.text()
  const ev = provider.verifyWebhook(raw, req.headers)
  if (!ev) return Response.json({ error: 'bad signature' }, { status: 401 })
  const fresh = await recordBillingEvent('razorpay', ev.eventId, ev.type, ev.payload)
  if (fresh && ev.paid) {
    const r = await completePayment('razorpay', ev.paid)
    if (!r.ok) log.warn('billing.webhook_unknown_payment', { ref: ev.paid.ref })
  }
  return Response.json({ ok: true })
}
