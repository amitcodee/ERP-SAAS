import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { branchEmailBlock } from '@/lib/config/store'
import { withTenant } from '@/lib/db/withTenant'
import { createNote, setSyllabusFile, uploadAnswerSheet } from '@/modules/teaching/service'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Teaching uploads (multipart), as a route so files up to 10 MB fit: `what` = syllabus (courseId + file),
// note (batchId, title, body, url, shareStudents, shareTrainers + optional file) or sheet (testId, registrationId + file).
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  const blocked = await branchEmailBlock(actor)
  if (blocked) return Response.json({ ok: false, error: blocked }, { status: 409 })
  if (Number(req.headers.get('content-length') ?? Infinity) > 11 * 1024 * 1024) return Response.json({ ok: false, error: 'Files must be 10 MB or smaller' }, { status: 413 })
  try {
    const fd = await req.formData()
    const text = (k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null }
    const f = fd.get('file')
    const file = f instanceof File && f.size > 0 ? { fileName: f.name, bytes: Buffer.from(await f.arrayBuffer()) } : null
    const what = text('what')
    let data: unknown = null
    if (what === 'syllabus') {
      if (!file) throw new Error('Choose the syllabus file')
      await withTenant(actor, (tx) => setSyllabusFile(tx, actor, text('courseId') ?? '', file))
    } else if (what === 'note') {
      data = await withTenant(actor, (tx) => createNote(tx, actor, {
        batchId: text('batchId'), title: text('title') ?? '', body: text('body'), url: text('url'),
        shareStudents: text('shareStudents') === '1', shareTrainers: text('shareTrainers') === '1',
      }, file))
    } else if (what === 'sheet') {
      if (!file) throw new Error('Choose the photo of the answer sheet')
      data = await withTenant(actor, (tx) => uploadAnswerSheet(tx, actor, text('testId') ?? '', text('registrationId') ?? '', file))
    } else throw new Error('Unknown upload')
    revalidatePath('/', 'layout')
    return Response.json({ ok: true, data })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'Upload failed') }, { status: 400 })
  }
}
