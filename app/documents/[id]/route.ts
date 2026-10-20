import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { getDocument } from '@/modules/documents/service'

export const dynamic = 'force-dynamic'

// Login required (proxy.ts); RLS decides visibility, so another branch's file is simply "not found".
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor } = await getActor()
  const d = await withTenant(actor, (tx) => getDocument(tx, actor, id)).catch(() => null)
  if (!d) return new Response('Not found', { status: 404 })
  // Images open in the tab; PDFs always download (a sandboxed tab cannot show Chrome's PDF viewer reliably).
  const download = new URL(req.url).searchParams.has('download') || d.mime === 'application/pdf'
  return new Response(new Uint8Array(d.data), {
    headers: {
      'Content-Type': d.mime,
      'Content-Length': String(d.sizeBytes),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
