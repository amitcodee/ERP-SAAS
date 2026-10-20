import { notFound } from 'next/navigation'
import { PaperSlip } from '@/components/paper-slip'
import { ReceiptSheet } from '@/components/receipt-sheet'
import { appOrigin, qrSvg } from '@/lib/app-url'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { getReceipt } from '@/modules/fees/service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Receipt | techcadd' }

// Login required (proxy.ts) and branch-scoped by RLS: a receipt of another branch simply is not found.
export default async function ReceiptPage({ params }: { params: Promise<{ receiptNo: string }> }) {
  const { receiptNo } = await params
  const { actor } = await getActor()
  const r = await withTenant(actor, (tx) => getReceipt(tx, actor, decodeURIComponent(receiptNo))).catch(() => null)
  if (!r) notFound()
  if (r.paperSlip) return <PaperSlip r={r} /> // a paper slip is shown as it was uploaded: no e-receipt is made from it
  const verifyUrl = `${await appOrigin(actor.orgId)}/verify/receipt/${r.token}`
  return <ReceiptSheet r={r} qr={await qrSvg(verifyUrl)} verifyUrl={verifyUrl} />
}
