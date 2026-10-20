// Course categories (the departments every course belongs to): name, remark, the category head (the instructor whose
// signature goes on certificates) and their signature. Head office adds approved categories; a branch admin asks for
// one, which waits until head office approves it (only approved categories appear in the course lists).
// Also the authorised signatory's signature and which signatures the certificates show (head office, in Settings).
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { departments, settings, signatureImages } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { sniffMime } from '@/modules/documents/service'

export const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024 // a phone photo of the signature; the browser shrinks big ones first (lib/signature-file.ts)
const isSuper = (a: Actor) => a.role === 'super_admin'
/** A branch admin may ask for a category; head office adds them directly. */
export const canRequestCategory = (a: Actor) => isSuper(a) || (!a.ownOnly && can(a, 'create', 'catalog'))

export type CategoryRow = {
  id: string; name: string; remark: string | null; headName: string | null; hasSignature: boolean; isActive: boolean
  status: 'approved' | 'pending' | 'rejected'; requestedBranch: string | null; requestedAt: string | null; rejectionReason: string | null; courses: number
}

export async function listCategories(tx: Tx, actor: Actor): Promise<CategoryRow[]> {
  assertCan(actor, 'read', 'catalog')
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select d.id, d.name, d.remark, d.head_name, d.head_signature is not null as has_sig, d.is_active, d.status, b.name as branch, d.requested_at, d.rejection_reason,
      (select count(*)::int from courses c where c.department_id = d.id and c.is_active) as courses
    from departments d left join branches b on b.id = d.requested_branch_id
    where d.status = 'approved' or ${isSuper(actor)} or d.requested_branch_id = ${actor.branchId}::uuid
    order by (d.status = 'pending') desc, d.sort_order, d.name`)).rows
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), remark: (r.remark as string) ?? null, headName: (r.head_name as string) ?? null, hasSignature: !!r.has_sig, isActive: !!r.is_active,
    status: r.status as CategoryRow['status'], requestedBranch: (r.branch as string) ?? null, requestedAt: r.requested_at ? new Date(r.requested_at as string).toISOString() : null,
    rejectionReason: (r.rejection_reason as string) ?? null, courses: Number(r.courses ?? 0),
  }))
}

const categoryInput = z.object({
  name: z.preprocess((v) => String(v ?? '').trim(), z.string().min(2, 'Name is required').max(80)),
  remark: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(500).nullable()),
  headName: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(120).nullable()),
})
export type CategoryInput = z.input<typeof categoryInput>

export async function createCategory(tx: Tx, actor: Actor, raw: CategoryInput) {
  if (!canRequestCategory(actor)) throw new Error('Only a branch admin or head office can add a category')
  const v = categoryInput.parse(raw)
  const [dup] = await tx.select({ id: departments.id }).from(departments).where(sql`lower(${departments.name}) = lower(${v.name})`)
  if (dup) throw new Error('A category with this name already exists')
  const [max] = (await tx.execute<{ n: number }>(sql`select coalesce(max(sort_order), 0)::int + 1 as n from departments`)).rows
  const head = isSuper(actor)
  const [row] = await tx.insert(departments).values({
    name: v.name, remark: v.remark, headName: v.headName, sortOrder: Number(max?.n ?? 1),
    ...(head ? { status: 'approved', decidedBy: actor.userId, decidedAt: new Date() } : { status: 'pending', isActive: true, requestedBy: actor.userId, requestedBranchId: actor.branchId, requestedAt: new Date() }),
  }).returning()
  await audit(tx, actor, { action: head ? 'create' : 'request', entity: 'course_category', entityId: row.id, after: { name: v.name } })
  return { id: row.id, pending: !head }
}

export async function updateCategory(tx: Tx, actor: Actor, id: string, raw: CategoryInput & { isActive?: boolean }) {
  const v = categoryInput.parse(raw)
  const [cur] = await tx.select().from(departments).where(eq(departments.id, id)).for('update')
  if (!cur) throw new Error('Category not found')
  if (!isSuper(actor) && !(cur.status === 'pending' && cur.requestedBranchId === actor.branchId)) throw new Error('Only head office can change an approved category')
  await tx.update(departments).set({ name: v.name, remark: v.remark, headName: v.headName, ...(isSuper(actor) && raw.isActive !== undefined ? { isActive: raw.isActive } : {}) }).where(eq(departments.id, id))
  await audit(tx, actor, { action: 'update', entity: 'course_category', entityId: id })
}

export async function decideCategory(tx: Tx, actor: Actor, id: string, approve: boolean, reason?: string) {
  if (!isSuper(actor)) throw new Error('Only head office approves categories')
  const [cur] = await tx.select().from(departments).where(eq(departments.id, id)).for('update')
  if (!cur) throw new Error('Category not found')
  if (cur.status !== 'pending') throw new Error(`This category is already ${cur.status}`)
  if (!approve && !reason?.trim()) throw new Error('Give the reason for turning it down')
  await tx.update(departments).set({ status: approve ? 'approved' : 'rejected', decidedBy: actor.userId, decidedAt: new Date(), rejectionReason: approve ? null : reason!.trim() }).where(eq(departments.id, id))
  await audit(tx, actor, { action: approve ? 'approve' : 'reject', entity: 'course_category', entityId: id, after: { reason: reason ?? null } })
}

/** A signature image: PNG or JPEG, up to 5 MB. */
function checkSignature(bytes: Buffer) {
  if (!bytes.length) throw new Error('The file is empty')
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error('The signature image must be 5 MB or smaller')
  const mime = sniffMime(bytes)
  if (mime !== 'image/png' && mime !== 'image/jpeg') throw new Error('Upload the signature as a PNG or JPG image (a PNG with a transparent background looks best)')
  return mime
}

export async function setCategorySignature(tx: Tx, actor: Actor, id: string, bytes: Buffer) {
  // the head's signature prints on certificates: only those who may add a category set it (not any login of the branch)
  if (!canRequestCategory(actor)) throw new Error('Only a branch admin or head office can set the signature')
  const mime = checkSignature(bytes)
  const [cur] = await tx.select().from(departments).where(eq(departments.id, id)).for('update')
  if (!cur) throw new Error('Category not found')
  if (!isSuper(actor) && !(cur.status === 'pending' && cur.requestedBranchId === actor.branchId)) throw new Error('Only head office can change an approved category')
  await tx.update(departments).set({ headSignature: bytes, headSignatureMime: mime }).where(eq(departments.id, id))
  await audit(tx, actor, { action: 'signature', entity: 'course_category', entityId: id })
}

export async function setAuthorisedSignature(tx: Tx, actor: Actor, input: { bytes?: Buffer | null; name?: string | null; title?: string | null }) {
  assertCan(actor, 'update', 'setting')
  const [cur] = await tx.select().from(signatureImages).where(eq(signatureImages.key, 'authorised'))
  const name = input.name?.trim() || null, title = input.title?.trim() || null
  if (input.bytes && input.bytes.length) {
    const mime = checkSignature(input.bytes)
    await tx.insert(signatureImages).values({ key: 'authorised', signerName: name, signerTitle: title, mime, data: input.bytes, updatedBy: actor.userId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [signatureImages.orgId, signatureImages.key], set: { signerName: name, signerTitle: title, mime, data: input.bytes, updatedBy: actor.userId, updatedAt: new Date() } })
  } else if (cur) {
    await tx.update(signatureImages).set({ signerName: name, signerTitle: title, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(signatureImages.key, 'authorised'))
  } else throw new Error('Upload the signature image')
  await audit(tx, actor, { action: 'update', entity: 'signature', entityId: 'authorised' })
}

/** Which signatures the course completion certificate shows. The project certificate always shows the category head's. */
export type SignatureChoice = 'both' | 'authorised' | 'instructor'
export const SIGNATURE_KEY = 'certificate.signatures'

export async function getSignatureChoice(tx: Tx): Promise<SignatureChoice> {
  const [r] = await tx.select().from(settings).where(and(isNull(settings.branchId), eq(settings.key, SIGNATURE_KEY)))
  const v = r?.value as unknown
  return v === 'authorised' || v === 'instructor' ? v : 'both'
}

export async function setSignatureChoice(tx: Tx, actor: Actor, choice: string) {
  assertCan(actor, 'update', 'setting')
  if (!['both', 'authorised', 'instructor'].includes(choice)) throw new Error('Unknown choice')
  const [cur] = await tx.select().from(settings).where(and(isNull(settings.branchId), eq(settings.key, SIGNATURE_KEY)))
  if (cur) await tx.update(settings).set({ value: choice }).where(eq(settings.id, cur.id))
  else await tx.insert(settings).values({ key: SIGNATURE_KEY, value: choice })
  await audit(tx, actor, { action: 'update', entity: 'setting', entityId: SIGNATURE_KEY, before: cur?.value ?? null, after: choice })
}

export async function authorisedSignatureInfo(tx: Tx) {
  const [r] = await tx.select({ name: signatureImages.signerName, title: signatureImages.signerTitle, updatedAt: signatureImages.updatedAt }).from(signatureImages).where(eq(signatureImages.key, 'authorised'))
  return r ? { name: r.name, title: r.title, updatedAt: r.updatedAt.toISOString() } : null
}

/** Signature images as data: URLs, for the certificate page and preview (small images; public certificates need them inline). */
export async function signatureImage(tx: Tx, which: { authorised: true } | { departmentId: string }): Promise<string | null> {
  if ('authorised' in which) {
    const [r] = await tx.select({ mime: signatureImages.mime, data: signatureImages.data }).from(signatureImages).where(eq(signatureImages.key, 'authorised'))
    return r ? `data:${r.mime};base64,${Buffer.from(r.data).toString('base64')}` : null
  }
  const [d] = await tx.select({ mime: departments.headSignatureMime, data: departments.headSignature }).from(departments).where(eq(departments.id, which.departmentId))
  return d?.data && d.mime ? `data:${d.mime};base64,${Buffer.from(d.data).toString('base64')}` : null
}

