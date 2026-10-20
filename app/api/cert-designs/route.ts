import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { withTenant } from '@/lib/db/withTenant'
import { userMessage } from '@/lib/errors'
import { MAX_DESIGN_BYTES, saveDesign } from '@/modules/events/service'

export const dynamic = 'force-dynamic'

// Saves a certificate design (JSON: { id, name, design }). A route handler rather than a server action: a design with
// pictures inside can be several MB, over what a server action takes.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })
  const { actor } = await getActor()
  if (Number(req.headers.get('content-length') ?? Infinity) > MAX_DESIGN_BYTES + 64 * 1024) return Response.json({ ok: false, error: 'The design is too big (over 8 MB): use smaller pictures' }, { status: 413 })
  try {
    const body = (await req.json()) as { id?: string | null; name: string; design: unknown }
    const id = await withTenant(actor, (tx) => saveDesign(tx, actor, body.id || null, { name: body.name, design: body.design as never }))
    revalidatePath('/certificate-designs')
    return Response.json({ ok: true, id })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'The design could not be saved') }, { status: 400 })
  }
}
