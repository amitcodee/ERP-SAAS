// What a franchise may charge for a course, in all (the total fee the student owes, after discounts, with GST): head
// office sets the lowest and the highest per course (Franchises → Course fees at franchises). Checked when a franchise
// registers a student, changes a total fee or gives a discount. The institute's own centres are not bound by it; a
// customised course (its own title, no course from the list) has no range.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** Why a total fee is not allowed at this branch for this course, or null. */
export async function franchiseFeeProblem(tx: Tx, branchId: string, courseId: string | null, total: number): Promise<string | null> {
  if (!courseId) return null
  const [r] = (await tx.execute<{ kind: string; title: string; min: number | null; max: number | null }>(sql`
    select b.kind, c.title, c.franchise_min_fee as min, c.franchise_max_fee as max from branches b, courses c where b.id = ${branchId} and c.id = ${courseId}`)).rows
  if (!r || r.kind !== 'franchise') return null
  if (r.min != null && total < r.min) return `A franchise charges at least ${rupees(r.min)} in all for ${r.title}${r.max != null ? ` (up to ${rupees(r.max)})` : ''}. Ask head office to change the range.`
  if (r.max != null && total > r.max) return `A franchise charges at most ${rupees(r.max)} in all for ${r.title}${r.min != null ? ` (from ${rupees(r.min)})` : ''}. Ask head office to change the range.`
  return null
}

export async function assertFranchiseFee(tx: Tx, branchId: string, courseId: string | null, total: number) {
  const why = await franchiseFeeProblem(tx, branchId, courseId, total)
  if (why) throw new Error(why)
}

export type FranchiseFeeRow = { courseId: string; title: string; department: string; baseFee: number; min: number | null; max: number | null }

/** Every active course with its usual fee and its franchise range (head office). */
export async function listFranchiseFees(tx: Tx, actor: Actor): Promise<FranchiseFeeRow[]> {
  assertCan(actor, 'read', 'franchise')
  return (await tx.execute<FranchiseFeeRow>(sql`
    select c.id as "courseId", c.title, d.name as department, c.base_fee as "baseFee", c.franchise_min_fee as min, c.franchise_max_fee as max
    from courses c join departments d on d.id = c.department_id
    where c.is_active and c.status = 'approved' and c.deleted_at is null order by d.name, c.title`)).rows
}

const paise = z.number().int().min(0).max(100_000_000_00).nullable()
export async function setFranchiseFee(tx: Tx, actor: Actor, raw: { courseId: string; min: number | null; max: number | null }) {
  assertCan(actor, 'update', 'franchise')
  const v = z.object({ courseId: z.string().uuid(), min: paise, max: paise }).parse(raw)
  if (v.min != null && v.max != null && v.min > v.max) throw new Error('The lowest fee cannot be above the highest')
  const r = await tx.execute(sql`update courses set franchise_min_fee = ${v.min}, franchise_max_fee = ${v.max} where id = ${v.courseId}`)
  if (!r.rowCount) throw new Error('Course not found')
  await audit(tx, actor, { action: 'update', entity: 'franchise_fee', entityId: v.courseId, after: { min: v.min, max: v.max } })
}
