import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { userMessage } from '@/lib/errors'
import { MAX_LETTER_IMAGE_BYTES, setCompanyImage } from '@/modules/letters/service'

export const dynamic = 'force-dynamic'

// A letter company's letterhead or stamp (multipart): id=<company>&which=letterhead|stamp&file=… (no file: remove it).
// A route handler rather than a server action, like the signature uploads.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_LETTER_IMAGE_BYTES + 64 * 1024) return Response.json({ ok: false, error: 'The image must be 5 MB or smaller' }, { status: 413 })
  try {
    const fd = await req.formData()
    const which = fd.get('which') === 'stamp' ? 'stamp' : 'letterhead'
    const file = fd.get('file')
    const bytes = file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : null
    await withTenant(actor, (tx) => setCompanyImage(tx, actor, String(fd.get('id') ?? ''), which, bytes))
    revalidatePath('/letter-templates')
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'Upload failed') }, { status: 400 })
  }
}
