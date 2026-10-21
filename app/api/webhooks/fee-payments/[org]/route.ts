import { log } from '@/lib/log'
import { completeFeePayment, verifyFeeWebhook } from '@/modules/fees/online'

export const dynamic = 'force-dynamic'

// Razorpay's webhook for one institute's fee payments (Settings → Online payments shows this address): signed with
// the institute's own webhook secret. A paid payment page is recorded once (the browser's return may have done it).
// Anything else is acknowledged and left alone, so Razorpay does not keep retrying it.
export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  if (!/^[0-9a-f-]{36}$/i.test(org)) return new Response('Not found', { status: 404 })
  const raw = await req.text()
  const paid = await verifyFeeWebhook(org, raw, req.headers).catch(() => 'bad' as const)
  if (paid === 'bad') return new Response('Bad signature', { status: 401 })
  if (!paid) return Response.json({ ok: true, ignored: true })
  const r = await completeFeePayment(org, paid)
  if (!r.ok) log.warn('fees.online_webhook_unknown', { org, ref: paid.ref })
  return Response.json({ ok: true })
}
