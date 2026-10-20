import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { MAX_DOC_BYTES } from '@/modules/documents/service'
import { myUpload } from '@/modules/portal/service'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Student portal: the student uploads their own photo or Aadhaar card (multipart: kind, file).
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })

  const { actor } = await getActor()
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_DOC_BYTES + 64 * 1024) return Response.json({ ok: false, error: 'Files must be 5 MB or smaller' }, { status: 413 })
  try {
    const fd = await req.formData()
    const file = fd.get('file')
    if (!(file instanceof File)) return Response.json({ ok: false, error: 'Choose a file' }, { status: 400 })
    const doc = await withTenant(actor, async (tx) => myUpload(tx, actor, String(fd.get('kind') ?? ''), { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }))
    revalidatePath('/', 'layout')
    return Response.json({ ok: true, id: doc.id })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'Upload failed') }, { status: 400 })
  }
}
