// The ONLY place enquiries are written. Callers pass an open tenant transaction (withTenant).
import { emitLead } from '@/modules/integrations/webhooks'
import { thankForEnquiry, thankForVisit } from '@/modules/notifications/whatsapp-events'
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { audit } from '@/lib/audit'
import type { ListQuery } from '@/lib/list-query'
import { cleanQuery, inRange, orderFrom, escapeLike } from '@/lib/list-query-sql'
import { assertCan, can } from '@/lib/auth/permissions'
import { auditLogs, branches, callFollowups, calls, courses, departments, enquiries, enquiryEvents, leadCategories, lookups, personOccupations, persons, users } from '@/lib/db/schema'
import type { EnquiryStatus } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { nextEnquiryNo } from '@/lib/numbering'
import type { z } from 'zod'
import { normalizePhone } from '../people/phone'
import { upsertPerson } from '../people/upsert'
import {
  createEnquiryInput, followUpCallInput, followUpLeadInput, leadInput, logCallInput, transitionInput, updateCallInput, updateLeadInput,
  type CreateEnquiryInput, type LogCallInput, type TransitionInput, type FollowUpCallInput, type FollowUpLeadInput, type UpdateCallInput, type UpdateLeadInput,
} from './validators'

export { TRANSITIONS } from './status'
import { TRANSITIONS } from './status'

const needBranch = (actor: Actor) => {
  if (!actor.branchId) throw new Error('Choose a branch first (super admin must act inside a branch)')
  return actor.branchId
}

/** Column values for the lead details. "Not interested" (or not asked) carries no percentage. */
const leadColumns = (l: z.infer<typeof leadInput>, visitedAt: Date | null = null) => ({
  visited: l.visited, visitedAt: l.visited ? visitedAt ?? new Date() : null, // the first time it is marked visited is kept
  interested: l.interested ?? null, interestPct: l.interested === true ? l.interestPct ?? null : null,
  callDone: l.callDone, callAt: l.callDone ? (l.callAt ? new Date(l.callAt) : new Date()) : null, callRemark: l.callRemark ?? null, location: l.location || null, interestedBranchId: l.interestedBranchId ?? null, categoryId: l.categoryId ?? null,
})

/** A website form, as a Lead of a branch. `byUser` = who sent it there (null: placed on arrival, by the website's address). */
export type WebEnquiry = { name: string; phone: string; email?: string | null; course?: string | null; location?: string | null; message?: string | null; sourceUrl?: string | null; siteHost: string
  /** When the form was sent on the website: the lead is dated by it, so Leads lists it in the same order as Web Leads. */
  submittedAt?: Date | null }

/**
 * A website lead in this branch: a new Lead (source Website, the page it came from), or, when this phone number already
 * has an open lead or enquiry in the branch, a note on that one, so the same person is never on the list twice.
 * (A finished one, joined / not joined / dead, is left as it is: the new form is a new lead.)
 * Called by modules/web-leads only (on arrival, or when head office sends it to a branch).
 */
export async function placeWebEnquiry(tx: Tx, branchId: string, w: WebEnquiry, byUser: string | null) {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new Error('Branch not found')
  // One at a time per phone number and branch: the same form arriving twice at once must not make two leads.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`weblead:${branchId}:${normalizePhone(w.phone)}`}))`)
  const [first, ...rest] = w.name.trim().split(/\s+/)
  const { person } = await upsertPerson(tx, branchId, { firstName: first.slice(0, 100), lastName: rest.join(' ').slice(0, 100) || null, phone: w.phone, email: w.email ?? null })
  const note = [`Website form: ${w.siteHost}`, w.course && `Course: ${w.course}`, w.message && `Message: ${w.message}`, w.sourceUrl && `Page: ${w.sourceUrl}`].filter(Boolean).join('\n')

  const [open] = await tx.select({ id: enquiries.id, status: enquiries.status }).from(enquiries)
    .where(and(eq(enquiries.branchId, branchId), eq(enquiries.personId, person.id), sql`${enquiries.status} not in ('joined', 'not_joined', 'dead')`)).orderBy(desc(enquiries.createdAt)).limit(1)
  if (open) {
    await tx.insert(enquiryEvents).values({ enquiryId: open.id, branchId, byUser, fromStatus: open.status, toStatus: open.status, note: `Sent a website form again.\n${note}` })
    return { enquiryId: open.id, existing: true }
  }

  const [source] = await tx.select({ id: lookups.id }).from(lookups).where(and(eq(lookups.kind, 'enquiry_source'), eq(lookups.value, 'Website')))
  // The course they picked on the website, when it is one of ours by name.
  const [course] = w.course ? await tx.select({ id: courses.id, departmentId: courses.departmentId }).from(courses).where(and(sql`lower(${courses.title}) = lower(${w.course.trim()})`, eq(courses.isActive, true), eq(courses.status, 'approved'))).limit(1) : []
  const enquiryNo = await nextEnquiryNo(tx, branchId, branch.code)
  const [enq] = await tx.insert(enquiries).values({
    enquiryNo, branchId, personId: person.id, sourceId: source?.id ?? null, sourceUrl: w.sourceUrl ?? null,
    courseId: course?.id ?? null, departmentId: course?.departmentId ?? null,
    location: w.location?.slice(0, 200) || null, visited: false, createdBy: byUser,
    ...(w.submittedAt ? { createdAt: new Date(w.submittedAt) } : {}),
  }).returning()
  await tx.insert(enquiryEvents).values({ enquiryId: enq.id, branchId, byUser, fromStatus: null, toStatus: 'new', note })
  await tx.insert(auditLogs).values({ userId: byUser, branchId, action: 'create', entity: 'enquiry', entityId: enq.id, after: { enquiryNo, personId: person.id, source: 'website', site: w.siteHost } as never })
  await emitLead(tx, enq.id, 'website')
  // a form that arrives now is thanked; one brought in from the past (submitted days ago) is not
  if (!w.submittedAt || Date.now() - new Date(w.submittedAt).getTime() < 48 * 3600_000) await thankForEnquiry(tx, branchId, person.id)
  return { enquiryId: enq.id, existing: false }
}

/** `quiet`: imports of old data, which must not message anyone. */
export async function createEnquiry(tx: Tx, actor: Actor, raw: CreateEnquiryInput, opts: { quiet?: boolean } = {}) {
  assertCan(actor, 'create', 'enquiry')
  const input = createEnquiryInput.parse(raw)
  if (input.courseFee != null && input.proposedFee != null && input.proposedFee > input.courseFee) throw new Error('The discounted fee cannot be more than the actual fee')
  const branchId = needBranch(actor)
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new Error('Branch not found')

  const { person, created } = await upsertPerson(tx, branchId, input.person)
  if (input.occupation) await tx.insert(personOccupations).values({ personId: person.id, branchId, ...input.occupation })

  // a new lead is the creator's own; giving it to someone else is lead distribution (lead:assign), and only to an
  // active login of this branch (head office: any active login) - an outsider would otherwise get to read the person
  let assignedTo = actor.userId
  if (input.assignedTo && input.assignedTo !== actor.userId) {
    if (!can(actor, 'assign', 'lead')) throw new Error('Forbidden: only someone who hands out leads can assign this lead to another person')
    const [t] = await tx.select({ isActive: users.isActive, branchId: users.branchId, deletedAt: users.deletedAt }).from(users).where(eq(users.id, input.assignedTo))
    if (!t || !t.isActive || t.deletedAt || (actor.role !== 'super_admin' && t.branchId !== branchId)) throw new Error('Assign the lead to an active member of this branch')
    assignedTo = input.assignedTo
  }

  const enquiryNo = await nextEnquiryNo(tx, branchId, branch.code)
  const [enq] = await tx
    .insert(enquiries)
    .values({
      enquiryNo, branchId, personId: person.id,
      sourceId: input.sourceId, departmentId: input.departmentId, courseId: input.courseId, classModeId: input.classModeId,
      courseFee: input.courseFee, proposedFee: input.proposedFee, actualFee: input.actualFee, demoBy: input.demoBy,
      assignedTo,
      expectedJoinDate: input.expectedJoinDate, nextFollowUp: input.followUpDate,
      createdBy: actor.userId,
      // No lead details given (imports, a call made into an enquiry): an enquiry is someone who came to the office.
      ...(input.lead ? leadColumns(input.lead) : { visited: true, visitedAt: new Date() }),
    })
    .returning()
  await tx.insert(enquiryEvents).values({
    enquiryId: enq.id, branchId, byUser: actor.userId, fromStatus: null, toStatus: 'new',
    followUpDate: input.followUpDate, note: input.remarks,
  })
  await audit(tx, actor, { action: 'create', entity: 'enquiry', entityId: enq.id, after: { enquiryNo, personId: person.id } })
  await emitLead(tx, enq.id, 'panel')
  if (!opts.quiet) await (enq.visited ? thankForVisit : thankForEnquiry)(tx, branchId, person.id)
  return { enquiry: enq, person, personWasExisting: !created }
}

export async function transitionEnquiry(tx: Tx, actor: Actor, raw: TransitionInput) {
  assertCan(actor, 'update', 'enquiry')
  const input = transitionInput.parse(raw)
  const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, input.enquiryId)).for('update')
  if (!enq) throw new Error('Enquiry not found')
  if (!TRANSITIONS[enq.status].includes(input.to)) throw new Error(`Illegal status change: ${enq.status} -> ${input.to}`)
  if (input.to === 'not_joined' && !input.notJoinedReasonId) throw new Error('Pick a reason for "Not joined"')
  if (input.to === 'follow_up' && !input.followUpDate) throw new Error('Follow-up needs a date')

  await tx.insert(enquiryEvents).values({
    enquiryId: enq.id, branchId: enq.branchId, byUser: actor.userId,
    fromStatus: enq.status, toStatus: input.to, followUpDate: input.followUpDate, note: input.note,
  })
  const [updated] = await tx
    .update(enquiries)
    .set({
      status: input.to,
      nextFollowUp: input.followUpDate ?? null,
      notJoinedReasonId: input.to === 'not_joined' ? input.notJoinedReasonId : null,
      updatedAt: new Date(),
    })
    .where(eq(enquiries.id, enq.id))
    .returning()
  await audit(tx, actor, { action: 'transition', entity: 'enquiry', entityId: enq.id, before: { status: enq.status }, after: { status: input.to } })
  return updated
}

/** Update the lead details after talking to the person. Works on own-branch enquiries and on leads assigned to the actor. */
export async function updateLead(tx: Tx, actor: Actor, raw: UpdateLeadInput) {
  assertCan(actor, 'update', 'enquiry')
  const input = updateLeadInput.parse(raw)
  const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, input.enquiryId)).for('update')
  if (!enq) throw new Error('Enquiry not found')
  const after = leadColumns(input.lead, enq.visitedAt)
  const b = input.basics
  if (b) {
    if (b.courseFee != null && b.proposedFee != null && b.proposedFee > b.courseFee) throw new Error('The discounted fee cannot be more than the actual fee')
    const norm = normalizePhone(b.person.phone)
    const [other] = await tx.select({ id: persons.id }).from(persons).where(and(eq(persons.branchId, enq.branchId), eq(persons.phoneNorm, norm), sql`${persons.id} <> ${enq.personId}`))
    if (other) throw new Error('Another student in this branch already has this phone number')
    await tx.update(persons).set({ firstName: b.person.firstName, lastName: b.person.lastName || null, phone: b.person.phone, phoneNorm: norm, altPhone: b.person.altPhone || null }).where(eq(persons.id, enq.personId))
  }
  // A lead the website sent keeps its source (Website): it is a fact about where it came from, not a choice.
  const fromWebsite = !!enq.sourceUrl || Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from web_leads where enquiry_id = ${enq.id}`)).rows[0]?.n ?? 0) > 0
  await tx.update(enquiries).set({
    ...after,
    ...(b && { sourceId: fromWebsite ? enq.sourceId : b.sourceId ?? null, departmentId: b.departmentId ?? null, courseId: b.courseId ?? null, classModeId: b.classModeId ?? null, courseFee: b.courseFee ?? null, proposedFee: b.proposedFee ?? null }),
    updatedAt: new Date(),
  }).where(eq(enquiries.id, enq.id))
  await audit(tx, actor, {
    action: 'update_lead', entity: 'enquiry', entityId: enq.id,
    before: { visited: enq.visited, interested: enq.interested, interestPct: enq.interestPct, callDone: enq.callDone, callAt: enq.callAt, callRemark: enq.callRemark, location: enq.location, interestedBranchId: enq.interestedBranchId, categoryId: enq.categoryId, ...(b && { sourceId: enq.sourceId, departmentId: enq.departmentId, courseId: enq.courseId, classModeId: enq.classModeId, courseFee: enq.courseFee, proposedFee: enq.proposedFee }) },
    after: { ...after, ...(b && { basics: b }) },
  })
  if (!enq.visited && after.visited) await thankForVisit(tx, enq.branchId, enq.personId)
}

/** A follow-up call on a lead: kept in the enquiry history; the lead takes the new call details and the next follow-up date. */
export async function followUpLead(tx: Tx, actor: Actor, raw: FollowUpLeadInput) {
  assertCan(actor, 'update', 'enquiry')
  const input = followUpLeadInput.parse(raw)
  const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, input.enquiryId)).for('update')
  if (!enq) throw new Error('Enquiry not found')
  if (enq.status === 'joined') throw new Error('This person has already joined')
  const calledAt = input.calledAt ? new Date(input.calledAt) : new Date()
  await tx.insert(enquiryEvents).values({
    enquiryId: enq.id, branchId: enq.branchId, byUser: actor.userId, at: calledAt,
    fromStatus: enq.status, toStatus: 'follow_up', followUpDate: input.nextFollowUp, note: input.callRemark ?? null,
  })
  await tx.update(enquiries).set({
    status: 'follow_up', nextFollowUp: input.nextFollowUp, notJoinedReasonId: null,
    callDone: true, callAt: calledAt, callRemark: input.callRemark ?? enq.callRemark,
    ...(input.interested === undefined ? {} : { interested: input.interested, interestPct: input.interested === true ? input.interestPct ?? null : null }),
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    updatedAt: new Date(),
  }).where(eq(enquiries.id, enq.id))
  await audit(tx, actor, { action: 'follow_up', entity: 'enquiry', entityId: enq.id, before: { status: enq.status, nextFollowUp: enq.nextFollowUp }, after: { status: 'follow_up', nextFollowUp: input.nextFollowUp } })
}

/** The history of an enquiry or lead (status changes and follow-up calls), newest first. */
export async function enquiryTimeline(tx: Tx, actor: Actor, enquiryId: string) {
  assertCan(actor, 'read', 'enquiry')
  return tx
    .select({ id: enquiryEvents.id, at: enquiryEvents.at, by: users.name, fromStatus: enquiryEvents.fromStatus, toStatus: enquiryEvents.toStatus, followUpDate: enquiryEvents.followUpDate, note: enquiryEvents.note })
    .from(enquiryEvents).leftJoin(users, eq(users.id, enquiryEvents.byUser))
    .where(eq(enquiryEvents.enquiryId, enquiryId)).orderBy(desc(enquiryEvents.at))
}

/**
 * Deleting hides the row (database policy not_deleted) and keeps who did it. The row being deleted must stay visible
 * to its own update, so app.show_deleted is on just for that statement.
 */
async function hide(tx: Tx, run: () => Promise<unknown>) {
  await tx.execute(sql`select set_config('app.show_deleted', 'on', true)`)
  await run()
  await tx.execute(sql`select set_config('app.show_deleted', '', true)`)
}

export const DELETED_DAYS = 30

export type DeletedRow = { kind: 'call' | 'lead'; id: string; ref: string | null; name: string | null; phone: string | null; course: string | null; branch: string | null; deletedAt: string; deletedBy: string | null; daysLeft: number }

/** Random calls and leads deleted in the last 30 days (for the Logs screen), newest first. After that they are no longer shown. */
export async function listDeleted(tx: Tx, actor: Actor): Promise<DeletedRow[]> {
  assertCan(actor, 'read', 'audit')
  let rows: { kind: 'call' | 'lead'; id: string; ref: string | null; name: string | null; phone: string | null; course: string | null; branch: string | null; deleted_at: Date; deleted_by: string | null }[] = []
  await hide(tx, async () => {
    rows = (await tx.execute<(typeof rows)[number]>(sql`
      select 'call' as kind, k.id, null as ref, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(co.title, d.name) as course, b.code as branch, k.deleted_at, u.name as deleted_by
      from calls k left join persons p on p.id = k.person_id left join courses co on co.id = k.course_id left join departments d on d.id = k.department_id
        left join branches b on b.id = k.branch_id left join users u on u.id = k.deleted_by
      where k.deleted_at > now() - make_interval(days => ${DELETED_DAYS})
      union all
      select 'lead', e.id, e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')), p.phone, coalesce(co.title, d.name), b.code, e.deleted_at, u.name
      from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id left join departments d on d.id = e.department_id
        left join branches b on b.id = e.branch_id left join users u on u.id = e.deleted_by
      where e.deleted_at > now() - make_interval(days => ${DELETED_DAYS})
      order by deleted_at desc limit 500`)).rows
  })
  return rows.map((r) => ({
    kind: r.kind, id: r.id, ref: r.ref, name: r.name, phone: r.phone, course: r.course, branch: r.branch, deletedBy: r.deleted_by, deletedAt: new Date(r.deleted_at).toISOString(),
    daysLeft: Math.max(0, DELETED_DAYS - Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 864e5)),
  }))
}

/** Bring back a call or lead deleted in the last 30 days. Needs the same permission as deleting it. */
export async function restoreDeleted(tx: Tx, actor: Actor, kind: 'call' | 'lead', rawId: string) {
  assertCan(actor, 'delete', kind === 'call' ? 'call' : 'enquiry')
  if (!/^[0-9a-f-]{36}$/i.test(rawId)) throw new Error('Record not found')
  let n = 0
  await hide(tx, async () => {
    const fresh = sql`deleted_at > now() - make_interval(days => ${DELETED_DAYS})`
    const res = kind === 'call'
      ? await tx.update(calls).set({ deletedAt: null, deletedBy: null }).where(and(eq(calls.id, rawId), fresh)).returning({ id: calls.id })
      : await tx.update(enquiries).set({ deletedAt: null, deletedBy: null }).where(and(eq(enquiries.id, rawId), fresh)).returning({ id: enquiries.id })
    n = res.length
  })
  if (!n) throw new Error('This record can no longer be restored')
  await audit(tx, actor, { action: 'restore', entity: kind === 'call' ? 'call' : 'enquiry', entityId: rawId })
}

/** Delete a lead or enquiry (to the Recycle Bin for 30 days). One already registered stays: delete the registration first. */
export async function deleteLead(tx: Tx, actor: Actor, enquiryId: string) {
  assertCan(actor, 'delete', 'enquiry')
  const [enq] = await tx.select().from(enquiries).where(eq(enquiries.id, enquiryId)).for('update')
  if (!enq) throw new Error('Lead not found')
  const reg = await tx.execute(sql`select 1 from registrations where enquiry_id = ${enq.id} limit 1`)
  if (reg.rows.length) throw new Error('This lead is already registered and cannot be deleted')
  await hide(tx, () => tx.update(enquiries).set({ deletedAt: new Date(), deletedBy: actor.userId }).where(eq(enquiries.id, enq.id)))
  await audit(tx, actor, { action: 'delete', entity: 'enquiry', entityId: enq.id, before: { enquiryNo: enq.enquiryNo, personId: enq.personId, status: enq.status } })
}

/** Delete a random call logged by mistake. A call that became an enquiry stays. */
export async function deleteCall(tx: Tx, actor: Actor, callId: string) {
  assertCan(actor, 'delete', 'call')
  const [call] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update')
  if (!call) throw new Error('Call not found')
  if (call.enquiryId) throw new Error('This call is already an enquiry and cannot be deleted')
  await hide(tx, () => tx.update(calls).set({ deletedAt: new Date(), deletedBy: actor.userId }).where(eq(calls.id, call.id)))
  await audit(tx, actor, { action: 'delete', entity: 'call', entityId: call.id, before: { personId: call.personId, status: call.status } })
}

/**
 * The lead details of a call, with the rules of each status:
 * "Will visit" needs the expected visit date; "Dead lead" needs a reason and has no further follow-up.
 */
function callLeadColumns(i: { status?: string | null; callRemark?: string | null; interested?: boolean | null; interestPct?: number | null; expectedVisitDate?: string | null; deadReason?: string | null }, nextFollowUp: string | null | undefined) {
  const dead = i.status === 'Dead lead'
  if (i.status === 'Will visit' && !i.expectedVisitDate) throw new Error('"Will visit" needs the expected visit date')
  if (dead && !i.deadReason) throw new Error('Write why this lead is dead')
  if (i.interested === true && i.interestPct == null) throw new Error('Enter how interested the caller is (percentage)')
  return {
    status: i.status ?? null, callRemark: i.callRemark ?? null,
    interested: dead ? false : i.interested ?? null, interestPct: !dead && i.interested === true ? i.interestPct ?? null : null,
    expectedVisitDate: i.status === 'Will visit' ? i.expectedVisitDate ?? null : null,
    deadReason: dead ? i.deadReason ?? null : null,
    followUpDate: dead ? null : nextFollowUp ?? null,
  }
}

/** A follow-up call: kept in the history, and the call itself takes the new status, remarks and next follow-up date. */
export async function followUpCall(tx: Tx, actor: Actor, raw: FollowUpCallInput) {
  assertCan(actor, 'update', 'call')
  const input = followUpCallInput.parse(raw)
  const [call] = await tx.select().from(calls).where(eq(calls.id, input.callId)).for('update')
  if (!call) throw new Error('Call not found')
  if (call.enquiryId) throw new Error('This caller already visited: follow up on the enquiry instead')
  const lead = callLeadColumns(input, input.nextFollowUp)
  if (!lead.followUpDate && !['Dead lead', 'Visited'].includes(input.status)) throw new Error('Set the next follow-up date')
  await tx.insert(callFollowups).values({
    callId: call.id, branchId: call.branchId, byUser: actor.userId, calledAt: input.calledAt ? new Date(input.calledAt) : new Date(),
    status: lead.status, callRemark: lead.callRemark, remarks: input.remarks ?? null, interested: lead.interested, interestPct: lead.interestPct,
    nextFollowUp: lead.followUpDate, expectedVisitDate: lead.expectedVisitDate, deadReason: lead.deadReason,
  })
  await tx.update(calls).set({ ...lead, remarks: input.remarks ?? call.remarks, ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }) }).where(eq(calls.id, call.id))
  await audit(tx, actor, { action: 'follow_up', entity: 'call', entityId: call.id, before: { status: call.status, followUpDate: call.followUpDate }, after: { status: lead.status, followUpDate: lead.followUpDate } })
}

/** The follow-up history of a call, newest first. */
export async function callFollowUps(tx: Tx, actor: Actor, callId: string) {
  assertCan(actor, 'read', 'call')
  return tx
    .select({
      id: callFollowups.id, calledAt: callFollowups.calledAt, by: users.name, status: callFollowups.status, callRemark: callFollowups.callRemark, remarks: callFollowups.remarks,
      interested: callFollowups.interested, interestPct: callFollowups.interestPct, nextFollowUp: callFollowups.nextFollowUp, expectedVisitDate: callFollowups.expectedVisitDate, deadReason: callFollowups.deadReason,
    })
    .from(callFollowups).leftJoin(users, eq(users.id, callFollowups.byUser))
    .where(eq(callFollowups.callId, callId)).orderBy(desc(callFollowups.calledAt))
}

export async function logCall(tx: Tx, actor: Actor, raw: LogCallInput) {
  assertCan(actor, 'create', 'call')
  const input = logCallInput.parse(raw)
  const branchId = needBranch(actor)
  const { person } = await upsertPerson(tx, branchId, input.person)
  if (input.qualification || input.collegeName) {
    // fildes.md "Random call" captures qualification + college: they belong to the person (P2). A caller who names a college is a student.
    const [student] = await tx.select().from(lookups).where(and(eq(lookups.kind, 'occupation_type'), eq(lookups.value, 'Student')))
    if (student) await tx.insert(personOccupations).values({ personId: person.id, branchId, typeId: student.id, qualification: input.qualification, schoolOrCollege: input.collegeName })
  }
  const [call] = await tx
    .insert(calls)
    .values({
      branchId, personId: person.id, receivedBy: actor.userId, departmentId: input.departmentId,
      courseId: input.courseId, proposedFee: input.proposedFee, remarks: input.remarks, categoryId: input.categoryId ?? null,
      ...callLeadColumns(input, input.followUpDate),
    })
    .returning()
  await audit(tx, actor, { action: 'create', entity: 'call', entityId: call.id })
  await thankForEnquiry(tx, branchId, person.id)
  return { call, person }
}

/** Correct a logged call (what was discussed, the follow-up). RLS keeps it to the actor's branch. */
export async function updateCall(tx: Tx, actor: Actor, raw: UpdateCallInput) {
  assertCan(actor, 'update', 'call')
  const { id, ...input } = updateCallInput.parse(raw)
  const [before] = await tx.select().from(calls).where(eq(calls.id, id)).for('update')
  if (!before) throw new Error('Call not found')
  const after = { departmentId: input.departmentId ?? null, courseId: input.courseId ?? null, proposedFee: input.proposedFee ?? null, remarks: input.remarks ?? null, categoryId: input.categoryId ?? null, ...callLeadColumns(input, input.followUpDate) }
  await tx.update(calls).set(after).where(eq(calls.id, id))
  await audit(tx, actor, { action: 'update', entity: 'call', entityId: id, before: { departmentId: before.departmentId, courseId: before.courseId, proposedFee: before.proposedFee, status: before.status, remarks: before.remarks, followUpDate: before.followUpDate }, after })
}

const ENQ_STATUSES = ['new', 'contacted', 'follow_up', 'demo', 'joined', 'not_joined', 'dead'] as const

/** Shared by the follow-up filters of enquiries and calls. */
function followUpWhere(col: typeof enquiries.nextFollowUp | typeof calls.followUpDate, v: string | null) {
  if (v === 'overdue') return sql`${col} < current_date`
  if (v === 'today') return sql`${col} = current_date`
  if (v === 'upcoming') return sql`${col} > current_date`
  if (v === 'none') return isNull(col)
  return undefined
}

/**
 * Filters (query.f): status, dept, course, source, mode, follow (overdue|today|upcoming|none), assigned (me|none),
 * interest (yes|no|unset), call (done|pending), visited (yes|no), wants (branch id), category. Date range = enquiry date.
 * Sort: created, no, name, followup, status, fee, interest.
 */
export async function listEnquiries(
  tx: Tx,
  actor: Actor,
  // visited: true = the Enquiries screen (came to the office), false = the Leads screen (not visited yet), absent = both
  opts: { q?: string; status?: EnquiryStatus; mine?: boolean; visited?: boolean; limit?: number; offset?: number; query?: ListQuery } = {},
) {
  assertCan(actor, 'read', 'enquiry')
  const src = alias(lookups, 'src')
  const c = cleanQuery({ ...opts.query, q: opts.query?.q ?? opts.q })
  const status = opts.status ?? c.one(ENQ_STATUSES, 'status')
  const assigned = c.one(['me', 'none'] as const, 'assigned')
  const interest = c.one(['yes', 'no', 'unset'] as const, 'interest')
  const call = c.one(['done', 'pending'] as const, 'call')
  const visited = opts.visited === undefined ? c.one(['yes', 'no'] as const, 'visited') : opts.visited ? 'yes' : 'no'
  const name = sql<string>`trim(${persons.firstName} || ' ' || coalesce(${persons.lastName}, ''))`
  const where = and(
    status ? eq(enquiries.status, status) : undefined,
    opts.mine ? eq(enquiries.assignedTo, actor.userId) : undefined, // "My leads": only what is assigned to me (any branch)
    c.like
      ? or(
          ilike(persons.firstName, c.like),
          ilike(persons.lastName, c.like),
          ilike(persons.phone, c.like),
          ilike(enquiries.enquiryNo, c.like),
          sql`${name} ilike ${c.like}`,
        )
      : undefined,
    c.id('dept') ? eq(enquiries.departmentId, c.id('dept')!) : undefined,
    c.id('course') ? eq(enquiries.courseId, c.id('course')!) : undefined,
    c.id('source') ? eq(enquiries.sourceId, c.id('source')!) : undefined,
    c.id('mode') ? eq(enquiries.classModeId, c.id('mode')!) : undefined,
    assigned === 'me' ? eq(enquiries.assignedTo, actor.userId) : assigned === 'none' ? isNull(enquiries.assignedTo) : undefined,
    interest === 'yes' ? eq(enquiries.interested, true) : interest === 'no' ? eq(enquiries.interested, false) : interest === 'unset' ? isNull(enquiries.interested) : undefined,
    call ? eq(enquiries.callDone, call === 'done') : undefined,
    visited ? eq(enquiries.visited, visited === 'yes') : undefined,
    c.id('wants') ? eq(enquiries.interestedBranchId, c.id('wants')!) : undefined,
    c.id('category') ? eq(enquiries.categoryId, c.id('category')!) : undefined,
    followUpWhere(enquiries.nextFollowUp, c.f('follow')),
    // The Visited enquiries screen works by the date of the visit; everywhere else by the date the enquiry was added.
    inRange(opts.visited === true ? sql`coalesce(${enquiries.visitedAt}, ${enquiries.createdAt})` : enquiries.createdAt, c.from, c.to),
  )
  const fee = sql<number | null>`coalesce(${enquiries.actualFee}, ${enquiries.proposedFee})`
  const order = orderFrom(
    { created: enquiries.createdAt, no: enquiries.enquiryNo, name: sql`lower(${name})`, followup: enquiries.nextFollowUp, status: enquiries.status, fee, interest: enquiries.interestPct },
    c.sort, c.dir, 'created', enquiries.id,
  )
  const rows = await tx
    .select({
      id: enquiries.id,
      enquiryNo: enquiries.enquiryNo,
      status: enquiries.status,
      createdAt: enquiries.createdAt,
      nextFollowUp: enquiries.nextFollowUp,
      fee,
      courseFee: enquiries.courseFee, proposedFee: enquiries.proposedFee,
      name,
      firstName: persons.firstName, lastName: persons.lastName,
      phone: persons.phone, altPhone: persons.altPhone,
      courseId: enquiries.courseId, departmentId: enquiries.departmentId, sourceId: enquiries.sourceId, classModeId: enquiries.classModeId,
      course: courses.title,
      department: departments.name,
      source: src.value,
      sourceUrl: enquiries.sourceUrl,
      staff: users.name,
      visited: enquiries.visited, interested: enquiries.interested, interestPct: enquiries.interestPct, callDone: enquiries.callDone, callAt: enquiries.callAt, callRemark: enquiries.callRemark,
      location: enquiries.location, interestedBranchId: enquiries.interestedBranchId,
      categoryId: enquiries.categoryId, category: leadCategories.name,
      // Registered = an admission exists for this enquiry. The date is when it was registered (not when the person visited).
      registeredAt: sql<string | null>`(select to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from registrations r where r.enquiry_id = ${enquiries.id})`,
      regNo: sql<string | null>`(select r.reg_no from registrations r where r.enquiry_id = ${enquiries.id})`,
      interestedBranch: sql<string | null>`(select bo.code from branch_options() bo where bo.id = ${enquiries.interestedBranchId})`,
    })
    .from(enquiries)
    .innerJoin(persons, eq(persons.id, enquiries.personId))
    .leftJoin(courses, eq(courses.id, enquiries.courseId))
    .leftJoin(departments, eq(departments.id, enquiries.departmentId))
    .leftJoin(src, eq(src.id, enquiries.sourceId))
    .leftJoin(users, eq(users.id, enquiries.assignedTo))
    .leftJoin(leadCategories, eq(leadCategories.id, enquiries.categoryId))
    .where(where)
    .orderBy(order)
    .limit(opts.limit ?? 25)
    .offset(opts.offset ?? 0)
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(enquiries)
    .innerJoin(persons, eq(persons.id, enquiries.personId))
    .where(where)
  return { rows, total: n }
}

export type VisitSummary = { visited: number; registered: number; registeredFromEarlier: number; notRegistered: number }

/**
 * Headline numbers for the Visited enquiries screen, for a period (or all time when no dates are given).
 * A visit counts in the period it happened; a registration counts in the period it was made, even when the person
 * visited earlier. Example: 20 visits last month, 17 registered then, 2 more registered this month ->
 * last month = 20 visited / 17 registered / 3 not registered; this month = 0 visited / 2 registered (2 from earlier visits).
 */
export async function visitSummary(tx: Tx, actor: Actor, range: { from?: string | null; to?: string | null } = {}): Promise<VisitSummary> {
  assertCan(actor, 'read', 'enquiry')
  const c = cleanQuery({ from: range.from ?? undefined, to: range.to ?? undefined })
  const visitAt = sql`coalesce(e.visited_at, e.created_at)`
  const res = await tx.execute<{ visited: number; registered: number; earlier: number; not_registered: number }>(sql`
    select
      (select count(*)::int from enquiries e where e.visited and ${inRange(visitAt, c.from, c.to) ?? sql`true`}) as visited,
      (select count(*)::int from registrations r join enquiries e on e.id = r.enquiry_id where e.visited and ${inRange(sql`r.created_at`, c.from, c.to) ?? sql`true`}) as registered,
      (select count(*)::int from registrations r join enquiries e on e.id = r.enquiry_id where e.visited and ${inRange(sql`r.created_at`, c.from, c.to) ?? sql`true`}
         and ${c.from ? sql`${visitAt} < ${c.from}::date` : sql`false`}) as earlier,
      (select count(*)::int from enquiries e where e.visited and ${inRange(visitAt, c.from, c.to) ?? sql`true`}
         and not exists (select 1 from registrations r where r.enquiry_id = e.id and ${c.to ? sql`r.created_at < ${c.to}::date + 1` : sql`true`})) as not_registered`)
  const r = res.rows[0]
  return { visited: r.visited, registered: r.registered, registeredFromEarlier: r.earlier, notRegistered: r.not_registered }
}

export async function enquiryHistory(tx: Tx, actor: Actor, enquiryId: string) {
  assertCan(actor, 'read', 'enquiry')
  return tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, enquiryId)).orderBy(enquiryEvents.at)
}

/** One click from a call to an enquiry: same person, source = "Random call", call is linked so it cannot be promoted twice. */
export async function promoteCall(tx: Tx, actor: Actor, callId: string, extra: { departmentId?: string | null; classModeId?: string | null } = {}) {
  assertCan(actor, 'create', 'enquiry')
  const [call] = await tx.select().from(calls).where(eq(calls.id, callId)).for('update')
  if (!call) throw new Error('Call not found')
  if (call.enquiryId) throw new Error('This call is already an enquiry')
  if (!call.personId) throw new Error('Call has no student attached')
  const departmentId = extra.departmentId ?? call.departmentId
  if (!departmentId) throw new Error('Choose a department to create the enquiry')
  const [person] = await tx.select().from(persons).where(eq(persons.id, call.personId))
  const [src] = await tx.select().from(lookups).where(and(eq(lookups.kind, 'enquiry_source'), eq(lookups.value, 'Random call')))
  const r = await createEnquiry(tx, actor.branchId ? actor : { ...actor, branchId: call.branchId }, { // head office in "All branches": the enquiry goes to the call's branch
    person: { firstName: person.firstName, lastName: person.lastName, phone: person.phone },
    sourceId: src?.id, departmentId, courseId: call.courseId, classModeId: extra.classModeId,
    proposedFee: call.proposedFee, followUpDate: call.followUpDate, remarks: call.remarks,
    // The call turns into an enquiry when the person visits: carry the call over as the lead's call.
    lead: { visited: true, callDone: true, callAt: call.calledAt.toISOString(), callRemark: call.callRemark ?? call.remarks, interested: call.interested, interestPct: call.interestPct, categoryId: call.categoryId },
  })
  await tx.update(calls).set({ enquiryId: r.enquiry.id, status: 'Visited' }).where(eq(calls.id, call.id))
  return r.enquiry
}

/**
 * Filters (query.f): converted (yes|no), status (exact), branch, dept, course, follow (overdue|today|upcoming|none), mine (yes|assigned),
 * interest (yes|no|unset), category. Date range = call date. Sort: date, name, followup, fee, interest.
 */
function callsWhere(actor: Actor, query: ListQuery) {
  const c = cleanQuery(query)
  const converted = c.one(['yes', 'no'] as const, 'converted')
  const interest = c.one(['yes', 'no', 'unset'] as const, 'interest')
  const name = sql<string>`trim(${persons.firstName} || ' ' || coalesce(${persons.lastName}, ''))`
  return {
    c,
    name,
    where: and(
      c.like
        ? or(ilike(persons.firstName, c.like), ilike(persons.lastName, c.like), ilike(persons.phone, c.like),
            sql`${name} ilike ${c.like}`, ilike(calls.status, c.like), ilike(calls.remarks, c.like))
        : undefined,
      converted === 'yes' ? isNotNull(calls.enquiryId) : converted === 'no' ? isNull(calls.enquiryId) : undefined,
      c.f('status') ? eq(calls.status, c.f('status')!) : undefined,
      c.id('branch') ? eq(calls.branchId, c.id('branch')!) : undefined,
      c.id('dept') ? eq(calls.departmentId, c.id('dept')!) : undefined,
      c.id('course') ? eq(calls.courseId, c.id('course')!) : undefined,
      c.id('category') ? eq(calls.categoryId, c.id('category')!) : undefined,
      c.f('mine') === 'yes' ? eq(calls.receivedBy, actor.userId) : c.f('mine') === 'assigned' ? eq(calls.assignedTo, actor.userId) : undefined,
      interest === 'yes' ? eq(calls.interested, true) : interest === 'no' ? eq(calls.interested, false) : interest === 'unset' ? isNull(calls.interested) : undefined,
      followUpWhere(calls.followUpDate, c.f('follow')),
      inRange(calls.calledAt, c.from, c.to),
    ),
  }
}

export async function listCalls(tx: Tx, actor: Actor, opts: { q?: string; limit?: number; offset?: number; query?: ListQuery } = {}) {
  assertCan(actor, 'read', 'call')
  const { c, name, where } = callsWhere(actor, { ...opts.query, q: opts.query?.q ?? opts.q })
  return tx
    .select({
      id: calls.id, calledAt: calls.calledAt, status: calls.status, remarks: calls.remarks, followUpDate: calls.followUpDate,
      proposedFee: calls.proposedFee, enquiryId: calls.enquiryId, departmentId: calls.departmentId, courseId: calls.courseId,
      name, phone: persons.phone, altPhone: persons.altPhone,
      department: departments.name, course: courses.title, receivedBy: users.name,
      branchCode: branches.code, branchName: branches.name,
      callRemark: calls.callRemark, interested: calls.interested, interestPct: calls.interestPct, expectedVisitDate: calls.expectedVisitDate, deadReason: calls.deadReason,
      followUps: sql<number>`(select count(*)::int from call_followups f where f.call_id = ${calls.id})`,
      categoryId: calls.categoryId, category: leadCategories.name,
    })
    .from(calls)
    .leftJoin(branches, eq(branches.id, calls.branchId))
    .leftJoin(persons, eq(persons.id, calls.personId))
    .leftJoin(departments, eq(departments.id, calls.departmentId))
    .leftJoin(courses, eq(courses.id, calls.courseId))
    .leftJoin(users, eq(users.id, calls.receivedBy))
    .leftJoin(leadCategories, eq(leadCategories.id, calls.categoryId))
    .where(where)
    .orderBy(orderFrom({ date: calls.calledAt, name: sql`lower(${name})`, followup: calls.followUpDate, fee: calls.proposedFee, interest: calls.interestPct }, c.sort, c.dir, 'date', calls.id))
    .limit(opts.limit ?? 25)
    .offset(opts.offset ?? 0)
}

export async function listCallsPage(tx: Tx, actor: Actor, opts: { q?: string; limit?: number; offset?: number; query?: ListQuery } = {}) {
  const rows = await listCalls(tx, actor, opts)
  const { where } = callsWhere(actor, { ...opts.query, q: opts.query?.q ?? opts.q })
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(calls).leftJoin(persons, eq(persons.id, calls.personId)).where(where)
  return { rows, total: n }
}

/** Enquiries that can still become a registration (not dead, not already registered). For the registration form's search box. */
export async function searchConvertibleEnquiries(tx: Tx, actor: Actor, q: string) {
  assertCan(actor, 'read', 'enquiry')
  const like = `%${escapeLike(q.trim())}%`
  const res = await tx.execute<{ id: string; enquiry_no: string; name: string; phone: string; fee: number | null }>(sql`
    select e.id, e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(e.actual_fee, e.proposed_fee) as fee
    from enquiries e join persons p on p.id = e.person_id
    where e.status <> 'dead' and not exists (select 1 from registrations r where r.enquiry_id = e.id)
      and (${q.trim() === ''} or p.first_name ilike ${like} or p.last_name ilike ${like} or p.phone ilike ${like} or e.enquiry_no ilike ${like})
    order by e.created_at desc limit 20`)
  return res.rows.map((r) => ({ id: r.id, enquiryNo: r.enquiry_no, name: r.name, phone: r.phone, fee: r.fee }))
}

const IST = 'Asia/Kolkata'
const day = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST }) : '—')
const dayTime = (d: Date | string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: IST }) : '—')
const rupees = (paise: number | null) => (paise ? `₹${(paise / 100).toLocaleString('en-IN')}` : '—')
const interestText = (interested: boolean | null, pct: number | null) => (interested === null ? 'Not asked yet' : interested ? `Interested${pct != null ? ` (${pct}%)` : ''}` : 'Not interested')
const ENQ_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead enquiry' }
const LOG_LABEL: Record<string, string> = { create: 'Added', update: 'Edited', update_lead: 'Lead details edited', follow_up: 'Follow-up call saved', transition: 'Status changed', delete: 'Deleted' }

export type LeadRecord = {
  title: string
  fields: [string, string][]
  notes: [string, string][]
  /** Follow-up calls and status changes, newest first. */
  followUps: { id: string; at: string; by: string | null; title: string; text: string }[]
  /** Who did what to this record (from the audit log), newest first. */
  logs: { id: string; at: string; by: string | null; what: string }[]
}

/** Everything about one random call or one lead / visited enquiry: details, follow-ups, and the log of who changed it. */
export async function leadRecord(tx: Tx, actor: Actor, kind: 'call' | 'enquiry', rawId: string): Promise<LeadRecord> {
  assertCan(actor, 'read', kind)
  const id = rawId.match(/^[0-9a-f-]{36}$/i) ? rawId : null
  if (!id) throw new Error('Record not found')
  const auditRows = await tx.execute<{ id: string; at: Date; by: string | null; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(sql`
    select a.id, a.at, u.name as by, a.action, a.before, a.after from audit_logs a left join users u on u.id = a.user_id
    where a.entity = ${kind} and a.entity_id = ${id} order by a.at desc limit 200`)
  const logs = auditRows.rows.map((a) => {
    const from = a.before?.status, to = a.after?.status
    const label = (v: unknown) => (kind === 'enquiry' ? ENQ_LABEL[String(v)] ?? String(v) : String(v))
    return { id: a.id, at: new Date(a.at).toISOString(), by: a.by, what: `${LOG_LABEL[a.action] ?? a.action}${to && from !== to ? `: ${from ? `${label(from)} → ` : ''}${label(to)}` : ''}` }
  })

  if (kind === 'call') {
    const res = await tx.execute<Record<string, never>>(sql`
      select k.*, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, p.alt_phone, d.name as department, co.title as course,
        u.name as taken_by, b.code as branch_code, b.name as branch_name, lc.name as category, e.enquiry_no
      from calls k left join persons p on p.id = k.person_id left join departments d on d.id = k.department_id left join courses co on co.id = k.course_id
        left join users u on u.id = k.received_by left join branches b on b.id = k.branch_id left join lead_categories lc on lc.id = k.category_id left join enquiries e on e.id = k.enquiry_id
      where k.id = ${id}`)
    const c = res.rows[0] as Record<string, never> | undefined
    if (!c) throw new Error('Call not found')
    const fu = await callFollowUps(tx, actor, id)
    return {
      title: `Random call — ${c.name ?? ''}`,
      fields: [
        ['Caller', c.name ?? '—'], ['Contact no.', c.phone ?? '—'], ['Alternate no.', c.alt_phone ?? '—'],
        ['Branch', c.branch_code ? `${c.branch_code} — ${c.branch_name}` : '—'], ['First call', dayTime(c.called_at)], ['Taken by', c.taken_by ?? '—'],
        ['Department', c.department ?? '—'], ['Course', c.course ?? '—'], ['Proposed fee', rupees(c.proposed_fee)],
        ['Status', c.status ?? '—'], ['Interest', interestText(c.interested, c.interest_pct)], ['Lead category', c.category ?? '—'],
        ['Next follow-up', day(c.follow_up_date)], ['Expected visit', day(c.expected_visit_date)], ['Visited', c.enquiry_no ? `Yes — enquiry ${c.enquiry_no}` : 'Not visited yet'],
      ],
      notes: [['Call remark', c.call_remark ?? '—'], ['Staff remark', c.remarks ?? '—'], ...(c.dead_reason ? [['Why the lead is dead', String(c.dead_reason)] as [string, string]] : [])],
      followUps: fu.map((f) => ({
        id: f.id, at: f.calledAt.toISOString(), by: f.by, title: `${f.status ?? '—'}${f.interested === null ? '' : ` · ${interestText(f.interested, f.interestPct).toLowerCase()}`}`,
        text: [f.callRemark && `Caller: ${f.callRemark}`, f.remarks && `Remark: ${f.remarks}`, f.expectedVisitDate && `Expected visit: ${day(f.expectedVisitDate)}`, f.deadReason && `Dead: ${f.deadReason}`, f.nextFollowUp && `Next follow-up: ${day(f.nextFollowUp)}`].filter(Boolean).join('\n') || '—',
      })),
      logs,
    }
  }

  const res = await tx.execute<Record<string, never>>(sql`
    select e.*, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, p.alt_phone, d.name as department, co.title as course,
      src.value as source, md.value as class_mode, nj.value as not_joined_reason, u.name as assigned, b.code as branch_code, b.name as branch_name, lc.name as category,
      (select bo.code from branch_options() bo where bo.id = e.interested_branch_id) as wants_branch
    from enquiries e join persons p on p.id = e.person_id left join departments d on d.id = e.department_id left join courses co on co.id = e.course_id
      left join lookups src on src.id = e.source_id left join lookups md on md.id = e.class_mode_id left join lookups nj on nj.id = e.not_joined_reason_id
      left join users u on u.id = e.assigned_to left join branches b on b.id = e.branch_id left join lead_categories lc on lc.id = e.category_id
    where e.id = ${id}`)
  const q = res.rows[0] as Record<string, never> | undefined
  if (!q) throw new Error('Enquiry not found')
  const tl = await enquiryTimeline(tx, actor, id)
  return {
    title: `${q.visited ? 'Visited enquiry' : 'Lead'} — ${q.name ?? ''}`,
    fields: [
      ['Name', q.name ?? '—'], ['Contact no.', q.phone ?? '—'], ['Alternate no.', q.alt_phone ?? '—'],
      [q.visited ? 'Enquiry no.' : 'Lead no.', q.enquiry_no], ['Branch', q.branch_code ? `${q.branch_code} — ${q.branch_name}` : '—'], ['Added on', dayTime(q.created_at)],
      ['Came from', q.source_url ? `${q.source ?? 'Website'} (${q.source_url})` : q.source ?? '—'], ['Assigned to', q.assigned ?? '—'], ['Mode of classes', q.class_mode ?? '—'],
      ['Department', q.department ?? '—'], ['Course', q.course ?? '—'], ['Actual fee', rupees(q.course_fee)],
      ['Discounted / proposed fee', rupees(q.proposed_fee)], ['Discount', q.course_fee && q.proposed_fee ? rupees(q.course_fee - q.proposed_fee) : '—'], ['Fee agreed at registration', rupees(q.actual_fee)],
      ['Status', `${ENQ_LABEL[q.status] ?? q.status}${q.not_joined_reason ? ` (${q.not_joined_reason})` : ''}`], ['Interest', interestText(q.interested, q.interest_pct)], ['Lead category', q.category ?? '—'],
      ['Last call', q.call_done ? dayTime(q.call_at) : 'Not called yet'], ['Next follow-up', day(q.next_follow_up)], ['Expected to join', day(q.expected_join_date)],
      ['Location', q.location ?? '—'], ['Wants branch', q.wants_branch ?? '—'], ['Visited', q.visited ? `Yes${q.visited_at ? ` — ${day(q.visited_at)}` : ''}` : 'Not visited yet'],
    ],
    notes: [['Call remark', q.call_remark ?? '—'], ...(q.final_remarks ? [['Final remarks', String(q.final_remarks)] as [string, string]] : [])],
    followUps: tl.map((h) => ({
      id: h.id, at: h.at.toISOString(), by: h.by,
      title: `${h.fromStatus && h.fromStatus !== h.toStatus ? `${ENQ_LABEL[h.fromStatus]} → ` : ''}${ENQ_LABEL[h.toStatus]}`,
      text: [h.note, h.followUpDate && `Next follow-up: ${day(h.followUpDate)}`].filter(Boolean).join('\n') || '—',
    })),
    logs,
  }
}
