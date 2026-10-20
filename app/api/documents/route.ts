import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { branchEmailBlock } from '@/lib/config/store'
import { withTenant } from '@/lib/db/withTenant'
import { MAX_DOC_BYTES, uploadDocument } from '@/modules/documents/service'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Upload one document to a registration (multipart: registrationId, kind, file).
// A route handler rather than a server action, so files up to 5 MB fit without raising the action body limit.
export async function POST(req: Request) {
  // Same-origin only: the session cookie is SameSite=Lax already; this also refuses cross-site form posts outright.
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })

  const { actor } = await getActor()
  const blocked = await branchEmailBlock(actor) // the branch's own mail server comes first
  if (blocked) return Response.json({ ok: false, error: blocked }, { status: 409 })
  const len = Number(req.headers.get('content-length') ?? Infinity)
  if (len > MAX_DOC_BYTES + 64 * 1024) return Response.json({ ok: false, error: 'Files must be 5 MB or smaller' }, { status: 413 })
  try {
    const fd = await req.formData()
    const file = fd.get('file')
    if (!(file instanceof File)) return Response.json({ ok: false, error: 'Choose a file' }, { status: 400 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const doc = await withTenant(actor, (tx) =>
      uploadDocument(tx, actor, { registrationId: String(fd.get('registrationId') ?? ''), kind: String(fd.get('kind') ?? ''), fileName: file.name, bytes }),
    )
    revalidatePath('/', 'layout')
    return Response.json({ ok: true, id: doc.id })
  } catch (e) {
    const zod = (e as { issues?: { message: string }[] }).issues
    return Response.json({ ok: false, error: zod ? 'Invalid upload details' : userMessage(e, 'Upload failed') }, { status: 400 })
  }
}
