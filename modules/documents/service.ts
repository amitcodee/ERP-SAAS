// Registration documents. Branch scope and student isolation are enforced by RLS; this layer adds roles,
// a size cap, and a content check (the file's own bytes decide its type, never the name or browser-sent type).
import { createHash } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { registrationDocuments, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'

import { DOC_KINDS, type DocKind, type DocumentRow } from './kinds'
import { assertWithinLimit } from '@/lib/plan/limits'

export { DOC_KINDS }
export const MAX_DOC_BYTES = 5 * 1024 * 1024

/** Detects the real file type from its first bytes. Only these four are accepted. */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const uploadInput = z.object({
  registrationId: z.string().uuid(),
  kind: z.enum(Object.keys(DOC_KINDS) as [DocKind, ...DocKind[]]),
  fileName: z.string().trim().min(1).max(200),
})

export async function uploadDocument(tx: Tx, actor: Actor, raw: { registrationId: string; kind: string; fileName: string; bytes: Buffer }) {
  assertCan(actor, 'update', 'registration')
  const input = uploadInput.parse(raw)
  const bytes = raw.bytes
  if (!bytes.length) throw new Error('The file is empty')
  if (bytes.length > MAX_DOC_BYTES) throw new Error('Files must be 5 MB or smaller')
  await assertWithinLimit(tx, 'storageMb', bytes.length / 1048576)
  const mime = sniffMime(bytes)
  if (!mime) throw new Error('Only PDF, JPG, PNG or WebP files can be uploaded')
  const [reg] = await tx.select({ id: registrations.id, branchId: registrations.branchId }).from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  const fileName = input.fileName.replace(/[\/\r\n"]/g, '_')
  const [doc] = await tx.insert(registrationDocuments).values({
    branchId: reg.branchId, registrationId: reg.id, kind: input.kind, fileName, mime, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes, uploadedBy: actor.userId,
  }).returning({ id: registrationDocuments.id })
  await audit(tx, actor, { action: 'create', entity: 'document', entityId: doc.id, after: { registrationId: reg.id, kind: input.kind, fileName, mime, sizeBytes: bytes.length } })
  return doc
}

/**
 * Keeps the proof of a payment with the registration's documents. Called by the fees module in the transaction that
 * records the payment (which has already checked who may take payments).
 */
export async function attachPaymentProof(tx: Tx, actor: Actor, reg: { id: string; branchId: string }, paymentId: string, file: { fileName: string; bytes: Buffer }, kind: 'payment_proof' | 'payment_slip' = 'payment_proof') {
  const bytes = file.bytes
  if (!bytes.length) throw new Error('A proof file is empty')
  if (bytes.length > MAX_DOC_BYTES) throw new Error('Proof files must be 5 MB or smaller')
  const mime = sniffMime(bytes)
  if (!mime) throw new Error('The proof must be a picture (JPG, PNG, WebP) or a PDF')
  const fileName = (file.fileName.trim() || 'proof').slice(0, 200).replace(/[\/\r\n"]/g, '_')
  const [doc] = await tx.insert(registrationDocuments).values({
    branchId: reg.branchId, registrationId: reg.id, kind, paymentId, fileName, mime, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes, uploadedBy: actor.userId,
  }).returning({ id: registrationDocuments.id })
  await audit(tx, actor, { action: 'create', entity: 'document', entityId: doc.id, after: { registrationId: reg.id, kind, paymentId, fileName, mime, sizeBytes: bytes.length } })
  return doc
}

export async function listDocuments(tx: Tx, actor: Actor, registrationId: string): Promise<DocumentRow[]> {
  assertCan(actor, 'read', 'registration')
  if (!z.string().uuid().safeParse(registrationId).success) return []
  // A proof of payment or paper slip comes with its payment: which one it was (1st, 2nd...), its receipt and amount.
  const res = await tx.execute<Record<string, never>>(sql`
    select d.id, d.kind, d.file_name, d.mime, d.size_bytes, d.uploaded_at, d.uploaded_by, rc.receipt_no, pay.amount,
      (select count(*)::int from payments o where o.registration_id = pay.registration_id and (o.paid_at, o.created_at) <= (pay.paid_at, pay.created_at)) as nth
    from registration_documents d left join payments pay on pay.id = d.payment_id left join receipts rc on rc.payment_id = pay.id
    where d.registration_id = ${registrationId} order by d.uploaded_at desc`)
  return res.rows.map((r) => ({
    id: r.id, kind: r.kind as DocKind, fileName: r.file_name, mime: r.mime, sizeBytes: r.size_bytes, uploadedAt: new Date(r.uploaded_at).toISOString(), uploadedBy: r.uploaded_by,
    payment: r.receipt_no ? { receiptNo: r.receipt_no, amount: r.amount, nth: r.nth } : null,
  }))
}

/** The file itself, for download. Not found = not visible to this actor (other branch / not theirs). */
export async function getDocument(tx: Tx, actor: Actor, id: string) {
  // A student reaches only the files of their own registrations (the database shows them no others).
  const student = actor.role === 'student'
  if (!student && !can(actor, 'read', 'registration') && !can(actor, 'read', 'fee')) throw new Error('Forbidden: read registration')
  if (!z.string().uuid().safeParse(id).success) return null
  const [d] = await tx.select().from(registrationDocuments).where(eq(registrationDocuments.id, id))
  if (d && student && (d.kind === 'payment_proof' || d.kind === 'payment_slip')) return null // the proof of payment is the office's record; the slip is shown through the receipt
  if (d && !student && !can(actor, 'read', 'registration') && d.kind !== 'payment_proof' && d.kind !== 'payment_slip' && d.kind !== 'photo') return null // accounts: payment proofs, paper slips and the photo only
  return d ?? null
}

export async function deleteDocument(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'update', 'registration')
  // The proof of a payment is part of the money record: only someone who approves fees may remove it.
  const [target] = await tx.select({ kind: registrationDocuments.kind }).from(registrationDocuments).where(eq(registrationDocuments.id, id))
  if ((target?.kind === 'payment_proof' || target?.kind === 'payment_slip') && !can(actor, 'approve', 'fee')) throw new Error('A payment proof or paper slip can only be removed by a manager')
  const [d] = await tx.delete(registrationDocuments).where(eq(registrationDocuments.id, id))
    .returning({ id: registrationDocuments.id, registrationId: registrationDocuments.registrationId, fileName: registrationDocuments.fileName, sha256: registrationDocuments.sha256 })
  if (!d) throw new Error('Document not found')
  await audit(tx, actor, { action: 'delete', entity: 'document', entityId: d.id, before: { registrationId: d.registrationId, fileName: d.fileName, sha256: d.sha256 } })
}
