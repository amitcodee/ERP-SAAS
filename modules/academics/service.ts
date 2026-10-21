// Batches, sessions, attendance and assessments. Attendance % itself lives only in v_attendance_pct (P6).
import { and, eq, inArray, sql } from 'drizzle-orm'
import { alertAbsences } from '@/modules/notifications/whatsapp-events'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan, can } from '@/lib/auth/permissions'
import { assessments, attendance, batchMembers, batches, classSessions, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { monthIST, todayIST } from '@/lib/ist'
import { PROJECT_PLACEHOLDER } from '@/lib/project-title'

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const optText = z.string().trim().max(300).optional().nullable()
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)')

export const createBatchInput = z.object({
  name: z.string().trim().min(2).max(80),
  departmentId: uuid,
  courseId: uuid.optional().nullable(),
  trainerId: uuid.optional().nullable(),
  timing: optText,
  startDate: isoDate.optional().nullable(),
  capacity: z.number().int().positive().optional().nullable(),
  days: z.array(z.number().int().min(1).max(7)).max(7).optional().nullable(), // ISO weekdays, 1 = Monday
  startTime: hhmm.optional().nullable(),
  endTime: hhmm.optional().nullable(),
  room: z.string().trim().max(40).optional().nullable(),
}).superRefine((v, ctx) => {
  const any = !!(v.days?.length || v.startTime || v.endTime)
  if (any && !(v.days?.length && v.startTime && v.endTime)) ctx.addIssue({ code: 'custom', path: ['days'], message: 'A schedule needs days, a start time and an end time' })
  if (v.startTime && v.endTime && v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after the start time' })
})
export type CreateBatchInput = z.input<typeof createBatchInput>

const needBranch = (a: Actor) => {
  if (!a.branchId) throw new Error('Choose a branch first (super admin must act inside a branch)')
  return a.branchId
}

/** Whoever cannot manage batches (a trainer) works only on their own batches; managers may work on any in the branch. */
async function assertBatchAccess(tx: Tx, actor: Actor, batchId: string) {
  const [b] = await tx.select().from(batches).where(eq(batches.id, batchId))
  if (!b) throw new Error('Batch not found')
  if (!can(actor, 'update', 'batch') && b.trainerId !== actor.userId) throw new Error('Forbidden: this is not your batch')
  return b
}

export async function createBatch(tx: Tx, actor: Actor, raw: CreateBatchInput) {
  assertCan(actor, 'create', 'batch')
  const input = createBatchInput.parse(raw)
  const days = input.days?.length ? [...new Set(input.days)].sort() : null
  const branchId = needBranch(actor)
  if (days) await assertNoClash(tx, { days, startTime: input.startTime!, endTime: input.endTime!, trainerId: input.trainerId ?? null, room: input.room || null })
  const [b] = await tx.insert(batches).values({ ...input, days, room: input.room || null, branchId }).returning()
  await audit(tx, actor, { action: 'create', entity: 'batch', entityId: b.id, after: input })
  return b
}

/** A trainer, or a room, cannot hold two active batches that meet on the same day at overlapping times. */
async function assertNoClash(tx: Tx, s: { days: number[]; startTime: string; endTime: string; trainerId: string | null; room: string | null; exceptBatch?: string }) {
  if (!s.trainerId && !s.room) return
  const res = await tx.execute<{ name: string; who: string }>(sql`
    select b.name, case when ${s.trainerId}::uuid is not null and b.trainer_id = ${s.trainerId}::uuid then 'trainer' else 'room' end as who
    from batches b
    where b.is_active and b.days && ${`{${s.days.join(',')}}`}::int[] and b.id <> ${s.exceptBatch ?? '00000000-0000-0000-0000-000000000000'}::uuid
      and b.start_time < ${s.endTime}::time and ${s.startTime}::time < b.end_time
      and ((${s.trainerId}::uuid is not null and b.trainer_id = ${s.trainerId}::uuid) or (${s.room}::text is not null and lower(b.room) = lower(${s.room}::text)))
    limit 1`)
  const c = res.rows[0]
  if (c) throw new Error(c.who === 'trainer' ? `This trainer already teaches "${c.name}" at that time` : `Room ${s.room} is already used by "${c.name}" at that time`)
}

/** Puts a student in a batch (with its trainer): the academic manager / branch, or the counselor who admitted them. */
export async function addBatchMember(tx: Tx, actor: Actor, batchId: string, registrationId: string) {
  const counselor = !can(actor, 'update', 'batch') && can(actor, 'update', 'registration')
  if (!counselor) assertCan(actor, 'update', 'batch')
  const b = counselor
    ? (await tx.select().from(batches).where(eq(batches.id, uuid.parse(batchId))))[0] ?? (() => { throw new Error('Batch not found') })()
    : await assertBatchAccess(tx, actor, batchId)
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, registrationId))
  if (!reg) throw new Error('Registration not found')
  if (reg.status !== 'active') throw new Error('Only active registrations can join a batch')
  if (counselor && reg.createdBy !== actor.userId) throw new Error('Only the counselor who admitted this student (or the academic manager) can put them in a batch')
  if (b.capacity) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(batchMembers).where(eq(batchMembers.batchId, batchId))
    if (n >= b.capacity) throw new Error('Batch is full')
  }
  await tx.insert(batchMembers).values({ batchId, registrationId, branchId: b.branchId }).onConflictDoNothing()
  await audit(tx, actor, { action: 'add_member', entity: 'batch', entityId: batchId, after: { registrationId } })
}

/** Changes (or removes) the trainer of a batch of this branch: the academic manager / branch. */
export async function setBatchTrainer(tx: Tx, actor: Actor, batchId: string, trainerId: string | null) {
  assertCan(actor, 'update', 'batch')
  const b = await assertBatchAccess(tx, actor, uuid.parse(batchId))
  const id = trainerId ? uuid.parse(trainerId) : null
  if (id && !(await listTrainers(tx)).some((t) => t.id === id)) throw new Error('Pick an active trainer')
  if (id && b.days?.length && b.startTime && b.endTime) await assertNoClash(tx, { days: b.days, startTime: b.startTime, endTime: b.endTime, trainerId: id, room: null, exceptBatch: b.id })
  await tx.update(batches).set({ trainerId: id }).where(eq(batches.id, b.id))
  await audit(tx, actor, { action: 'set_trainer', entity: 'batch', entityId: b.id, before: { trainerId: b.trainerId }, after: { trainerId: id } })
}

/** Takes a student out of a batch (their attendance and marks stay on record). */
export async function removeBatchMember(tx: Tx, actor: Actor, batchId: string, registrationId: string) {
  assertCan(actor, 'update', 'batch')
  const b = await assertBatchAccess(tx, actor, uuid.parse(batchId))
  await tx.delete(batchMembers).where(and(eq(batchMembers.batchId, b.id), eq(batchMembers.registrationId, uuid.parse(registrationId))))
  await audit(tx, actor, { action: 'remove_member', entity: 'batch', entityId: b.id, before: { registrationId } })
}

export async function createSession(tx: Tx, actor: Actor, input: { batchId: string; sessionDate: string; topic?: string | null }) {
  assertCan(actor, 'create', 'attendance')
  const b = await assertBatchAccess(tx, actor, uuid.parse(input.batchId))
  const [s] = await tx
    .insert(classSessions)
    .values({ batchId: b.id, branchId: b.branchId, sessionDate: isoDate.parse(input.sessionDate), topic: input.topic ?? null, createdBy: actor.userId })
    .onConflictDoUpdate({ target: [classSessions.batchId, classSessions.sessionDate], set: { topic: input.topic ?? null } })
    .returning()
  return s
}

export async function markAttendance(tx: Tx, actor: Actor, sessionId: string, marks: { registrationId: string; present: boolean }[]) {
  assertCan(actor, 'create', 'attendance')
  const [s] = await tx.select().from(classSessions).where(eq(classSessions.id, sessionId))
  if (!s) throw new Error('Session not found')
  // attendance is for a class that has happened: marking days ahead would lift attendance % (and certificate eligibility)
  if (String(s.sessionDate) > todayIST()) throw new Error('Attendance can be marked only for today or an earlier day')
  await assertBatchAccess(tx, actor, s.batchId)
  const ids = marks.map((m) => m.registrationId)
  const members = await tx.select({ id: batchMembers.registrationId }).from(batchMembers).where(and(eq(batchMembers.batchId, s.batchId), inArray(batchMembers.registrationId, ids)))
  if (members.length !== new Set(ids).size) throw new Error('Attendance can only be marked for members of this batch')
  for (const m of marks) {
    await tx
      .insert(attendance)
      .values({ sessionId, registrationId: m.registrationId, branchId: s.branchId, present: m.present, markedBy: actor.userId })
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.registrationId], set: { present: m.present, markedBy: actor.userId } })
  }
  await audit(tx, actor, { action: 'mark_attendance', entity: 'class_session', entityId: sessionId, after: { count: marks.length } })
  // the parents of today's absentees hear of it (when switched on: Settings → WhatsApp & SMS)
  await alertAbsences(tx, sessionId, marks.filter((m) => !m.present).map((m) => m.registrationId))
}

export async function addAssessment(
  tx: Tx,
  actor: Actor,
  input: { registrationId: string; kind: 'assignment' | 'test' | 'capstone'; title: string; tools?: string | null; score?: number | null; maxScore?: number | null },
) {
  assertCan(actor, 'create', 'assessment')
  if (!input.title?.trim()) throw new Error('A title is required')
  if (input.kind !== 'capstone') {
    const { score, maxScore } = input
    if (score == null || maxScore == null) throw new Error('Score and maximum score are required')
    if (!Number.isInteger(score) || !Number.isInteger(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) throw new Error('Score must be between 0 and the maximum score')
  }
  const [reg] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId))
  if (!reg) throw new Error('Registration not found')
  if (!can(actor, 'update', 'batch')) { // someone who cannot manage batches (a trainer) grades only their own batches' students
    const mine = await tx.execute<{ n: number }>(sql`select count(*)::int as n from batch_members m join batches b on b.id = m.batch_id where m.registration_id = ${reg.id} and b.trainer_id = ${actor.userId}`)
    if (!mine.rows[0].n) throw new Error('Forbidden: this student is not in your batch')
  }
  const [a] = await tx.insert(assessments).values({ ...input, branchId: reg.branchId, createdBy: actor.userId }).returning()
  return a
}

// ---- The capstone project: the student names it in the portal, the trainer checks it and approves (third certificate
// gate). The approved title and tools are what the project certificate prints.
const projectTitle = z.string().transform((t) => t.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(3, 'Enter the project title').max(120, 'Keep the project title under 120 characters'))
  .refine((t) => t.toLowerCase() !== PROJECT_PLACEHOLDER.toLowerCase(), 'Enter the real name of the project')
const projectTools = z.string().trim().max(300, 'Keep the tools under 300 characters').optional().nullable()
  .transform((t) => (t ? t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).join(', ') || null : null))
export const projectInput = z.object({ title: projectTitle, tools: projectTools })
export type ProjectInput = z.input<typeof projectInput>

/**
 * A student names their own capstone project (portal). Until the trainer approves it they may change it; after that it
 * is fixed. The database shows a student only their own registrations, so another student's cannot be reached.
 */
export async function submitMyProject(tx: Tx, actor: Actor, registrationId: string, raw: ProjectInput) {
  if (actor.role !== 'student' || !actor.personId) throw new Error('Forbidden: student portal')
  const input = projectInput.parse(raw)
  const [reg] = await tx.select({ id: registrations.id, branchId: registrations.branchId, personId: registrations.personId }).from(registrations).where(eq(registrations.id, uuid.parse(registrationId)))
  if (!reg || reg.personId !== actor.personId) throw new Error('Registration not found')
  const [cur] = await tx.select().from(assessments).where(and(eq(assessments.registrationId, reg.id), eq(assessments.kind, 'capstone'))).orderBy(sql`${assessments.createdAt} desc`).limit(1)
  if (cur?.approvedAt) throw new Error('Your project is already approved by your trainer. Ask your trainer to change it.')
  const [a] = cur
    ? await tx.update(assessments).set({ title: input.title, tools: input.tools }).where(eq(assessments.id, cur.id)).returning()
    : await tx.insert(assessments).values({ branchId: reg.branchId, registrationId: reg.id, kind: 'capstone', title: input.title, tools: input.tools, createdBy: actor.userId }).returning()
  await audit(tx, actor, { action: cur ? 'update' : 'create', entity: 'assessment', entityId: a.id, after: input })
  return a
}

/** Trainer sign-off on the capstone project (third certificate gate), with the title and tools as checked (and corrected). */
export async function approveCapstone(tx: Tx, actor: Actor, assessmentId: string, checked?: ProjectInput) {
  assertCan(actor, 'update', 'assessment')
  const [a] = await tx.select().from(assessments).where(eq(assessments.id, assessmentId)).for('update')
  if (!a) throw new Error('Assessment not found')
  if (a.kind !== 'capstone') throw new Error('Only a capstone project can be approved')
  if (a.approvedAt) return a
  // the certificate prints the title: one is needed, and not the placeholder
  const input = projectInput.parse(checked ?? { title: a.title, tools: a.tools })
  const [u] = await tx.update(assessments).set({ title: input.title, tools: input.tools, approvedBy: actor.userId, approvedAt: new Date() }).where(eq(assessments.id, a.id)).returning()
  await audit(tx, actor, { action: 'approve_capstone', entity: 'assessment', entityId: a.id, before: { title: a.title, tools: a.tools }, after: input })
  return u
}

export async function listBatches(tx: Tx, actor: Actor) {
  assertCan(actor, 'read', 'batch')
  const res = await tx.execute<{ id: string; name: string; department: string; course: string | null; trainer: string | null; timing: string | null; capacity: number | null; members: number; trainer_id: string | null; other_branch: string | null; trainer_label: string | null }>(sql`
    select b.id, b.name, d.name as department, c.title as course, u.name as trainer, b.trainer_id, b.timing, b.capacity,
      (select count(*)::int from batch_members m where m.batch_id = b.id) as members,
      -- a batch of another branch that this trainer took on, and a trainer of another branch on this branch's batch
      case when b.branch_id is distinct from coalesce(app_branch(), b.branch_id) then tr.branch_label end as other_branch, tr.trainer_label
    from batches b join departments d on d.id = b.department_id
    left join courses c on c.id = b.course_id left join users u on u.id = b.trainer_id
    left join lateral (select x.branch_label, x.trainer_label from trainer_requests x where x.batch_id = b.id and x.trainer_id = b.trainer_id and x.status = 'accepted' order by x.decided_at desc limit 1) tr on true
    where b.is_active order by b.created_at desc`)
  const all = res.rows.map((r) => ({ id: r.id, name: r.name, department: r.department, course: r.course, trainer: r.trainer_label ?? r.trainer, trainerId: r.trainer_id, timing: r.timing, capacity: r.capacity, members: r.members, otherBranch: r.other_branch }))
  return !can(actor, 'update', 'batch') ? all.filter((b) => b.trainerId === actor.userId) : all
}

export type RosterRow = { registrationId: string; regNo: string; name: string; pct: number; avgScore: number | null; graded: number; present: boolean | null; capstoneId: string | null; capstoneApproved: boolean
  /** the project's title and tools as the student (or trainer) gave them */
  capstoneTitle: string | null; capstoneTools: string | null }

/** Roster of a batch, with the given day's attendance (if a session exists) and capstone state. */
export async function batchRoster(tx: Tx, actor: Actor, batchId: string, date?: string): Promise<{ sessionId: string | null; rows: RosterRow[] }> {
  assertCan(actor, 'read', 'batch')
  const d = date ? isoDate.parse(date) : null
  const [session] = d ? await tx.select().from(classSessions).where(and(eq(classSessions.batchId, batchId), eq(classSessions.sessionDate, d))) : []
  const res = await tx.execute<{ registration_id: string; reg_no: string; name: string; pct: number; avg_score: number | null; graded: number; present: boolean | null; capstone_id: string | null; capstone_approved: boolean | null; capstone_title: string | null; capstone_tools: string | null }>(sql`
    select m.registration_id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, a.pct, sc.avg_score, coalesce(sc.graded, 0) as graded,
      (select t.present from attendance t where t.session_id = ${session?.id ?? null}::uuid and t.registration_id = r.id) as present,
      cap.id as capstone_id, (cap.approved_at is not null) as capstone_approved, cap.title as capstone_title, cap.tools as capstone_tools
    from batch_members m join registrations r on r.id = m.registration_id join persons p on p.id = r.person_id
    join v_attendance_pct a on a.registration_id = r.id
    left join lateral (select round(100.0 * avg(g.score::numeric / g.max_score))::int as avg_score, count(*)::int as graded from assessments g where g.registration_id = r.id and g.kind <> 'capstone' and g.max_score > 0) sc on true
    left join lateral (select x.id, x.approved_at, x.title, x.tools from assessments x where x.registration_id = r.id and x.kind = 'capstone' order by x.created_at desc limit 1) cap on true
    where m.batch_id = ${batchId} order by name`)
  return {
    sessionId: session?.id ?? null,
    rows: res.rows.map((r) => ({ registrationId: r.registration_id, regNo: r.reg_no, name: r.name, pct: r.pct, avgScore: r.avg_score, graded: r.graded, present: r.present, capstoneId: r.capstone_id, capstoneApproved: !!r.capstone_approved, capstoneTitle: r.capstone_title, capstoneTools: r.capstone_tools })),
  }
}

export async function listTrainers(tx: Tx) {
  const res = await tx.execute<{ id: string; name: string }>(sql`
    -- trainers: whoever holds a role with "teaching:read" (the Trainer role, or any role head office gives it to)
    select u.id, u.name from users u
    where exists (select 1 from user_roles ur join roles ro on ro.key = ur.role where ur.user_id = u.id and 'teaching:read' = any(ro.permissions)) and u.is_active and u.deleted_at is null order by u.name`)
  return res.rows
}

// ---- Timetable ------------------------------------------------------------------------------------

export type TimetableEntry = {
  batchId: string; name: string; course: string; trainer: string | null; room: string | null
  days: number[]; start: string | null; end: string | null; timing: string | null; members: number
}

const toEntry = (r: { id: string; name: string; course: string; trainer: string | null; room: string | null; days: number[] | null; start_time: string | null; end_time: string | null; timing: string | null; members: number }): TimetableEntry => ({
  batchId: r.id, name: r.name, course: r.course, trainer: r.trainer, room: r.room, days: r.days ?? [],
  start: r.start_time?.slice(0, 5) ?? null, end: r.end_time?.slice(0, 5) ?? null, timing: r.timing, members: Number(r.members),
})

/** The branch's weekly timetable. A trainer sees only their own batches. */
export async function timetable(tx: Tx, actor: Actor): Promise<TimetableEntry[]> {
  assertCan(actor, 'read', 'batch')
  const own = !can(actor, 'update', 'batch')
  const res = await tx.execute<Parameters<typeof toEntry>[0]>(sql`
    select b.id, b.name, coalesce(c.title, d.name) as course, u.name as trainer, b.room, b.days, b.start_time::text, b.end_time::text, b.timing,
      (select count(*)::int from batch_members m where m.batch_id = b.id) as members
    from batches b join departments d on d.id = b.department_id left join courses c on c.id = b.course_id left join users u on u.id = b.trainer_id
    where b.is_active and (${!own} or b.trainer_id = ${actor.userId})
    order by b.start_time nulls last, b.name`)
  return res.rows.map(toEntry)
}

/** A student's own classes. No filter here on purpose: RLS only returns batches they belong to. */
export async function myClasses(tx: Tx, actor: Actor): Promise<TimetableEntry[]> {
  if (actor.role !== 'student') throw new Error('Forbidden: student timetable')
  const res = await tx.execute<Parameters<typeof toEntry>[0]>(sql`
    select b.id, b.name, coalesce(c.title, d.name) as course, null as trainer, b.room, b.days, b.start_time::text, b.end_time::text, b.timing, 0 as members
    from batches b join departments d on d.id = b.department_id left join courses c on c.id = b.course_id
    where b.is_active order by b.start_time nulls last, b.name`)
  return res.rows.map(toEntry)
}

export type AttendanceDay = { date: string; present: boolean | null; batch: string; trainer: string | null; topic: string | null; markedBy: string | null }
export type StudentAttendance = {
  name: string; regNo: string; month: string
  /** The student's batches (set by the academic manager) and who teaches them. */
  batches: { name: string; trainer: string | null; days: number[] | null; time: string | null }[]
  /** Each class day of the month: marked present / absent by the trainer, or null = a class day not marked yet. */
  days: AttendanceDay[]
  total: { sessions: number; present: number; pct: number }
}

/** One student's attendance in a month (YYYY-MM): every marked session, plus their batches' class days not marked yet. */
export async function studentAttendance(tx: Tx, actor: Actor, registrationId: string, month: string): Promise<StudentAttendance | null> {
  assertCan(actor, 'read', 'attendance')
  const id = uuid.parse(registrationId)
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthIST()
  const [who] = (await tx.execute<{ name: string; reg_no: string; start: string }>(sql`
    select trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, r.reg_no, coalesce(r.joining_date, r.enrollment_date)::text as start
    from registrations r join persons p on p.id = r.person_id where r.id = ${id}`)).rows
  if (!who) return null
  const bs = (await tx.execute<{ id: string; name: string; trainer: string | null; days: number[] | null; start_time: string | null; end_time: string | null; joined: string; start_date: string | null }>(sql`
    select b.id, b.name, u.name as trainer, b.days, to_char(b.start_time, 'HH24:MI') as start_time, to_char(b.end_time, 'HH24:MI') as end_time,
      m.joined_at::date::text as joined, b.start_date::text as start_date
    from batch_members m join batches b on b.id = m.batch_id left join users u on u.id = b.trainer_id
    where m.registration_id = ${id} order by b.name`)).rows
  const marks = (await tx.execute<{ date: string; present: boolean; batch: string; trainer: string | null; topic: string | null; marked_by: string | null }>(sql`
    select s.session_date::text as date, a.present, b.name as batch, u.name as trainer, s.topic, mb.name as marked_by
    from attendance a join class_sessions s on s.id = a.session_id join batches b on b.id = s.batch_id
    left join users u on u.id = b.trainer_id left join users mb on mb.id = a.marked_by
    where a.registration_id = ${id} and s.session_date >= ${m + '-01'}::date and s.session_date < ${m + '-01'}::date + interval '1 month'
    order by s.session_date`)).rows
  const [t] = (await tx.execute<{ sessions: number; present: number; pct: number }>(sql`
    select count(*)::int as sessions, count(*) filter (where a.present)::int as present,
      coalesce(round(100.0 * count(*) filter (where a.present) / nullif(count(*), 0)), 0)::int as pct
    from attendance a where a.registration_id = ${id}`)).rows
  const days: AttendanceDay[] = marks.map((r) => ({ date: r.date, present: r.present, batch: r.batch, trainer: r.trainer, topic: r.topic, markedBy: r.marked_by }))
  // class days of the student's batches (up to today) that the trainer has not marked yet
  const today = todayIST()
  const [y, mo] = m.split('-').map(Number)
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  for (const b of bs) {
    if (!b.days?.length) continue
    const from = [who.start, b.joined, b.start_date].filter(Boolean).sort().at(-1)!
    for (let d = 1; d <= last; d++) {
      const iso = `${m}-${String(d).padStart(2, '0')}`
      const wd = ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1 // ISO weekday
      if (iso < from || iso > today || !b.days.includes(wd) || days.some((x) => x.date === iso && x.batch === b.name)) continue
      days.push({ date: iso, present: null, batch: b.name, trainer: b.trainer, topic: null, markedBy: null })
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date))
  return {
    name: who.name, regNo: who.reg_no, month: m,
    batches: bs.map((b) => ({ name: b.name, trainer: b.trainer, days: b.days, time: b.start_time && b.end_time ? `${b.start_time}–${b.end_time}` : null })),
    days, total: { sessions: Number(t?.sessions ?? 0), present: Number(t?.present ?? 0), pct: Number(t?.pct ?? 0) },
  }
}
