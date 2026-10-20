import { revalidatePath } from 'next/cache'
import { getActor } from '@/lib/auth/current'
import { branchEmailBlock } from '@/lib/config/store'
import { withTenant } from '@/lib/db/withTenant'
import { MAX_DOC_BYTES } from '@/modules/documents/service'
import { MAX_PROOFS, MAX_SLIPS } from '@/modules/fees/plan'
import { recordPaymentWithProof } from '@/modules/fees/service'
import { loginAfterFirstPayment } from '@/modules/users/student-login'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Records a payment together with its proof (multipart: the payment's fields and up to three "proof" files), in one
// step: either the payment, its receipt and the proof are all saved, or nothing is.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: 'Bad origin' }, { status: 403 })

  const { actor } = await getActor()
  const blocked = await branchEmailBlock(actor) // the branch's own mail server comes first
  if (blocked) return Response.json({ ok: false, error: blocked }, { status: 409 })
  if (Number(req.headers.get('content-length') ?? Infinity) > (MAX_PROOFS + MAX_SLIPS) * MAX_DOC_BYTES + 256 * 1024) return Response.json({ ok: false, error: 'The proof files are too large (5 MB each at most)' }, { status: 413 })
  try {
    const fd = await req.formData()
    const text = (k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null }
    const num = (k: string) => { const v = text(k); return v && /^\d+$/.test(v) ? Number(v) : null }
    const read = (k: string) => Promise.all(fd.getAll(k).filter((f): f is File => f instanceof File && f.size > 0).map(async (f) => ({ fileName: f.name, bytes: Buffer.from(await f.arrayBuffer()) })))
    const [proofs, slips] = [await read('proof'), await read('slip')] // the proof of the payment, and the paper slip given at the desk
    const r = await withTenant(actor, (tx) => recordPaymentWithProof(tx, actor, {
      registrationId: text('registrationId') ?? '', amount: num('amount') ?? 0, modeId: text('modeId') ?? '', txnRef: text('txnRef'), paidOn: text('paidOn'), remark: text('remark'), paperSlip: text('paperSlip') === '1',
      nextInstallmentDate: text('nextDate'), nextInstallmentAmount: num('nextAmount'),
    }, proofs, slips))
    revalidatePath('/', 'layout')
    // the first (token) fee gives the student a portal login, e-mailed to them
    const login = await loginAfterFirstPayment(actor, text('registrationId') ?? '')
    return Response.json({ ok: true, receiptNo: r.receipt.receiptNo, balanceAfter: r.balanceAfter, login })
  } catch (e) {
    return Response.json({ ok: false, error: userMessage(e, 'Could not save the payment') }, { status: 400 })
  }
}
