import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { paperSlipFile } from '@/modules/fees/service'

export const dynamic = 'force-dynamic'

// The uploaded paper slip of a payment, as it is. Same access as the receipt itself (staff of the branch, or the
// student whose payment it is): whoever may see the receipt may see its slip.
export async function GET(req: Request, { params }: { params: Promise<{ receiptNo: string; docId: string }> }) {
  const { receiptNo, docId } = await params
  const { actor } = await getActor()
  const d = await withTenant(actor, (tx) => paperSlipFile(tx, actor, decodeURIComponent(receiptNo), docId)).catch(() => null)
  if (!d) return new Response('Not found', { status: 404 })
  const download = new URL(req.url).searchParams.has('download') || d.mime === 'application/pdf'
  return new Response(new Uint8Array(d.data), {
    headers: {
      'Content-Type': d.mime,
      'Content-Length': String(d.sizeBytes),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, no-store',
    },
  })
}
