import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { MAX_SIGNATURE_BYTES, setAuthorisedSignature, setCategorySignature } from '@/modules/catalog/categories'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Upload a signature image (multipart): target=category&id=<category>&file=..., or target=authorised&name=&title=[&file=].
// A route handler rather than a server action, like document uploads.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_SIGNATURE_BYTES + 64 * 1024) return Response.json({ ok: false, error: 'The signature image must be 5 MB or smaller' }, { status: 413 })
  try {
    const fd = await req.formData()
    const file = fd.get('file')
    const bytes = file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : null
    if (fd.get('target') === 'authorised') {
      await withTenant(actor, (tx) => setAuthorisedSignature(tx, actor, { bytes, name: String(fd.get('name') ?? ''), title: String(fd.get('title') ?? '') }))
    } else {
      if (!bytes) return Response.json({ ok: false, error: 'Choose the signature image' }, { status: 400 })
      await withTenant(actor, (tx) => setCategorySignature(tx, actor, String(fd.get('id') ?? ''), bytes))
    }
    revalidatePath('/', 'layout')
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'Upload failed') }, { status: 400 })
  }
}
