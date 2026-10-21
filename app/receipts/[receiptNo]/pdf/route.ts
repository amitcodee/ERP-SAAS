import { appOrigin } from '@/lib/app-url'
import { redirectHere } from '@/lib/http'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { receiptPdf } from '@/lib/pdf'
import { orgBrand } from '@/lib/brand'
import { getReceipt } from '@/modules/fees/service'

export const dynamic = 'force-dynamic'

// Same access as the receipt page: login required (proxy.ts), branch/student scope by RLS.
export async function GET(_req: Request, { params }: { params: Promise<{ receiptNo: string }> }) {
  const { receiptNo } = await params
  const { actor } = await getActor()
  const r = await withTenant(actor, (tx) => getReceipt(tx, actor, decodeURIComponent(receiptNo))).catch(() => null)
  if (!r) return new Response('Not found', { status: 404 })
  // a paper slip has no generated receipt: its own file is what is downloaded
  if (r.paperSlip) return r.slips[0] ? redirectHere(`/receipts/${encodeURIComponent(r.receiptNo)}/slip/${r.slips[0].id}?download`, 302) : new Response('Not found', { status: 404 })
  const pdf = await receiptPdf(r, `${await appOrigin(actor.orgId)}/verify/receipt/${r.token}`, await orgBrand(actor.orgId))
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${r.receiptNo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
