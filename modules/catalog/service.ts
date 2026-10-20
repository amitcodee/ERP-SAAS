// Read side of the catalogs (P3): every dropdown in the UI comes from here.
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { cached } from '@/lib/cache'
import { courses, departments, leadCategories, lookups } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { canRequestCategory } from '@/modules/catalog/categories'

export type Catalogs = {
  departments: { id: string; name: string }[]
  courses: { id: string; title: string; departmentId: string; baseFee: number; durationWeeks: number | null }[] // baseFee = the course's actual fee, paise
  sources: { id: string; value: string }[]
  classModes: { id: string; value: string }[]
  occupationTypes: { id: string; value: string }[]
  notJoinedReasons: { id: string; value: string }[]
  paymentModes: { id: string; value: string }[]
  /** Lead categories in use (head office keeps the list on the Lead Categories page). */
  leadCategories: { id: string; value: string }[]
  /** Every branch (names only), for "which branch is the lead interested in". */
  branches: { id: string; code: string; name: string }[]
}

export async function loadCatalogs(tx: Tx): Promise<Catalogs> {
  const all = await tx.select().from(lookups).where(eq(lookups.isActive, true)).orderBy(asc(lookups.sortOrder))
  const of = (kind: string) => all.filter((l) => l.kind === kind).map((l) => ({ id: l.id, value: l.value }))
  return {
    departments: (await tx.select().from(departments).where(and(eq(departments.isActive, true), eq(departments.status, 'approved'))).orderBy(asc(departments.sortOrder))).map((d) => ({ id: d.id, name: d.name })),
    courses: (await tx.select().from(courses).where(and(eq(courses.isActive, true), eq(courses.status, 'approved'))).orderBy(asc(courses.title))).map((c) => ({ id: c.id, title: c.title, departmentId: c.departmentId, baseFee: c.baseFee, durationWeeks: c.durationWeeks })),
    sources: of('enquiry_source'),
    classModes: of('class_mode'),
    occupationTypes: of('occupation_type'),
    notJoinedReasons: of('not_joined_reason'),
    paymentModes: of('payment_mode'),
    leadCategories: (await tx.select().from(leadCategories).where(eq(leadCategories.isActive, true)).orderBy(asc(leadCategories.sortOrder), asc(leadCategories.name))).map((c) => ({ id: c.id, value: c.name })),
    branches: (await tx.execute<{ id: string; code: string; name: string }>(sql`select id, code, name from branch_options()`)).rows.map((b) => ({ id: b.id, code: b.code, name: b.name })),
  }
}

/** loadCatalogs for pages. The same for every login (these lists are readable by all, branch_options() lists every
 *  branch), so it is kept in the shared cache, which any write empties. Code that has just written uses loadCatalogs. */
export const cachedCatalogs = (tx: Tx, orgId: string) => cached(orgId, 'catalogs', () => loadCatalogs(tx))

export const createCourseInput = z.object({
  departmentId: z.string().uuid(),
  title: z.string().trim().min(2).max(120),
  baseFee: z.number().int().nonnegative(), // paise
  durationWeeks: z.number().int().positive().optional().nullable(),
  skills: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(600).nullable()).optional(), // tools / skills taught: {{skills}} in internship letters
})
export type CreateCourseInput = z.input<typeof createCourseInput>

const isSuper = (a: Actor) => a.role === 'super_admin'
/** Head office adds courses; a branch admin may add one too, which waits for head office to approve it. */
export const canAddCourse = (a: Actor) => can(a, 'create', 'catalog') || canRequestCategory(a)

export async function createCourse(tx: Tx, actor: Actor, raw: CreateCourseInput) {
  if (!canAddCourse(actor)) throw new Error('Forbidden: create catalog')
  const input = createCourseInput.parse(raw)
  const [dup] = await tx.select({ status: courses.status }).from(courses).where(and(eq(courses.departmentId, input.departmentId), sql`lower(${courses.title}) = lower(${input.title})`))
  if (dup) throw new Error(dup.status === 'pending' ? 'This course is already waiting for head office to approve it' : 'This course already exists in this category')
  const head = isSuper(actor)
  const [c] = await tx.insert(courses).values({
    ...input,
    ...(head ? { status: 'approved', decidedBy: actor.userId, decidedAt: new Date() } : { status: 'pending', requestedBy: actor.userId, requestedBranchId: actor.branchId, requestedAt: new Date() }),
  }).returning()
  await audit(tx, actor, { action: head ? 'create' : 'request', entity: 'course', entityId: c.id, after: input })
  return { ...c, pending: !head }
}

/** Head office approves (or turns down, with a reason) a course a branch added. Only approved courses can be picked. */
export async function decideCourse(tx: Tx, actor: Actor, id: string, approve: boolean, reason?: string) {
  if (!isSuper(actor)) throw new Error('Only head office approves courses')
  const [cur] = await tx.select().from(courses).where(eq(courses.id, id)).for('update')
  if (!cur) throw new Error('Course not found')
  if (cur.status !== 'pending') throw new Error(`This course is already ${cur.status}`)
  if (!approve && !reason?.trim()) throw new Error('Give the reason for turning it down')
  await tx.update(courses).set({ status: approve ? 'approved' : 'rejected', decidedBy: actor.userId, decidedAt: new Date(), rejectionReason: approve ? null : reason!.trim() }).where(eq(courses.id, id))
  await audit(tx, actor, { action: approve ? 'approve' : 'reject', entity: 'course', entityId: id, after: { reason: reason ?? null } })
}

export type CourseListRow = {
  id: string; title: string; baseFee: number; durationWeeks: number | null; skills: string | null; department: string
  status: 'approved' | 'pending' | 'rejected'; requestedBranch: string | null; rejectionReason: string | null
  topics: number; syllabusFile: boolean
}

/** Approved courses, plus those waiting for approval: all of them for head office, a branch's own for the branch. */
export async function listCourses(tx: Tx, actor: Actor): Promise<CourseListRow[]> {
  const rows = (await tx.execute<{ id: string; title: string; base_fee: number; duration_weeks: number | null; skills: string | null; department: string; status: string; branch: string | null; rejection_reason: string | null; topics: number; has_file: boolean }>(sql`
    select c.id, c.title, c.base_fee, c.duration_weeks, c.skills, d.name as department, c.status, b.name as branch, c.rejection_reason,
      (select count(*)::int from course_topics t where t.course_id = c.id) as topics, exists (select 1 from course_syllabus_files f where f.course_id = c.id) as has_file
    from courses c join departments d on d.id = c.department_id left join branches b on b.id = c.requested_branch_id
    where c.is_active and (c.status = 'approved' or ${isSuper(actor)} or c.requested_branch_id = ${actor.branchId}::uuid)
    order by (c.status = 'pending') desc, d.name, c.title`)).rows
  return rows.map((r) => ({
    id: r.id, title: r.title, baseFee: Number(r.base_fee), durationWeeks: r.duration_weeks, skills: r.skills, department: r.department,
    status: r.status as CourseListRow['status'], requestedBranch: r.branch, rejectionReason: r.rejection_reason, topics: r.topics, syllabusFile: r.has_file,
  }))
}

/** The tools / skills a course teaches (used for {{skills}} in internship letters). */
export async function updateCourseSkills(tx: Tx, actor: Actor, id: string, skills: string) {
  assertCan(actor, 'update', 'catalog')
  const v = skills.trim().slice(0, 600) || null
  const [c] = await tx.update(courses).set({ skills: v }).where(eq(courses.id, id)).returning({ id: courses.id })
  if (!c) throw new Error('Course not found')
  await audit(tx, actor, { action: 'update', entity: 'course', entityId: id, after: { skills: v } })
}

export type LeadCategoryRow = { id: string; name: string; isActive: boolean }

/** Every lead category, including the ones switched off (for the Settings screen). */
export async function listLeadCategories(tx: Tx): Promise<LeadCategoryRow[]> {
  return tx.select({ id: leadCategories.id, name: leadCategories.name, isActive: leadCategories.isActive }).from(leadCategories).orderBy(asc(leadCategories.sortOrder), asc(leadCategories.name))
}

/** Add a lead category. A name that was switched off earlier is switched back on instead of being added twice. */
export async function addLeadCategory(tx: Tx, actor: Actor, rawName: string) {
  assertCan(actor, 'update', 'catalog')
  const name = z.string().trim().min(2, 'Type the category name').max(60).parse(rawName)
  const [dup] = await tx.select().from(leadCategories).where(sql`lower(${leadCategories.name}) = lower(${name})`)
  if (dup?.isActive) throw new Error('This category already exists')
  if (dup) {
    await tx.update(leadCategories).set({ isActive: true }).where(eq(leadCategories.id, dup.id))
    return dup.id
  }
  const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${leadCategories.sortOrder}), 0)::int` }).from(leadCategories)
  const [c] = await tx.insert(leadCategories).values({ name, sortOrder: n + 1 }).returning()
  await audit(tx, actor, { action: 'create', entity: 'lead_category', entityId: c.id, after: { name } })
  return c.id
}

/** Rename a category, or switch it off/on. Switched off = no longer offered; records that already carry it keep it. */
export async function updateLeadCategory(tx: Tx, actor: Actor, raw: { id: string; name?: string; isActive?: boolean }) {
  assertCan(actor, 'update', 'catalog')
  const input = z.object({ id: z.string().uuid(), name: z.string().trim().min(2).max(60).optional(), isActive: z.boolean().optional() }).parse(raw)
  const [before] = await tx.select().from(leadCategories).where(eq(leadCategories.id, input.id))
  if (!before) throw new Error('Category not found')
  if (input.name) {
    const [dup] = await tx.select().from(leadCategories).where(sql`lower(${leadCategories.name}) = lower(${input.name}) and ${leadCategories.id} <> ${input.id}`)
    if (dup) throw new Error('Another category already has this name')
  }
  const after = { name: input.name ?? before.name, isActive: input.isActive ?? before.isActive }
  await tx.update(leadCategories).set(after).where(eq(leadCategories.id, input.id))
  await audit(tx, actor, { action: 'update', entity: 'lead_category', entityId: input.id, before: { name: before.name, isActive: before.isActive }, after })
}

export type LeadCategoryCount = LeadCategoryRow & { calls: number; leads: number; visited: number; total: number }

/**
 * Every category with how many records carry it (what the person may see: their branch, or all for head office).
 * A call that became an enquiry is counted once, as that enquiry.
 */
export async function leadCategoryCounts(tx: Tx): Promise<LeadCategoryCount[]> {
  const res = await tx.execute<{ id: string; name: string; is_active: boolean; calls: number; leads: number; visited: number }>(sql`
    select c.id, c.name, c.is_active,
      (select count(*)::int from calls k where k.category_id = c.id and k.enquiry_id is null) as calls,
      (select count(*)::int from enquiries e where e.category_id = c.id and not e.visited) as leads,
      (select count(*)::int from enquiries e where e.category_id = c.id and e.visited) as visited
    from lead_categories c order by c.sort_order, c.name`)
  return res.rows.map((r) => ({ id: r.id, name: r.name, isActive: r.is_active, calls: r.calls, leads: r.leads, visited: r.visited, total: r.calls + r.leads + r.visited }))
}

export type LeadCategoryMember = {
  kind: 'call' | 'lead' | 'visited'; id: string; ref: string | null; name: string | null; phone: string | null; course: string | null
  status: string | null; interested: boolean | null; interestPct: number | null; nextFollowUp: string | null; at: string; branch: string | null
}

/** One category and everyone in it (random calls, leads, visited enquiries), newest first. Null when the category does not exist. */
export async function leadCategoryMembers(tx: Tx, rawId: string): Promise<{ category: LeadCategoryRow; members: LeadCategoryMember[] } | null> {
  const id = z.string().uuid().safeParse(rawId)
  if (!id.success) return null
  const [category] = await tx.select({ id: leadCategories.id, name: leadCategories.name, isActive: leadCategories.isActive }).from(leadCategories).where(eq(leadCategories.id, id.data))
  if (!category) return null
  const res = await tx.execute<{ kind: LeadCategoryMember['kind']; id: string; ref: string | null; name: string | null; phone: string | null; course: string | null; status: string | null; interested: boolean | null; interest_pct: number | null; next_follow_up: string | null; at: Date | string; branch: string | null }>(sql`
    select 'call' as kind, k.id, null as ref, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(co.title, d.name) as course,
      k.status as status, k.interested, k.interest_pct, k.follow_up_date::text as next_follow_up, k.called_at as at, b.code as branch
    from calls k left join persons p on p.id = k.person_id left join courses co on co.id = k.course_id left join departments d on d.id = k.department_id left join branches b on b.id = k.branch_id
    where k.category_id = ${id.data} and k.enquiry_id is null
    union all
    select case when e.visited then 'visited' else 'lead' end, e.id, e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')), p.phone, coalesce(co.title, d.name),
      e.status::text, e.interested, e.interest_pct, e.next_follow_up::text, e.created_at, b.code
    from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id left join departments d on d.id = e.department_id left join branches b on b.id = e.branch_id
    where e.category_id = ${id.data}
    order by at desc limit 1000`)
  return {
    category,
    members: res.rows.map((r) => ({ kind: r.kind, id: r.id, ref: r.ref, name: r.name, phone: r.phone, course: r.course, status: r.status, interested: r.interested, interestPct: r.interest_pct, nextFollowUp: r.next_follow_up, at: new Date(r.at).toISOString(), branch: r.branch })),
  }
}
