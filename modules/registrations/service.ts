// The ONLY place registrations are written. Callers pass an open tenant transaction (withTenant).
import { emitRegistration } from '@/modules/integrations/webhooks'
import { confirmRegistration } from '@/modules/notifications/whatsapp-events'
import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { audit } from '@/lib/audit'
import type { ListQuery } from '@/lib/list-query'
import { cleanQuery, inRange, orderFrom, escapeLike } from '@/lib/list-query-sql'
import { assertCan, can } from '@/lib/auth/permissions'
import { branches, courses, departments, enquiries, lookups, personOccupations, persons, registrationEvents, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { nextRegNo, peekRegNo } from '@/lib/numbering'
import { transitionEnquiry } from '../enquiries/service'
import { postCharge, writeFeePlan } from '../fees/service'
import { MIN_FIRST_PAYMENT, type FeePlan } from '../fees/plan'
import { upsertPerson } from '../people/upsert'
import { REG_TRANSITIONS } from './status'
import { aadhaarColumns, openAadhaar } from '../people/aadhaar-store'
import {
  createRegistrationInput, regDatesInput, regTransitionInput,
  type CreateRegistrationInput, type RegDatesInput, type RegTransitionInput,
} from './validators'

export { REG_TRANSITIONS } from './status'

const needBranch = (actor: Actor) => {
  if (!actor.branchId) throw new Error('Choose a branch first (super admin must act inside a branch)')
  return actor.branchId
}

/** `quiet`: imports of old data, which must not message anyone. */
export async function createRegistration(tx: Tx, actor: Actor, raw: CreateRegistrationInput, opts: { quiet?: boolean } = {}) {
  assertCan(actor, 'create', 'registration')
  const input = createRegistrationInput.parse(raw)
  const branchId = needBranch(actor)
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new Error('Branch not found')

  let personId: string
  let departmentId = input.departmentId ?? null
  let courseId = input.courseId ?? null
  let classModeId = input.classModeId ?? null
  let totalFee = input.totalFee ?? null
  let enquiryId: string | null = null

  if (input.enquiryId) {
    // Convert an enquiry: everything already captured is reused, nothing is retyped (P2).
    const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, input.enquiryId)).for('update')
    if (!enq) throw new Error('Enquiry not found')
    if (enq.status === 'dead') throw new Error('This enquiry is marked dead - revive it before registering')
    const [already] = await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.enquiryId, enq.id))
    if (already) throw new Error('This enquiry already has a registration')
    enquiryId = enq.id
    personId = enq.personId
    departmentId ??= enq.departmentId
    courseId ??= enq.courseId
    classModeId ??= enq.classModeId
    totalFee ??= enq.actualFee ?? enq.proposedFee
  } else {
    personId = (await upsertPerson(tx, branchId, input.person!)).person.id
  }

  const custom = input.customCourse ?? null
  if (custom) courseId = null // a customized course replaces the one from the list (also the enquiry's)
  if (!departmentId) throw new Error('Department is required')
  if (!totalFee || totalFee <= 0) throw new Error('Total fee is required')
  // the offer fee (below the full fee) is up to whoever admits the student: no fixed discount limit

  if (input.kind === 'upgrade') {
    if (!input.previousRegistrationId) throw new Error('An upgrade must point to the previous registration')
    const [prev] = await tx.select().from(registrations).where(eq(registrations.id, input.previousRegistrationId))
    if (!prev || prev.personId !== personId) throw new Error('Previous registration must belong to the same student')
  }

  // Personal details belong to the person - update them there, once (P2).
  const prof = input.profile
  if (prof) {
    const patch = Object.fromEntries(
      Object.entries({ fatherName: prof.fatherName, motherName: prof.motherName, gender: prof.gender, dob: prof.dob, altPhone: prof.altPhone, guardianPhone: prof.guardianPhone, email: prof.email, address: prof.address, ...(prof.aadhaarNo ? aadhaarColumns(actor.orgId, prof.aadhaarNo) : {}) })
        .filter(([, v]) => v != null && v !== ''),
    )
    if (Object.keys(patch).length) await tx.update(persons).set(patch).where(eq(persons.id, personId))
  }
  if (input.occupation) await tx.insert(personOccupations).values({ personId, branchId, ...input.occupation })

  const regNo = await nextRegNo(tx, branchId, branch.code)
  const [reg] = await tx
    .insert(registrations)
    .values({
      regNo, branchId, personId, enquiryId, kind: input.kind, previousRegistrationId: input.previousRegistrationId ?? null,
      departmentId, courseId, classModeId,
      customCourseTitle: custom?.title ?? null,
      customCourse: custom ? { durationWeeks: custom.durationWeeks ?? null, feeMode: custom.feeMode, modules: custom.modules.map((m) => ({ name: m.name, fee: m.fee ?? null })) } : null,
      enrollmentDate: input.enrollmentDate, joiningDate: input.joiningDate ?? null,
      classMinutesPerDay: input.classMinutesPerDay ?? null, classDaysPerWeek: input.classDaysPerWeek ?? null, classStartTime: input.classStartTime ?? null,
      courseHours: input.courseHours ?? null, expectedEndDate: input.expectedEndDate ?? null, totalFee, listFee: input.listFee ?? null, courseFee: input.courseFee ?? null, gstAmount: input.gstAmount ?? null, projectCertificate: input.projectCertificate ?? false,
      internshipOffer: input.internshipOffer ?? false, internshipCompletion: input.internshipCompletion ?? false,
      offerTemplateId: input.internshipOffer ? input.offerTemplateId ?? null : null, completionTemplateId: input.internshipCompletion ? input.completionTemplateId ?? null : null,
      letterCompanyId: input.internshipOffer || input.internshipCompletion ? input.letterCompanyId ?? null : null,
      createdBy: actor.userId,
    })
    .returning()
  await postCharge(tx, actor, { id: reg.id, branchId, totalFee })
  if (input.feePlan) await writeFeePlan(tx, { id: reg.id, branchId }, totalFee, input.feePlan)
  await tx.insert(registrationEvents).values({ registrationId: reg.id, branchId, byUser: actor.userId, fromStatus: null, toStatus: 'active', note: enquiryId ? 'Converted from enquiry' : 'Direct registration' })

  if (enquiryId) {
    await tx.update(enquiries).set({ actualFee: totalFee }).where(eq(enquiries.id, enquiryId))
    const [enq] = await tx.select({ status: enquiries.status }).from(enquiries).where(eq(enquiries.id, enquiryId))
    if (enq.status !== 'joined') await transitionEnquiry(tx, actor, { enquiryId, to: 'joined', note: `Registered as ${regNo}` })
  }
  await audit(tx, actor, { action: 'create', entity: 'registration', entityId: reg.id, after: { regNo, personId, totalFee, projectCertificate: input.projectCertificate ?? false } })
  await emitRegistration(tx, reg.id)
  if (!opts.quiet) await confirmRegistration(tx, reg.id)
  return reg
}

/** The registration number the next registration of the actor's branch will get (shown on the form; it is minted on save). */
export async function upcomingRegNo(tx: Tx, actor: Actor): Promise<string | null> {
  assertCan(actor, 'create', 'registration')
  if (!actor.branchId) return null
  const [branch] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, actor.branchId))
  return branch ? peekRegNo(tx, actor.branchId, branch.code) : null
}

export async function transitionRegistration(tx: Tx, actor: Actor, raw: RegTransitionInput) {
  assertCan(actor, 'update', 'registration')
  const input = regTransitionInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for('update')
  if (!reg) throw new Error('Registration not found')
  if (!REG_TRANSITIONS[reg.status].includes(input.to)) throw new Error(`Illegal status change: ${reg.status} -> ${input.to}`)
  if ((input.to === 'discontinued' || input.to === 'on_hold') && !input.note?.trim()) throw new Error('A reason is required')
  if (reg.status === 'discontinued') assertCan(actor, 'approve', 'registration') // reactivation

  await tx.insert(registrationEvents).values({ registrationId: reg.id, branchId: reg.branchId, byUser: actor.userId, fromStatus: reg.status, toStatus: input.to, note: input.note })
  const [updated] = await tx.update(registrations).set({ status: input.to, updatedAt: new Date() }).where(eq(registrations.id, reg.id)).returning()
  await audit(tx, actor, { action: 'transition', entity: 'registration', entityId: reg.id, before: { status: reg.status }, after: { status: input.to } })
  return updated
}

/**
 * Filters (query.f): status, kind (new|upgrade), dept, course, mode. Date range = enrolment date.
 * Sort: created, enrolled, reg, name, fee, status.
 */
export async function listRegistrations(
  tx: Tx,
  actor: Actor,
  opts: { q?: string; status?: (typeof registrations.$inferSelect)['status']; limit?: number; offset?: number; query?: ListQuery } = {},
) {
  assertCan(actor, 'read', 'registration')
  const mode = alias(lookups, 'mode')
  const c = cleanQuery({ ...opts.query, q: opts.query?.q ?? opts.q })
  const status = opts.status ?? c.one(['active', 'on_hold', 'discontinued', 'completed', 'transferred'] as const, 'status')
  const kind = c.one(['new', 'upgrade'] as const, 'kind')
  const name = sql<string>`trim(${persons.firstName} || ' ' || coalesce(${persons.lastName}, ''))`
  const where = and(
    // the branch's own students only: a student shared INTO this branch for some classes is not one of its registrations
    sql`(app_branch() is null or ${registrations.branchId} = app_branch())`,
    status ? eq(registrations.status, status) : undefined,
    kind ? eq(registrations.kind, kind) : undefined,
    c.id('dept') ? eq(registrations.departmentId, c.id('dept')!) : undefined,
    c.id('course') ? eq(registrations.courseId, c.id('course')!) : undefined,
    c.id('mode') ? eq(registrations.classModeId, c.id('mode')!) : undefined,
    inRange(registrations.enrollmentDate, c.from, c.to),
    c.like ? or(ilike(persons.firstName, c.like), ilike(persons.lastName, c.like), ilike(persons.phone, c.like), sql`${name} ilike ${c.like}`, ilike(registrations.regNo, c.like), ilike(registrations.legacyRegNo, c.like)) : undefined,
  )
  const rows = await tx
    .select({
      id: registrations.id, branchId: registrations.branchId, enquiryId: registrations.enquiryId, regNo: registrations.regNo, status: registrations.status, kind: registrations.kind,
      enrollmentDate: registrations.enrollmentDate, totalFee: registrations.totalFee,
      joiningDate: sql<string | null>`${registrations.joiningDate}::text`, expectedEndDate: sql<string | null>`${registrations.expectedEndDate}::text`,
      // Paid so far (anything that brought the balance down other than a discount). Below the minimum the student is not active yet.
      settled: sql<number>`coalesce((select b.charged - b.discounted - b.balance from v_fee_balance b where b.registration_id = ${registrations.id}), 0)::int`,
      feeRequest: sql<boolean>`exists (select 1 from fee_change_requests q where q.registration_id = ${registrations.id} and q.status = 'pending')`,
      name,
      phone: persons.phone, department: departments.name, course: sql<string | null>`coalesce(${courses.title}, ${registrations.customCourseTitle})`, mode: mode.value,
    })
    .from(registrations)
    .innerJoin(persons, eq(persons.id, registrations.personId))
    .innerJoin(departments, eq(departments.id, registrations.departmentId))
    .leftJoin(courses, eq(courses.id, registrations.courseId))
    .leftJoin(mode, eq(mode.id, registrations.classModeId))
    .where(where)
    .orderBy(orderFrom(
      { created: registrations.createdAt, enrolled: registrations.enrollmentDate, reg: registrations.regNo, name: sql`lower(${name})`, fee: registrations.totalFee, status: registrations.status },
      c.sort, c.dir, 'created', registrations.id,
    ))
    .limit(opts.limit ?? 25)
    .offset(opts.offset ?? 0)
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(registrations).innerJoin(persons, eq(persons.id, registrations.personId)).where(where)
  return { rows, total: n }
}

export async function registrationHistory(tx: Tx, actor: Actor, registrationId: string) {
  assertCan(actor, 'read', 'registration')
  return tx.select().from(registrationEvents).where(eq(registrationEvents.registrationId, registrationId)).orderBy(registrationEvents.at)
}

/** Active registrations matching a search, for pickers (e.g. "add a student to a batch"). Max 20. */
export async function searchActiveRegistrations(tx: Tx, actor: Actor, q: string) {
  assertCan(actor, 'read', 'registration')
  const like = `%${escapeLike(q.trim())}%`
  const res = await tx.execute<{ id: string; reg_no: string; name: string }>(sql`
    select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name
    from registrations r join persons p on p.id = r.person_id
    where r.status = 'active' and (app_branch() is null or r.branch_id = app_branch()) and (${q.trim() === ''} or p.first_name ilike ${like} or p.last_name ilike ${like} or p.phone ilike ${like} or r.reg_no ilike ${like} or r.legacy_reg_no ilike ${like})
    order by r.created_at desc limit 20`)
  return res.rows.map((r) => ({ id: r.id, label: `${r.reg_no} · ${r.name}` }))
}

export type EnquiryForRegistration = {
  id: string; enquiryNo: string; status: string; visited: boolean; visitedAt: string | null; createdAt: string
  firstName: string; lastName: string | null; phone: string; altPhone: string | null; email: string | null; dob: string | null; gender: string | null; address: string | null
  fatherName: string | null; motherName: string | null; guardianPhone: string | null
  aadhaarNo: string | null; occupationTypeId: string | null; qualification: string | null; schoolOrCollege: string | null
  departmentId: string | null; department: string | null; courseId: string | null; course: string | null; classModeId: string | null; classMode: string | null
  courseFee: number | null; proposedFee: number | null; source: string | null; category: string | null; assignedTo: string | null; callRemark: string | null
}

/** Everything known about a lead or enquiry that can still be registered: shown on the registration page and used to fill it. */
export async function enquiryForRegistration(tx: Tx, actor: Actor, rawId: string): Promise<EnquiryForRegistration | null> {
  assertCan(actor, 'create', 'registration')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) return null
  const res = await tx.execute<Record<string, never>>(sql`
    select e.id, e.enquiry_no, e.status::text as status, e.visited, e.visited_at, e.created_at, e.department_id, e.course_id, e.class_mode_id, e.course_fee, e.proposed_fee, e.call_remark,
      p.first_name, p.last_name, p.phone, p.alt_phone, p.email, p.dob::text as dob, p.gender, p.address, p.father_name, p.mother_name, p.guardian_phone, p.aadhaar_no,
      occ.type_id as occupation_type_id, occ.qualification, occ.school_or_college,
      d.name as department, c.title as course, md.value as class_mode, src.value as source, lc.name as category, u.name as assigned_to,
      exists (select 1 from registrations r where r.enquiry_id = e.id) as registered
    from enquiries e join persons p on p.id = e.person_id left join departments d on d.id = e.department_id left join courses c on c.id = e.course_id
      left join lookups md on md.id = e.class_mode_id left join lookups src on src.id = e.source_id left join lead_categories lc on lc.id = e.category_id left join users u on u.id = e.assigned_to
      left join lateral (select o.type_id, o.qualification, o.school_or_college from person_occupations o where o.person_id = p.id order by o.valid_from desc limit 1) occ on true
    where e.id = ${rawId}`)
  const r = res.rows[0] as Record<string, never> | undefined
  if (!r || r.registered || r.status === 'dead') return null
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return {
    id: r.id, enquiryNo: r.enquiry_no, status: r.status, visited: r.visited, visitedAt: iso(r.visited_at), createdAt: iso(r.created_at)!,
    firstName: r.first_name, lastName: r.last_name, phone: r.phone, altPhone: r.alt_phone, email: r.email, dob: r.dob, gender: r.gender, address: r.address,
    fatherName: r.father_name, motherName: r.mother_name, guardianPhone: r.guardian_phone,
    aadhaarNo: openAadhaar(actor.orgId, r.aadhaar_no), occupationTypeId: r.occupation_type_id, qualification: r.qualification, schoolOrCollege: r.school_or_college,
    departmentId: r.department_id, department: r.department, courseId: r.course_id, course: r.course, classModeId: r.class_mode_id, classMode: r.class_mode,
    courseFee: r.course_fee, proposedFee: r.proposed_fee, source: r.source, category: r.category, assignedTo: r.assigned_to, callRemark: r.call_remark,
  }
}

// ---- Where a registration can start from: a random call, a lead, a visited enquiry, or (an upgrade) an older registration ----

/** The student's details that fill the registration form, whatever they were fetched from. */
export type StudentPrefill = Pick<EnquiryForRegistration,
  'firstName' | 'lastName' | 'phone' | 'altPhone' | 'email' | 'dob' | 'gender' | 'address' | 'fatherName' | 'motherName' | 'guardianPhone' | 'aadhaarNo' |
  'occupationTypeId' | 'qualification' | 'schoolOrCollege' | 'departmentId' | 'courseId' | 'classModeId' | 'courseFee' | 'proposedFee'>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PERSON_COLS = sql`p.first_name, p.last_name, p.phone, p.alt_phone, p.email, p.dob::text as dob, p.gender, p.address, p.father_name, p.mother_name, p.guardian_phone, p.aadhaar_no,
  occ.type_id as occupation_type_id, occ.qualification, occ.school_or_college`
const LATEST_OCC = sql`left join lateral (select o.type_id, o.qualification, o.school_or_college from person_occupations o where o.person_id = p.id order by o.valid_from desc limit 1) occ on true`
const personOf = (orgId: string, r: Record<string, never>) => ({
  firstName: r.first_name, lastName: r.last_name, phone: r.phone, altPhone: r.alt_phone, email: r.email, dob: r.dob, gender: r.gender, address: r.address,
  fatherName: r.father_name, motherName: r.mother_name, guardianPhone: r.guardian_phone, aadhaarNo: openAadhaar(orgId, r.aadhaar_no),
  occupationTypeId: r.occupation_type_id, qualification: r.qualification, schoolOrCollege: r.school_or_college,
}) as Pick<StudentPrefill, 'firstName' | 'lastName' | 'phone' | 'altPhone' | 'email' | 'dob' | 'gender' | 'address' | 'fatherName' | 'motherName' | 'guardianPhone' | 'aadhaarNo' | 'occupationTypeId' | 'qualification' | 'schoolOrCollege'>

export type SourceFilter = 'all' | 'call' | 'lead' | 'visited'
/** kind: a random call (not yet an enquiry), a lead (enquiry, not visited), a visited enquiry, or a registration (for upgrades). */
export type SourceHit = { id: string; kind: 'call' | 'lead' | 'visited' | 'registration'; ref: string; name: string; phone: string; fee: number | null }

/** Students a new registration can start from, by name, phone or enquiry no. Max 20, newest first. */
export async function searchRegistrationSources(tx: Tx, actor: Actor, q: string, filter: SourceFilter = 'all'): Promise<SourceHit[]> {
  assertCan(actor, 'create', 'registration')
  const term = q.trim()
  if (!term) return []
  const like = `%${escapeLike(term)}%`
  const name = sql`trim(p.first_name || ' ' || coalesce(p.last_name, ''))`
  const hits: (SourceHit & { at: string })[] = []
  if (filter !== 'call' && can(actor, 'read', 'enquiry')) {
    const res = await tx.execute<Record<string, never>>(sql`
      select e.id, e.enquiry_no, e.visited, ${name} as name, p.phone, coalesce(e.actual_fee, e.proposed_fee, e.course_fee) as fee, e.created_at
      from enquiries e join persons p on p.id = e.person_id
      where e.status <> 'dead' and not exists (select 1 from registrations r where r.enquiry_id = e.id)
        and (${filter === 'all'} or e.visited = ${filter === 'visited'})
        and (p.first_name ilike ${like} or p.last_name ilike ${like} or ${name} ilike ${like} or p.phone ilike ${like} or e.enquiry_no ilike ${like})
      order by e.created_at desc limit 20`)
    for (const r of res.rows) hits.push({ id: r.id, kind: r.visited ? 'visited' : 'lead', ref: r.enquiry_no, name: r.name, phone: r.phone, fee: r.fee, at: new Date(r.created_at).toISOString() })
  }
  if ((filter === 'all' || filter === 'call') && can(actor, 'read', 'call')) {
    // Random calls that have not been made into an enquiry yet.
    const res = await tx.execute<Record<string, never>>(sql`
      select k.id, ${name} as name, p.phone, k.proposed_fee as fee, k.called_at
      from calls k join persons p on p.id = k.person_id
      where k.enquiry_id is null and k.deleted_at is null
        and (p.first_name ilike ${like} or p.last_name ilike ${like} or ${name} ilike ${like} or p.phone ilike ${like})
      order by k.called_at desc limit 20`)
    for (const r of res.rows) hits.push({ id: r.id, kind: 'call', ref: 'Random call', name: r.name, phone: r.phone, fee: r.fee, at: new Date(r.called_at).toISOString() })
  }
  return hits.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20).map(({ at: _at, ...h }) => h)
}

export type CallForRegistration = StudentPrefill & { id: string; calledAt: string; department: string | null; course: string | null; status: string | null; callRemark: string | null; receivedBy: string | null }

/** A random call's student and what they asked about, to start a (direct) registration from. */
export async function callForRegistration(tx: Tx, actor: Actor, rawId: string): Promise<CallForRegistration | null> {
  assertCan(actor, 'create', 'registration')
  assertCan(actor, 'read', 'call')
  if (!UUID.test(rawId)) return null
  const res = await tx.execute<Record<string, never>>(sql`
    select k.id, k.called_at, k.department_id, k.course_id, k.proposed_fee, k.status, k.call_remark, ${PERSON_COLS},
      d.name as department, c.title as course, c.base_fee, u.name as received_by
    from calls k join persons p on p.id = k.person_id left join departments d on d.id = k.department_id left join courses c on c.id = k.course_id
      left join users u on u.id = k.received_by ${LATEST_OCC}
    where k.id = ${rawId} and k.enquiry_id is null and k.deleted_at is null`)
  const r = res.rows[0]
  if (!r) return null
  return {
    ...personOf(actor.orgId, r), id: r.id, calledAt: new Date(r.called_at).toISOString(), departmentId: r.department_id, courseId: r.course_id, classModeId: null,
    courseFee: r.base_fee || null, proposedFee: r.proposed_fee, department: r.department, course: r.course, status: r.status, callRemark: r.call_remark, receivedBy: r.received_by,
  }
}

/** Registrations of any status, for "upgrading from". Max 20. */
export async function searchRegistrationsToUpgrade(tx: Tx, actor: Actor, q: string): Promise<SourceHit[]> {
  assertCan(actor, 'create', 'registration')
  const term = q.trim()
  if (!term) return []
  const like = `%${escapeLike(term)}%`
  const res = await tx.execute<Record<string, never>>(sql`
    select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, r.total_fee
    from registrations r join persons p on p.id = r.person_id
    where p.first_name ilike ${like} or p.last_name ilike ${like} or trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike ${like}
      or p.phone ilike ${like} or r.reg_no ilike ${like} or r.legacy_reg_no ilike ${like}
    order by r.created_at desc limit 20`)
  return res.rows.map((r) => ({ id: r.id, kind: 'registration' as const, ref: r.reg_no, name: r.name, phone: r.phone, fee: r.total_fee }))
}

export type RegistrationForUpgrade = StudentPrefill & {
  id: string; regNo: string; status: string; kind: string; department: string | null; course: string | null; classMode: string | null
  enrollmentDate: string; joiningDate: string | null; expectedEndDate: string | null; totalFee: number; paid: number; balance: number
}

/** The older registration an upgrade continues from: the student (same person) and everything about that registration. */
export async function registrationForUpgrade(tx: Tx, actor: Actor, rawId: string): Promise<RegistrationForUpgrade | null> {
  assertCan(actor, 'create', 'registration')
  if (!UUID.test(rawId)) return null
  const res = await tx.execute<Record<string, never>>(sql`
    select r.id, r.reg_no, r.status::text as status, r.kind::text as kind, r.department_id, r.class_mode_id, r.enrollment_date::text as enrollment_date,
      r.joining_date::text as joining_date, r.expected_end_date::text as expected_end_date, r.total_fee, ${PERSON_COLS},
      d.name as department, coalesce(c.title, r.custom_course_title) as course, md.value as class_mode,
      coalesce(b.paid, 0)::int as paid, coalesce(b.balance, 0)::int as balance
    from registrations r join persons p on p.id = r.person_id left join departments d on d.id = r.department_id left join courses c on c.id = r.course_id
      left join lookups md on md.id = r.class_mode_id left join v_fee_balance b on b.registration_id = r.id ${LATEST_OCC}
    where r.id = ${rawId}`)
  const r = res.rows[0]
  if (!r) return null
  return {
    ...personOf(actor.orgId, r), id: r.id, regNo: r.reg_no, status: r.status, kind: r.kind, departmentId: r.department_id, courseId: null, classModeId: r.class_mode_id,
    courseFee: null, proposedFee: null, department: r.department, course: r.course, classMode: r.class_mode,
    enrollmentDate: r.enrollment_date, joiningDate: r.joining_date, expectedEndDate: r.expected_end_date, totalFee: r.total_fee, paid: r.paid, balance: r.balance,
  }
}

/** Corrects the dates of a registration afterwards (back-dating), with the reason kept in the history and the audit log. */
export async function updateRegistrationDates(tx: Tx, actor: Actor, raw: RegDatesInput) {
  assertCan(actor, 'update', 'registration')
  const input = regDatesInput.parse(raw)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for('update')
  if (!reg) throw new Error('Registration not found')
  const before = { enrollmentDate: String(reg.enrollmentDate), joiningDate: reg.joiningDate ? String(reg.joiningDate) : null, expectedEndDate: reg.expectedEndDate ? String(reg.expectedEndDate) : null }
  const after = { enrollmentDate: input.enrollmentDate, joiningDate: input.joiningDate ?? null, expectedEndDate: input.expectedEndDate ?? null }
  if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('No date was changed')
  await tx.update(registrations).set({ ...after, updatedAt: new Date() }).where(eq(registrations.id, reg.id))
  await tx.insert(registrationEvents).values({ registrationId: reg.id, branchId: reg.branchId, byUser: actor.userId, fromStatus: reg.status, toStatus: reg.status, note: `Dates changed: ${input.note}` })
  await audit(tx, actor, { action: 'update', entity: 'registration_dates', entityId: reg.id, before, after: { ...after, note: input.note } })
  return after
}

export type RegistrationDetails = {
  id: string; regNo: string; status: string; kind: string; active: boolean; personId: string
  branch: string; branchCity: string | null
  name: string; firstName: string; lastName: string | null; phone: string; altPhone: string | null; guardianPhone: string | null; email: string | null
  fatherName: string | null; motherName: string | null; dob: string | null; gender: string | null; address: string | null; aadhaarNo: string | null
  occupation: string | null; qualification: string | null; schoolOrCollege: string | null
  department: string | null; course: string | null; customModules: string[]; classMode: string | null
  enrollmentDate: string; joiningDate: string | null; expectedEndDate: string | null
  classMinutesPerDay: number | null; classDaysPerWeek: number | null; classStartTime: string | null; courseHours: number | null
  listFee: number | null; courseFee: number | null; gstAmount: number | null; totalFee: number; paid: number; balance: number
  feePlan: FeePlan | null; installments: { dueDate: string; amount: number; status: string }[]
  enquiryNo: string | null; upgradedFrom: string | null; photoId: string | null; createdBy: string | null; createdAt: string
  // certificates and internship letters
  projectCertificate: boolean
  letters: RegistrationLettersView
}

/** Everything about one registration and its student: the details view of the registrations table and the ID card. */
export async function registrationDetails(tx: Tx, actor: Actor, rawId: string): Promise<RegistrationDetails | null> {
  assertCan(actor, 'read', 'registration')
  if (!UUID.test(rawId)) return null
  const res = await tx.execute<Record<string, never>>(sql`
    select r.id, r.reg_no, r.status::text as status, r.kind::text as kind, r.enrollment_date::text as enrollment_date, r.joining_date::text as joining_date,
      r.expected_end_date::text as expected_end_date, r.class_minutes_per_day, r.class_days_per_week, r.class_start_time, r.course_hours,
      r.list_fee, r.course_fee, r.gst_amount, r.total_fee, r.fee_plan, r.custom_course, r.project_certificate, r.created_at, ${PERSON_COLS},
      br.name as branch, br.city as branch_city, d.name as department, coalesce(c.title, r.custom_course_title) as course, md.value as class_mode, ot.value as occupation,
      coalesce(b.paid, 0)::int as paid, coalesce(b.balance, 0)::int as balance, r.person_id,
      e.enquiry_no, pr.reg_no as upgraded_from, u.name as created_by,
      (select dc.id from registration_documents dc where dc.registration_id = r.id and dc.kind = 'photo' order by dc.uploaded_at desc limit 1) as photo_id
    from registrations r join persons p on p.id = r.person_id join branches br on br.id = r.branch_id
      left join departments d on d.id = r.department_id left join courses c on c.id = r.course_id left join lookups md on md.id = r.class_mode_id
      left join v_fee_balance b on b.registration_id = r.id left join enquiries e on e.id = r.enquiry_id
      left join registrations pr on pr.id = r.previous_registration_id left join users u on u.id = r.created_by
      ${LATEST_OCC} left join lookups ot on ot.id = occ.type_id
    where r.id = ${rawId}`)
  const r = res.rows[0]
  if (!r) return null
  const inst = await tx.execute<{ due_date: string; amount: number; status: string }>(sql`
    select due_date::text as due_date, amount, status::text as status from installments where registration_id = ${rawId} and status <> 'cancelled' order by due_date, created_at`)
  const custom = r.custom_course as { modules?: { name: string }[] } | null
  return {
    ...personOf(actor.orgId, r), id: r.id, personId: r.person_id, regNo: r.reg_no, status: r.status, kind: r.kind, active: (r.paid as number) >= MIN_FIRST_PAYMENT,
    branch: r.branch, branchCity: r.branch_city, name: [r.first_name, r.last_name].filter(Boolean).join(' '),
    occupation: r.occupation, department: r.department, course: r.course, customModules: custom?.modules?.map((m) => m.name) ?? [], classMode: r.class_mode,
    enrollmentDate: r.enrollment_date, joiningDate: r.joining_date, expectedEndDate: r.expected_end_date,
    classMinutesPerDay: r.class_minutes_per_day, classDaysPerWeek: r.class_days_per_week, classStartTime: r.class_start_time, courseHours: r.course_hours,
    listFee: r.list_fee, courseFee: r.course_fee, gstAmount: r.gst_amount, totalFee: r.total_fee, paid: r.paid, balance: r.balance,
    feePlan: r.fee_plan, installments: inst.rows.map((i) => ({ dueDate: i.due_date, amount: i.amount, status: i.status })),
    enquiryNo: r.enquiry_no, upgradedFrom: r.upgraded_from, photoId: r.photo_id, createdBy: r.created_by, createdAt: new Date(r.created_at).toISOString(),
    projectCertificate: !!r.project_certificate, letters: await lettersView(tx, rawId),
  }
}

/** The registration's internship letters and certificate, for the View window. */
export type RegistrationLettersView = {
  offer: boolean; completion: boolean; offerTemplate: string; completionTemplate: string
  intern: { id: string; refNo: string; status: string; designation: string; offerIssuedAt: string | null; completedAt: string | null; wantsOffer: boolean } | null
  certificate: { certNo: string; hash: string; issuedAt: string; revoked: boolean } | null
}
async function lettersView(tx: Tx, id: string): Promise<RegistrationLettersView> {
  const [r] = (await tx.execute<Record<string, unknown>>(sql`
    select r.internship_offer, r.internship_completion, ot.name as offer_tpl, ct.name as completion_tpl
    from registrations r left join letter_templates ot on ot.id = r.offer_template_id left join letter_templates ct on ct.id = r.completion_template_id where r.id = ${id}`)).rows
  const [i] = (await tx.execute<Record<string, unknown>>(sql`
    select id, ref_no, status, designation, offer_issued_at, completed_at, wants_offer from internships where registration_id = ${id} and status <> 'cancelled' order by created_at desc limit 1`)).rows
  const [c] = (await tx.execute<Record<string, unknown>>(sql`select cert_no, verification_hash, issued_at, is_revoked from certificates where registration_id = ${id} order by is_revoked, issued_at desc limit 1`)).rows
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return {
    offer: !!r?.internship_offer, completion: !!r?.internship_completion, offerTemplate: (r?.offer_tpl as string) ?? 'Standard', completionTemplate: (r?.completion_tpl as string) ?? 'Standard',
    intern: i ? { id: String(i.id), refNo: String(i.ref_no), status: String(i.status), designation: String(i.designation), offerIssuedAt: iso(i.offer_issued_at), completedAt: iso(i.completed_at), wantsOffer: !!i.wants_offer } : null,
    certificate: c ? { certNo: String(c.cert_no), hash: String(c.verification_hash), issuedAt: iso(c.issued_at)!, revoked: !!c.is_revoked } : null,
  }
}

/** Options changeable after registering: the project certificate and the mode of classes (letters: see modules/letters). */
export async function updateRegistrationOptions(tx: Tx, actor: Actor, id: string, v: { projectCertificate: boolean; classModeId: string | null }) {
  assertCan(actor, 'update', 'registration')
  const [reg] = await tx.select({ id: registrations.id, projectCertificate: registrations.projectCertificate, classModeId: registrations.classModeId }).from(registrations).where(eq(registrations.id, id)).for('update')
  if (!reg) throw new Error('Registration not found')
  await tx.update(registrations).set({ projectCertificate: v.projectCertificate, classModeId: v.classModeId || null, updatedAt: new Date() }).where(eq(registrations.id, id))
  await audit(tx, actor, { action: 'update', entity: 'registration_options', entityId: id, before: reg, after: v })
}

export async function registrationOptions(tx: Tx, id: string) {
  const [r] = await tx.select({ projectCertificate: registrations.projectCertificate, classModeId: registrations.classModeId }).from(registrations).where(eq(registrations.id, id))
  return r ?? null
}
