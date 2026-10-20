import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { syllabusFile } from '@/modules/teaching/service'

export const dynamic = 'force-dynamic'

// A course's syllabus file (PDF or picture). Any signed-in staff member or student may read a course outline.
export async function GET(_req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const { actor } = await getActor()
  const f = await withTenant(actor, (tx) => syllabusFile(tx, courseId)).catch(() => null)
  if (!f) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mime, 'Content-Disposition': `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
  })
}
