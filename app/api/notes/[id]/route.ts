import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { noteFile } from '@/modules/teaching/service'

export const dynamic = 'force-dynamic'

// A note's file. The database decides who sees it: its batch's students, its author, the branch, and every trainer
// when shared with trainers; anyone else gets "not found".
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor } = await getActor()
  const f = await withTenant(actor, (tx) => noteFile(tx, id)).catch(() => null)
  if (!f) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mime, 'Content-Disposition': `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
  })
}
