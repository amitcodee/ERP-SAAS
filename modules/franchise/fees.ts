// What a franchise may charge for a course, in all (the total fee the student owes, after discounts, with GST): head
// office sets the lowest and the highest per course (Franchises → Course fees at franchises). Checked when a franchise
// registers a student, changes a total fee or gives a discount. The institute's own centres are not bound by it. A
// customised course (its own title, no course from the list) is bound by its department's range.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

/** What the fee is for: a course from the list, else (a customised course) its department. */
export type FeeFor = { courseId: string | null; departmentId: string | null }

/** Why a total fee is not allowed at this branch for this course (or customised course in this department), or null. */
export async function franchiseFeeProblem(tx: Tx, branchId: string, what: FeeFor, total: number): Promise<string | null> {
  if (!what.courseId && !what.departmentId) return null
  const [r] = (await tx.execute<{ kind: string; title: string; min: number | null; max: number | null }>(what.courseId
    ? sql`select b.kind, c.title, c.franchise_min_fee as min, c.franchise_max_fee as max from branches b, courses c where b.id = ${branchId} and c.id = ${what.courseId}`
    : sql`select b.kind, 'a customised course in ' || d.name as title, d.franchise_min_fee as min, d.franchise_max_fee as max from branches b, departments d where b.id = ${branchId} and d.id = ${what.departmentId}`)).rows
  if (!r || r.kind !== 'franchise') return null
  if (r.min != null && total < r.min) return `A franchise charges at least ${rupees(r.min)} in all for ${r.title}${r.max != null ? ` (up to ${rupees(r.max)})` : ''}. Ask head office to change the range.`
  if (r.max != null && total > r.max) return `A franchise charges at most ${rupees(r.max)} in all for ${r.title}${r.min != null ? ` (from ${rupees(r.min)})` : ''}. Ask head office to change the range.`
  return null
}

export async function assertFranchiseFee(tx: Tx, branchId: string, what: FeeFor, total: number) {
  const why = await franchiseFeeProblem(tx, branchId, what, total)
  if (why) throw new Error(why)
}

/** A course's range, or (courseId null) the range of customised courses in a department. */
export type FranchiseFeeRow = { courseId: string | null; departmentId: string; title: string; department: string; baseFee: number | null; min: number | null; max: number | null }

/** Every active course with its usual fee and its franchise range, and each department's range for customised courses (head office). */
export async function listFranchiseFees(tx: Tx, actor: Actor): Promise<FranchiseFeeRow[]> {
  assertCan(actor, 'read', 'franchise')
  return (await tx.execute<FranchiseFeeRow>(sql`
    select "courseId", "departmentId", title, department, "baseFee", min, max from (
      select c.id as "courseId", d.id as "departmentId", c.title, d.name as department, c.base_fee as "baseFee", c.franchise_min_fee as min, c.franchise_max_fee as max, 0 as o
      from courses c join departments d on d.id = c.department_id
      where c.is_active and c.status = 'approved' and c.deleted_at is null
      union all
      select null, d.id, 'Customised course', d.name, null, d.franchise_min_fee, d.franchise_max_fee, 1
      from departments d where d.is_active and d.status = 'approved'
    ) x order by department, o, title`)).rows
}

const paise = z.number().int().min(0).max(100_000_000_00).nullable()
export async function setFranchiseFee(tx: Tx, actor: Actor, raw: { courseId?: string | null; departmentId?: string | null; min: number | null; max: number | null }) {
  assertCan(actor, 'update', 'franchise')
  const v = z.object({ courseId: z.string().uuid().nullish(), departmentId: z.string().uuid().nullish(), min: paise, max: paise }).parse(raw)
  if (v.min != null && v.max != null && v.min > v.max) throw new Error('The lowest fee cannot be above the highest')
  const r = v.courseId
    ? await tx.execute(sql`update courses set franchise_min_fee = ${v.min}, franchise_max_fee = ${v.max} where id = ${v.courseId}`)
    : v.departmentId ? await tx.execute(sql`update departments set franchise_min_fee = ${v.min}, franchise_max_fee = ${v.max} where id = ${v.departmentId}`) : null
  if (!r?.rowCount) throw new Error(v.courseId ? 'Course not found' : 'Department not found')
  await audit(tx, actor, { action: 'update', entity: 'franchise_fee', entityId: (v.courseId ?? v.departmentId)!, after: { customised: !v.courseId, min: v.min, max: v.max } })
}
