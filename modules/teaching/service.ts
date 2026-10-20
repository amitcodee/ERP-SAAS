// Teaching: a course's syllabus, the topics each batch has covered (ticked by the trainer with the day's
// attendance), tests and their marks (with an answer-sheet photo), notes shared with students or other trainers, the
// trainer's class calendar, and the project / study help students ask of every trainer.
// Who may do what: the syllabus — head office, a branch manager or anyone who edits courses (academic manager);
// a batch's teaching — its trainer, or whoever manages the branch's batches.
import { createHash } from 'crypto'
import { sql } from 'drizzle-orm'
import { nextOrgNo } from '@/lib/numbering'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { can } from '@/lib/auth/permissions'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { MAX_DOC_BYTES, sniffMime } from '@/modules/documents/service'
import { monthIST } from '@/lib/ist'
import { mailButton } from '@/lib/notify/layout'
import { fillTemplate, resolveTemplate } from '@/modules/templates/service'

const uuid = z.string().uuid()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const isStudent = (a: Actor) => a.role === 'student'

/** Who sets a course's syllabus: whoever approves it (head office), adds courses (a branch manager) or edits them (the academic manager). */
export const canEditSyllabus = (a: Actor) => !isStudent(a) && (can(a, 'approve', 'teaching') || can(a, 'create', 'catalog') || can(a, 'update', 'catalog'))
/** Who teaches: a trainer (their batches), or whoever manages batches. */
export const canTeach = (a: Actor) => !isStudent(a) && can(a, 'create', 'teaching')

// ---- syllabus

export type Topic = { id: string; module: string | null; title: string; details: string | null; sort: number }
export type SyllabusChange = {
  id: string; by: string | null; branch: string | null; at: string; mine: boolean
  /** the whole proposed list (null: the topics are not changed) */
  topics: { id: string | null; module: string | null; title: string; details: string | null }[] | null
  file: { action: 'replace' | 'remove'; name: string | null } | null
}
export type Syllabus = { courseId: string; topics: Topic[]; file: { name: string; size: number; at: string } | null; pending: SyllabusChange | null; headOffice: boolean }

/** Whoever approves syllabus changes (head office by default); their own edits apply at once. */
export const approvesSyllabus = (a: Actor) => !isStudent(a) && can(a, 'approve', 'teaching')

export async function courseSyllabus(tx: Tx, courseId: string, actor?: Actor): Promise<Syllabus> {
  const id = uuid.parse(courseId)
  const topics = (await tx.execute<{ id: string; module: string | null; title: string; details: string | null; sort_order: number }>(sql`
    select id, module, title, details, sort_order from course_topics where course_id = ${id} order by sort_order, created_at`)).rows
  const [f] = (await tx.execute<{ file_name: string; size_bytes: number; uploaded_at: string }>(sql`
    select file_name, size_bytes, uploaded_at from course_syllabus_files where course_id = ${id}`)).rows
  return {
    courseId: id, topics: topics.map((t) => ({ id: t.id, module: t.module, title: t.title, details: t.details, sort: t.sort_order })),
    file: f ? { name: f.file_name, size: f.size_bytes, at: new Date(f.uploaded_at).toISOString() } : null,
    pending: actor && !isStudent(actor) ? await pendingChange(id, actor) : null, headOffice: !!actor && approvesSyllabus(actor),
  }
}

/** The change waiting for a course, with who proposed it and from where (names across branches: the server's own connection). */
async function pendingChange(courseId: string, actor: Actor): Promise<SyllabusChange | null> {
  const [c] = await withOrgSystem(actor.orgId, async (sys) => (await sys.execute<{ id: string; topics: SyllabusChange['topics']; file_action: 'replace' | 'remove' | null; file_name: string | null; proposed_by: string | null; by: string | null; branch: string | null; updated_at: string }>(sql`
    select s.id, s.topics, s.file_action, s.file_name, s.proposed_by, u.name as by, b.name as branch, s.updated_at
    from syllabus_changes s left join users u on u.id = s.proposed_by left join branches b on b.id = s.branch_id
    where s.course_id = ${courseId} and s.status = 'pending'`)).rows)
  return c ? { id: c.id, by: c.by, branch: c.branch, at: new Date(c.updated_at).toISOString(), mine: c.proposed_by === actor.userId, topics: c.topics, file: c.file_action ? { action: c.file_action, name: c.file_name } : null } : null
}

const topicInput = z.object({
  id: uuid.optional().nullable(),
  module: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(120).nullable()),
  title: z.string().trim().min(2, 'Every topic needs a title').max(200),
  details: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(1000).nullable()),
})
export type TopicInput = { id?: string | null; module?: string | null; title: string; details?: string | null }

/** Puts a topic list live, in this order. Topics kept keep their id (so batches' ticks stay); removed ones go. */
async function applyTopics(tx: Tx, actor: Actor, courseId: string, list: z.infer<typeof topicInput>[]) {
  const live = (await tx.execute<{ id: string }>(sql`select id from course_topics where course_id = ${courseId}`)).rows.map((r) => r.id)
  const keep = list.map((t) => t.id).filter((x): x is string => !!x && live.includes(x))
  await tx.execute(sql`delete from course_topics where course_id = ${courseId} ${keep.length ? sql`and id not in (${sql.join(keep.map((k) => sql`${k}::uuid`), sql`, `)})` : sql``}`)
  for (const [i, t] of list.entries()) {
    // a topic removed meanwhile (another change approved) comes back as a new one
    if (t.id && keep.includes(t.id)) await tx.execute(sql`update course_topics set module = ${t.module}, title = ${t.title}, details = ${t.details}, sort_order = ${i} where id = ${t.id} and course_id = ${courseId}`)
    else await tx.execute(sql`insert into course_topics (course_id, module, title, details, sort_order, created_by) values (${courseId}, ${t.module}, ${t.title}, ${t.details}, ${i}, ${actor.userId})`)
  }
}

/** The change waiting for this course, to add to: the author's own; someone else's blocks a second one. */
async function myPending(tx: Tx, actor: Actor, courseId: string) {
  // read, not locked: only its author may change a pending change (the one-pending-per-course index guards a race)
  const [c] = (await tx.execute<{ id: string; proposed_by: string | null }>(sql`select id, proposed_by from syllabus_changes where course_id = ${courseId} and status = 'pending'`)).rows
  if (c && c.proposed_by !== actor.userId) throw new Error('Another change to this syllabus is waiting for head office. It must be approved or turned down first.')
  return c?.id ?? null
}

/**
 * Saves the whole topic list. Head office: live at once, for every branch. Anyone else who may edit the syllabus:
 * a change waiting for head office's approval (their own waiting change is updated).
 */
export async function saveSyllabus(tx: Tx, actor: Actor, courseId: string, raw: TopicInput[]) {
  if (!canEditSyllabus(actor)) throw new Error('Only head office, a branch manager or the academic manager sets the syllabus')
  const id = uuid.parse(courseId)
  const list = z.array(topicInput).max(300, 'At most 300 topics').parse(raw)
  const [c] = (await tx.execute<{ id: string }>(sql`select id from courses where id = ${id}`)).rows
  if (!c) throw new Error('Course not found')
  if (approvesSyllabus(actor)) {
    await applyTopics(tx, actor, id, list)
    await audit(tx, actor, { action: 'set_syllabus', entity: 'course', entityId: id, after: { topics: list.length } })
    return { pending: false, topics: list.length }
  }
  const mine = await myPending(tx, actor, id)
  if (mine) await tx.execute(sql`update syllabus_changes set topics = ${JSON.stringify(list)}::jsonb, updated_at = now() where id = ${mine}`)
  else await tx.execute(sql`insert into syllabus_changes (course_id, branch_id, topics, proposed_by) values (${id}, ${actor.branchId ?? null}, ${JSON.stringify(list)}::jsonb, ${actor.userId})`)
  await audit(tx, actor, { action: 'propose_syllabus', entity: 'course', entityId: id, after: { topics: list.length } })
  return { pending: true, topics: list.length }
}

function checkFile(file: { fileName: string; bytes: Buffer }) {
  if (!file.bytes.length) throw new Error('The file is empty')
  if (file.bytes.length > 10 * 1024 * 1024) throw new Error('The syllabus file must be 10 MB or smaller')
  const mime = sniffMime(file.bytes)
  if (!mime) throw new Error('Upload the syllabus as a PDF or a picture')
  return { mime, name: (file.fileName.trim() || 'syllabus').slice(0, 200).replace(/[\/\r\n"]/g, '_') }
}
async function applyFile(tx: Tx, actor: Actor, courseId: string, file: { name: string; mime: string; bytes: Buffer } | null) {
  if (!file) { await tx.execute(sql`delete from course_syllabus_files where course_id = ${courseId}`); return }
  await tx.execute(sql`
    insert into course_syllabus_files (course_id, file_name, mime, size_bytes, data, uploaded_by) values (${courseId}, ${file.name}, ${file.mime}, ${file.bytes.length}, ${file.bytes}, ${actor.userId})
    on conflict (course_id) do update set file_name = excluded.file_name, mime = excluded.mime, size_bytes = excluded.size_bytes, data = excluded.data, uploaded_by = excluded.uploaded_by, uploaded_at = now()`)
}

/** The syllabus file (or its removal, with null): live at once for head office, otherwise part of the waiting change. */
export async function setSyllabusFile(tx: Tx, actor: Actor, courseId: string, file: { fileName: string; bytes: Buffer } | null) {
  if (!canEditSyllabus(actor)) throw new Error('Only head office, a branch manager or the academic manager sets the syllabus')
  const id = uuid.parse(courseId)
  const f = file ? checkFile(file) : null
  if (approvesSyllabus(actor)) {
    await applyFile(tx, actor, id, f && file ? { ...f, bytes: file.bytes } : null)
    await audit(tx, actor, { action: 'syllabus_file', entity: 'course', entityId: id, after: { name: f?.name ?? null } })
    return { pending: false }
  }
  const mine = await myPending(tx, actor, id)
  const fa = f && file ? 'replace' : 'remove', fn = f?.name ?? null, fm = f?.mime ?? null, fs = file?.bytes.length ?? null, fd = f && file ? file.bytes : null
  if (mine) await tx.execute(sql`update syllabus_changes set file_action = ${fa}, file_name = ${fn}, mime = ${fm}, size_bytes = ${fs}, data = ${fd}, updated_at = now() where id = ${mine}`)
  else await tx.execute(sql`insert into syllabus_changes (course_id, branch_id, file_action, file_name, mime, size_bytes, data, proposed_by) values (${id}, ${actor.branchId ?? null}, ${fa}, ${fn}, ${fm}, ${fs}, ${fd}, ${actor.userId})`)
  await audit(tx, actor, { action: 'propose_syllabus_file', entity: 'course', entityId: id, after: { name: fn } })
  return { pending: true }
}

export type SyllabusChangeRow = { id: string; courseId: string; course: string; by: string | null; branch: string | null; at: string; topics: number | null; file: 'replace' | 'remove' | null }

/** Head office: the syllabus changes waiting for approval, from every branch. */
export async function listSyllabusChanges(tx: Tx, actor: Actor): Promise<SyllabusChangeRow[]> {
  if (!approvesSyllabus(actor)) return []
  const rows = (await tx.execute<{ id: string; course_id: string; course: string; by: string | null; branch: string | null; updated_at: string; n: number | null; file_action: 'replace' | 'remove' | null }>(sql`
    select s.id, s.course_id, c.title as course, u.name as by, b.name as branch, s.updated_at, jsonb_array_length(s.topics) as n, s.file_action
    from syllabus_changes s join courses c on c.id = s.course_id left join users u on u.id = s.proposed_by left join branches b on b.id = s.branch_id
    where s.status = 'pending' order by s.updated_at`)).rows
  return rows.map((r) => ({ id: r.id, courseId: r.course_id, course: r.course, by: r.by, branch: r.branch, at: new Date(r.updated_at).toISOString(), topics: r.n, file: r.file_action }))
}

/** Head office approves (the change goes live for every branch) or turns it down with a reason; the author may withdraw it. */
export async function decideSyllabusChange(tx: Tx, actor: Actor, changeId: string, approve: boolean, note: string | null) {
  const [c] = (await tx.execute<{ id: string; course_id: string; status: string; proposed_by: string | null; topics: unknown; file_action: string | null; file_name: string | null; mime: string | null; data: Buffer | null }>(sql`
    select id, course_id, status, proposed_by, topics, file_action, file_name, mime, data from syllabus_changes where id = ${uuid.parse(changeId)}`)).rows
  if (!c) throw new Error('Change not found')
  // locked only once allowed: only head office (or the author withdrawing) may change it, and a lock needs that right
  if (approvesSyllabus(actor) || (!approve && c.proposed_by === actor.userId)) await tx.execute(sql`select 1 from syllabus_changes where id = ${c.id} for update`)
  if (c.status !== 'pending') throw new Error(`This change is already ${c.status}`)
  const withdraw = !approve && !approvesSyllabus(actor) && c.proposed_by === actor.userId
  if (!approvesSyllabus(actor) && !withdraw) throw new Error('Only head office approves syllabus changes')
  const why = note?.trim().slice(0, 500) || null
  if (!approve && !withdraw && !why) throw new Error('Say why the change is turned down')
  if (approve) {
    if (c.topics) await applyTopics(tx, actor, c.course_id, z.array(topicInput).parse(c.topics))
    if (c.file_action === 'remove') await applyFile(tx, actor, c.course_id, null)
    if (c.file_action === 'replace' && c.data) await applyFile(tx, actor, c.course_id, { name: c.file_name ?? 'syllabus', mime: c.mime ?? 'application/pdf', bytes: c.data })
  }
  const status = approve ? 'approved' : withdraw ? 'withdrawn' : 'rejected'
  await tx.execute(sql`update syllabus_changes set status = ${status}, decided_by = ${actor.userId}, decided_at = now(), decision_note = ${why} where id = ${c.id}`)
  await audit(tx, actor, { action: `syllabus_${status}`, entity: 'course', entityId: c.course_id, after: { changeId: c.id, note: why } })
  return { status }
}

export async function syllabusFile(tx: Tx, courseId: string) {
  if (!uuid.safeParse(courseId).success) return null
  const [f] = (await tx.execute<{ file_name: string; mime: string; data: Buffer }>(sql`select file_name, mime, data from course_syllabus_files where course_id = ${courseId}`)).rows
  return f ?? null
}

// ---- a batch's teaching

type BatchRef = { id: string; branch_id: string; course_id: string | null; trainer_id: string | null; name: string }
async function teachBatch(tx: Tx, actor: Actor, batchId: string): Promise<BatchRef> {
  if (!canTeach(actor)) throw new Error('Forbidden: teaching')
  const [b] = (await tx.execute<BatchRef>(sql`select id, branch_id, course_id, trainer_id, name from batches where id = ${uuid.parse(batchId)}`)).rows
  if (!b) throw new Error('Batch not found')
  if (!can(actor, 'update', 'batch') && b.trainer_id !== actor.userId) throw new Error('Forbidden: this is not your batch')
  return b
}

export type BatchTopic = Topic & { coveredOn: string | null }
export type TestRow = { id: string; title: string; date: string; maxScore: number; marks: { registrationId: string; score: number | null; sheetDocId: string | null }[] }
export type NoteRow = { id: string; title: string; body: string | null; url: string | null; fileName: string | null; size: number | null; batch: string | null; batchId: string | null; shareStudents: boolean; shareTrainers: boolean; by: string | null; mine: boolean; at: string }

/** The batch's syllabus with what is covered (and when), its tests with every student's marks. */
export async function batchTeaching(tx: Tx, actor: Actor, batchId: string) {
  const b = await teachBatch(tx, actor, batchId)
  const topics = b.course_id ? (await tx.execute<{ id: string; module: string | null; title: string; details: string | null; sort_order: number; covered_on: string | null }>(sql`
    select t.id, t.module, t.title, t.details, t.sort_order, bt.covered_on::text from course_topics t left join batch_topics bt on bt.topic_id = t.id and bt.batch_id = ${b.id}
    where t.course_id = ${b.course_id} order by t.sort_order, t.created_at`)).rows : []
  const tests = (await tx.execute<{ id: string; title: string; test_date: string; max_score: number }>(sql`select id, title, test_date::text, max_score from tests where batch_id = ${b.id} order by test_date desc, created_at desc`)).rows
  const marks = tests.length ? (await tx.execute<{ test_id: string; registration_id: string; score: number | null; sheet_doc_id: string | null }>(sql`
    select test_id, registration_id, score, sheet_doc_id from assessments where test_id in (${sql.join(tests.map((t) => sql`${t.id}::uuid`), sql`, `)})`)).rows : []
  const file = b.course_id ? (await tx.execute<{ file_name: string }>(sql`select file_name from course_syllabus_files where course_id = ${b.course_id}`)).rows[0] : null
  return {
    courseId: b.course_id, syllabusFile: file?.file_name ?? null,
    topics: topics.map((t) => ({ id: t.id, module: t.module, title: t.title, details: t.details, sort: t.sort_order, coveredOn: t.covered_on })) as BatchTopic[],
    tests: tests.map((t) => ({ id: t.id, title: t.title, date: t.test_date, maxScore: t.max_score, marks: marks.filter((m) => m.test_id === t.id).map((m) => ({ registrationId: m.registration_id, score: m.score, sheetDocId: m.sheet_doc_id })) })) as TestRow[],
  }
}

/** The day's class: its session (made if needed), the topics taught ticked off the syllabus, and the topic line. */
export async function setDayTopics(tx: Tx, actor: Actor, batchId: string, date: string, topicIds: string[], extra?: string | null) {
  const b = await teachBatch(tx, actor, batchId)
  const d = isoDate.parse(date)
  const ids = z.array(uuid).max(50).parse(topicIds)
  const titles = ids.length ? (await tx.execute<{ id: string; title: string }>(sql`select id, title from course_topics where course_id = ${b.course_id}::uuid and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows : []
  if (titles.length !== ids.length) throw new Error('A topic is not in this course’s syllabus')
  const line = [...titles.map((t) => t.title), extra?.trim()].filter(Boolean).join(' · ').slice(0, 500) || null
  const [s] = (await tx.execute<{ id: string }>(sql`
    insert into class_sessions (batch_id, branch_id, session_date, topic, created_by) values (${b.id}, ${b.branch_id}, ${d}, ${line}, ${actor.userId})
    on conflict (batch_id, session_date) do update set topic = excluded.topic returning id`)).rows
  // the day's ticks: what was ticked for this day before and is no longer ticked is un-ticked
  await tx.execute(sql`delete from batch_topics where batch_id = ${b.id} and covered_on = ${d} ${ids.length ? sql`and topic_id not in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``}`)
  for (const t of ids) {
    await tx.execute(sql`
      insert into batch_topics (batch_id, topic_id, branch_id, session_id, covered_on, marked_by) values (${b.id}, ${t}, ${b.branch_id}, ${s.id}, ${d}, ${actor.userId})
      on conflict (batch_id, topic_id) do update set covered_on = excluded.covered_on, session_id = excluded.session_id, marked_by = excluded.marked_by`)
  }
  return s.id
}

/** Ticks one topic on or off without a class (catching up the record). */
export async function setTopicCovered(tx: Tx, actor: Actor, batchId: string, topicId: string, coveredOn: string | null) {
  const b = await teachBatch(tx, actor, batchId)
  if (!coveredOn) { await tx.execute(sql`delete from batch_topics where batch_id = ${b.id} and topic_id = ${uuid.parse(topicId)}`); return }
  await tx.execute(sql`
    insert into batch_topics (batch_id, topic_id, branch_id, covered_on, marked_by) select ${b.id}, t.id, ${b.branch_id}, ${isoDate.parse(coveredOn)}, ${actor.userId} from course_topics t where t.id = ${uuid.parse(topicId)} and t.course_id = ${b.course_id}::uuid
    on conflict (batch_id, topic_id) do update set covered_on = excluded.covered_on, marked_by = excluded.marked_by`)
}

const testInput = z.object({ title: z.string().trim().min(2, 'Give the test a title').max(150), date: isoDate, maxScore: z.number().int().min(1, 'Total marks must be at least 1').max(1000) })
export type TestInput = z.input<typeof testInput>

export async function createTest(tx: Tx, actor: Actor, batchId: string, raw: TestInput) {
  if (!can(actor, 'create', 'assessment')) throw new Error('Forbidden: grades')
  const b = await teachBatch(tx, actor, batchId)
  const v = testInput.parse(raw)
  const [t] = (await tx.execute<{ id: string }>(sql`insert into tests (branch_id, batch_id, title, test_date, max_score, created_by) values (${b.branch_id}, ${b.id}, ${v.title}, ${v.date}, ${v.maxScore}, ${actor.userId}) returning id`)).rows
  await audit(tx, actor, { action: 'create_test', entity: 'batch', entityId: b.id, after: v })
  return t
}

async function testOf(tx: Tx, actor: Actor, testId: string) {
  if (!can(actor, 'create', 'assessment')) throw new Error('Forbidden: grades')
  const [t] = (await tx.execute<{ id: string; batch_id: string; title: string; max_score: number; branch_id: string }>(sql`select id, batch_id, title, max_score, branch_id from tests where id = ${uuid.parse(testId)}`)).rows
  if (!t) throw new Error('Test not found')
  await teachBatch(tx, actor, t.batch_id)
  return t
}

/** Marks obtained per student (empty = not marked yet). Each is the student's grade for this test. */
export async function saveTestMarks(tx: Tx, actor: Actor, testId: string, rows: { registrationId: string; score: number | null }[]) {
  const t = await testOf(tx, actor, testId)
  const members = new Set((await tx.execute<{ registration_id: string }>(sql`select registration_id from batch_members where batch_id = ${t.batch_id}`)).rows.map((r) => r.registration_id))
  for (const r of rows) {
    if (!members.has(r.registrationId)) throw new Error('Marks can only be given to students of this batch')
    if (r.score == null) {
      // marks cleared: the row goes, unless it holds an answer sheet (that stays, without a score)
      await tx.execute(sql`delete from assessments where test_id = ${t.id} and registration_id = ${r.registrationId} and sheet_doc_id is null`)
      await tx.execute(sql`update assessments set score = null where test_id = ${t.id} and registration_id = ${r.registrationId}`)
      continue
    }
    if (!Number.isInteger(r.score) || r.score < 0 || r.score > t.max_score) throw new Error(`Marks must be between 0 and ${t.max_score}`)
    await tx.execute(sql`
      insert into assessments (branch_id, registration_id, kind, title, score, max_score, test_id, created_by) values (${t.branch_id}, ${r.registrationId}, 'test', ${t.title}, ${r.score}, ${t.max_score}, ${t.id}, ${actor.userId})
      on conflict (test_id, registration_id) where test_id is not null do update set score = excluded.score, max_score = excluded.max_score, title = excluded.title`)
  }
  await audit(tx, actor, { action: 'test_marks', entity: 'test', entityId: t.id, after: { count: rows.length } })
}

/** A photo or PDF of the student's answer sheet, kept with their documents and linked to the test's grade. */
export async function uploadAnswerSheet(tx: Tx, actor: Actor, testId: string, registrationId: string, file: { fileName: string; bytes: Buffer }) {
  const t = await testOf(tx, actor, testId)
  const [m] = (await tx.execute(sql`select 1 from batch_members where batch_id = ${t.batch_id} and registration_id = ${uuid.parse(registrationId)}`)).rows
  if (!m) throw new Error('This student is not in the batch')
  if (!file.bytes.length) throw new Error('The file is empty')
  if (file.bytes.length > MAX_DOC_BYTES) throw new Error('Files must be 5 MB or smaller')
  const mime = sniffMime(file.bytes)
  if (!mime) throw new Error('Upload a picture (JPG, PNG, WebP) or a PDF')
  const [reg] = (await tx.execute<{ branch_id: string }>(sql`select branch_id from registrations where id = ${registrationId}`)).rows
  const [doc] = (await tx.execute<{ id: string }>(sql`
    insert into registration_documents (branch_id, registration_id, kind, file_name, mime, size_bytes, sha256, data, uploaded_by)
    values (${reg.branch_id}, ${registrationId}, 'answer_sheet', ${(file.fileName.trim() || 'answer-sheet').slice(0, 200).replace(/[\/\r\n"]/g, '_')}, ${mime}, ${file.bytes.length}, ${createHash('sha256').update(file.bytes).digest('hex')}, ${file.bytes}, ${actor.userId}) returning id`)).rows
  await tx.execute(sql`
    insert into assessments (branch_id, registration_id, kind, title, score, max_score, test_id, sheet_doc_id, created_by) values (${t.branch_id}, ${registrationId}, 'test', ${t.title}, null, ${t.max_score}, ${t.id}, ${doc.id}, ${actor.userId})
    on conflict (test_id, registration_id) where test_id is not null do update set sheet_doc_id = excluded.sheet_doc_id`)
  return doc.id
}

export async function deleteTest(tx: Tx, actor: Actor, testId: string) {
  const t = await testOf(tx, actor, testId)
  await tx.execute(sql`delete from tests where id = ${t.id}`)
  await audit(tx, actor, { action: 'delete_test', entity: 'test', entityId: t.id, after: { title: t.title } })
}

// ---- notes

const noteInput = z.object({
  batchId: uuid.nullable().optional(),
  title: z.string().trim().min(2, 'Give the note a title').max(150),
  body: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(5000).nullable()),
  url: z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().url('The link must start with http:// or https://').max(1000).refine((u) => /^https?:\/\//i.test(u), 'The link must start with http:// or https://').nullable()),
  shareStudents: z.boolean(),
  shareTrainers: z.boolean(),
})
export type NoteInput = z.input<typeof noteInput>

export async function createNote(tx: Tx, actor: Actor, raw: NoteInput, file?: { fileName: string; bytes: Buffer } | null) {
  if (!canTeach(actor)) throw new Error('Forbidden: notes')
  const v = noteInput.parse(raw)
  if (!v.url && !v.body && !file) throw new Error('Add a link, some text or a file')
  if (v.shareStudents && !v.batchId) throw new Error('Pick the batch whose students get this note')
  const b = v.batchId ? await teachBatch(tx, actor, v.batchId) : null
  const branchId = b?.branch_id ?? actor.branchId
  if (!branchId) throw new Error('Pick the branch first (top left)')
  let f: { name: string; mime: string; bytes: Buffer } | null = null
  if (file && file.bytes.length) {
    if (file.bytes.length > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller')
    const mime = sniffMime(file.bytes)
    if (!mime) throw new Error('Upload a PDF or a picture (JPG, PNG, WebP); for other files share a link')
    f = { name: (file.fileName.trim() || 'notes').slice(0, 200).replace(/[\/\r\n"]/g, '_'), mime, bytes: file.bytes }
  }
  const [n] = (await tx.execute<{ id: string }>(sql`
    insert into notes (branch_id, batch_id, course_id, title, body, url, file_name, mime, size_bytes, data, share_students, share_trainers, created_by)
    values (${branchId}, ${b?.id ?? null}, ${b?.course_id ?? null}, ${v.title}, ${v.body}, ${v.url}, ${f?.name ?? null}, ${f?.mime ?? null}, ${f?.bytes.length ?? null}, ${f?.bytes ?? null}, ${v.shareStudents}, ${v.shareTrainers}, ${actor.userId}) returning id`)).rows
  await audit(tx, actor, { action: 'create', entity: 'note', entityId: n.id, after: { title: v.title, batchId: b?.id ?? null } })
  return n
}

/** Staff: their own notes, their batches', and every note shared with trainers. A student: their batches' (RLS). */
export async function listNotes(tx: Tx, actor: Actor, batchId?: string | null): Promise<NoteRow[]> {
  const rows = (await tx.execute<{ id: string; title: string; body: string | null; url: string | null; file_name: string | null; size_bytes: number | null; batch: string | null; batch_id: string | null; share_students: boolean; share_trainers: boolean; by: string | null; created_by: string; created_at: string }>(sql`
    select n.id, n.title, n.body, n.url, n.file_name, n.size_bytes, b.name as batch, n.batch_id, n.share_students, n.share_trainers, u.name as by, n.created_by, n.created_at
    from notes n left join batches b on b.id = n.batch_id left join users u on u.id = n.created_by
    where n.deleted_at is null ${batchId ? sql`and n.batch_id = ${uuid.parse(batchId)}` : sql``}
    order by n.created_at desc limit 300`)).rows
  return rows.map((n) => ({ id: n.id, title: n.title, body: n.body, url: n.url, fileName: n.file_name, size: n.size_bytes, batch: n.batch, batchId: n.batch_id, shareStudents: n.share_students, shareTrainers: n.share_trainers, by: n.by, mine: n.created_by === actor.userId, at: new Date(n.created_at).toISOString() }))
}

export async function deleteNote(tx: Tx, actor: Actor, id: string) {
  const [n] = (await tx.execute<{ id: string }>(sql`update notes set deleted_at = now() where id = ${uuid.parse(id)} and deleted_at is null and (created_by = ${actor.userId} or ${approvesSyllabus(actor)}) returning id`)).rows
  if (!n) throw new Error('Only who shared a note removes it')
}

export async function noteFile(tx: Tx, id: string) {
  if (!uuid.safeParse(id).success) return null
  const [f] = (await tx.execute<{ file_name: string; mime: string; data: Buffer }>(sql`select file_name, mime, data from notes where id = ${id} and data is not null and deleted_at is null`)).rows
  return f ?? null
}

// ---- the trainer's calendar

/** One entry on the teaching calendar: a class held, a class still to come (from the batch's days), or a test. */
export type CalendarDay = { kind: 'class' | 'planned' | 'test'; date: string; batch: string; batchId: string; topic: string | null; present: number; marked: number; members: number; time: string | null; maxScore?: number; graded?: number }
/** The month across the trainer's batches (or the branch's, for a manager): classes held, classes coming up, tests. */
export async function teachingCalendar(tx: Tx, actor: Actor, month: string): Promise<CalendarDay[]> {
  if (!canTeach(actor)) throw new Error('Forbidden: teaching')
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : monthIST()
  const mine = can(actor, 'update', 'batch') ? sql`` : sql`and b.trainer_id = ${actor.userId}`
  const time = sql`case when b.start_time is not null then to_char(b.start_time, 'HH24:MI') || '–' || to_char(b.end_time, 'HH24:MI') end`
  const members = sql`(select count(*)::int from batch_members x where x.batch_id = b.id)`
  type Row = { kind: CalendarDay['kind']; date: string; batch: string; batch_id: string; topic: string | null; present: number; marked: number; members: number; time: string | null; max_score: number | null; graded: number | null }
  const rows = (await tx.execute<Row>(sql`
    select 'class' as kind, s.session_date::text as date, b.name as batch, b.id as batch_id, s.topic,
      (select count(*)::int from attendance a where a.session_id = s.id and a.present) as present,
      (select count(*)::int from attendance a where a.session_id = s.id) as marked, ${members} as members, ${time} as time, null::int as max_score, null::int as graded
    from class_sessions s join batches b on b.id = s.batch_id
    where to_char(s.session_date, 'YYYY-MM') = ${m} ${mine}
    union all
    select 'planned', d::date::text, b.name, b.id, null, 0, 0, ${members}, ${time}, null, null
    from batches b cross join generate_series(${m + '-01'}::date, (${m + '-01'}::date + interval '1 month' - interval '1 day'), interval '1 day') d
    where b.is_active and d::date >= current_date and (b.start_date is null or d::date >= b.start_date)
      and extract(isodow from d)::int = any(coalesce(b.days, '{}'))
      and not exists (select 1 from class_sessions s where s.batch_id = b.id and s.session_date = d::date) ${mine}
    union all
    select 'test', t.test_date::text, b.name, b.id, t.title, 0, 0, ${members}, null, t.max_score,
      (select count(*)::int from assessments a where a.test_id = t.id and a.score is not null)
    from tests t join batches b on b.id = t.batch_id
    where to_char(t.test_date, 'YYYY-MM') = ${m} ${mine}
    order by 2, 9 nulls last`)).rows
  return rows.map((r) => ({ kind: r.kind, date: r.date, batch: r.batch, batchId: r.batch_id, topic: r.topic, present: r.present, marked: r.marked, members: r.members, time: r.time, ...(r.kind === 'test' ? { maxScore: r.max_score ?? 0, graded: r.graded ?? 0 } : {}) }))
}

// ---- help from trainers (project / doubts / career)

export const HELP_KINDS = [
  { key: 'project', label: 'Project help' }, { key: 'doubt', label: 'A topic I am stuck on' },
  { key: 'career', label: 'Career & interview' }, { key: 'other', label: 'Something else' },
] as const
export type HelpKind = (typeof HELP_KINDS)[number]['key']
export type HelpOffer = { trainerId: string; trainer: string; branch: string | null; message: string | null; at: string; email?: string | null }
export type HelpRequest = {
  id: string; no: string; kind: string; title: string; details: string; status: 'open' | 'assigned' | 'done' | 'cancelled'; at: string
  student: string; course: string | null; branch: string | null; offers: HelpOffer[]; chosen: HelpOffer | null; iOffered: boolean; mineChosen: boolean
  studentContact?: { email: string | null } | null
}

const helpInput = z.object({
  kind: z.enum(HELP_KINDS.map((k) => k.key) as [HelpKind, ...HelpKind[]]),
  title: z.string().trim().min(3, 'Give it a short title').max(150),
  details: z.string().trim().min(5, 'Tell the trainers what you need').max(4000),
  registrationId: uuid.nullable().optional(),
})
export type HelpInput = z.input<typeof helpInput>

export async function askForHelp(tx: Tx, actor: Actor, raw: HelpInput) {
  if (!isStudent(actor) || !actor.personId) throw new Error('Only a student asks for help here')
  const v = helpInput.parse(raw)
  const [reg] = (await tx.execute<{ id: string; branch_id: string }>(sql`select id, branch_id from registrations ${v.registrationId ? sql`where id = ${v.registrationId}` : sql``} order by created_at desc limit 1`)).rows
  if (!reg) throw new Error('No enrolment found on your account')
  const [h] = (await tx.execute<{ id: string; request_no: string }>(sql`
    insert into help_requests (request_no, branch_id, registration_id, person_id, created_by, kind, title, details) values (${await nextOrgNo(tx, 'HLP')}, ${reg.branch_id}, ${reg.id}, ${actor.personId}, ${actor.userId}, ${v.kind}, ${v.title}, ${v.details}) returning id, request_no`)).rows
  await audit(tx, actor, { action: 'ask_help', entity: 'help_request', entityId: h.id, after: { kind: v.kind, title: v.title } })
  return { id: h.id, no: h.request_no }
}

/** Who is e-mailed about a help request: on a new one, the trainers and academic managers of the student's branch and
 * the trainers of the student's batches (none there: every branch's, as all of them may offer); once the student
 * chooses, the chosen trainer. */
export type HelpMail = { to: string; subject: string; body: string; branchId: string }
export async function helpMails(orgId: string, requestId: string, event: 'new' | 'chosen', origin: string): Promise<HelpMail[]> {
  return withOrgSystem(orgId, async (sys) => {
    const [h] = (await sys.execute<{ request_no: string; kind: string; title: string; details: string; branch_id: string; registration_id: string | null; chosen_trainer_id: string | null; student: string; course: string | null; branch: string | null }>(sql`
      select h.request_no, h.kind, h.title, h.details, h.branch_id, h.registration_id, h.chosen_trainer_id, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as student,
        coalesce(c.title, r.custom_course_title) as course, b.name as branch
      from help_requests h join persons p on p.id = h.person_id left join registrations r on r.id = h.registration_id left join courses c on c.id = r.course_id left join branches b on b.id = h.branch_id
      where h.id = ${uuid.parse(requestId)}`)).rows
    if (!h) return []
    const teaches = sql`exists (select 1 from user_roles ur join roles ro on ro.key = ur.role where ur.user_id = u.id and 'teaching:read' = any(ro.permissions))`
    let to = (await sys.execute<{ email: string; name: string }>(event === 'chosen'
      ? sql`select email, name from users where id = ${h.chosen_trainer_id} and is_active and deleted_at is null`
      : sql`select distinct u.email, u.name from users u where u.is_active and u.deleted_at is null and (
          u.id in (select b.trainer_id from batch_members m join batches b on b.id = m.batch_id where m.registration_id = ${h.registration_id})
          or (u.branch_id = ${h.branch_id} and ${teaches}))
        limit 50`)).rows
    if (!to.length && event === 'new') to = (await sys.execute<{ email: string; name: string }>(sql`select u.email, u.name from users u where u.is_active and u.deleted_at is null and ${teaches} limit 50`)).rows
    const kind = HELP_KINDS.find((k) => k.key === h.kind)?.label ?? h.kind
    const about = `${h.student}${h.course ? `, ${h.course}` : ''}${h.branch ? ` (${h.branch})` : ''}`
    const details = h.details.length > 600 ? `${h.details.slice(0, 600)}…` : h.details
    const t = await resolveTemplate(sys, event === 'chosen' ? 'help_chosen_email' : 'help_request_email', h.branch_id)
    return to.filter((u) => u.email).map((u) => {
      const vars = { trainer: u.name, student: about, kind, request_no: h.request_no, title: h.title, details, link: mailButton('Open Project Help', `${origin}/project-help`) }
      return { to: u.email, branchId: h.branch_id, subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars) }
    })
  })
}

/**
 * Help requests. A student: their own, with every trainer's offer and (once chosen) the trainer's contact.
 * A trainer: open ones from every branch, and those they offered on or were chosen for (with the student's contact).
 */
export async function listHelp(tx: Tx, actor: Actor): Promise<HelpRequest[]> {
  const student = isStudent(actor)
  if (!student && !canTeach(actor)) throw new Error('Forbidden: help requests')
  const reqs = (await tx.execute<{ id: string; request_no: string; kind: string; title: string; details: string; status: HelpRequest['status']; created_at: string; person_id: string; chosen_trainer_id: string | null; registration_id: string | null; branch_id: string }>(sql`
    select h.id, h.request_no, h.kind, h.title, h.details, h.status, h.created_at, h.person_id, h.chosen_trainer_id, h.registration_id, h.branch_id from help_requests h
    ${student ? sql`` : sql`where h.status = 'open' or h.chosen_trainer_id = ${actor.userId} or exists (select 1 from help_offers o where o.request_id = h.id and o.trainer_id = ${actor.userId})`}
    order by (h.status = 'open') desc, h.created_at desc limit 200`)).rows
  if (!reqs.length) return []
  const ids = sql.join(reqs.map((r) => sql`${r.id}::uuid`), sql`, `)
  // names and contacts across branches: read on the server's own connection, for exactly these requests
  const info = await withOrgSystem(actor.orgId, async (sys) => ({
    offers: (await sys.execute<{ request_id: string; trainer_id: string; trainer: string; email: string; branch: string | null; message: string | null; created_at: string }>(sql`
      select o.request_id, o.trainer_id, u.name as trainer, u.email, b.name as branch, o.message, o.created_at
      from help_offers o join users u on u.id = o.trainer_id left join branches b on b.id = u.branch_id where o.request_id in (${ids}) order by o.created_at`)).rows,
    people: (await sys.execute<{ request_id: string; student: string; email: string | null; course: string | null; branch: string | null }>(sql`
      select h.id as request_id, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as student, p.email, coalesce(c.title, r.custom_course_title) as course, b.name as branch
      from help_requests h join persons p on p.id = h.person_id left join registrations r on r.id = h.registration_id left join courses c on c.id = r.course_id left join branches b on b.id = h.branch_id
      where h.id in (${ids})`)).rows,
  }))
  return reqs.map((h) => {
    const who = info.people.find((p) => p.request_id === h.id)
    const offers = info.offers.filter((o) => o.request_id === h.id)
    const chosenRow = h.chosen_trainer_id ? offers.find((o) => o.trainer_id === h.chosen_trainer_id) : null
    const toOffer = (o: (typeof offers)[number], contact: boolean): HelpOffer => ({ trainerId: o.trainer_id, trainer: o.trainer, branch: o.branch, message: o.message, at: new Date(o.created_at).toISOString(), ...(contact ? { email: o.email } : {}) })
    const mineChosen = !student && h.chosen_trainer_id === actor.userId
    return {
      id: h.id, no: h.request_no, kind: h.kind, title: h.title, details: h.details, status: h.status, at: new Date(h.created_at).toISOString(),
      student: student ? 'You' : who?.student ?? 'Student', course: who?.course ?? null, branch: who?.branch ?? null,
      // a trainer sees who else offered (names only); the student sees every offer
      offers: offers.map((o) => toOffer(o, false)),
      chosen: chosenRow ? toOffer(chosenRow, student || mineChosen) : null,
      iOffered: !student && offers.some((o) => o.trainer_id === actor.userId),
      mineChosen,
      studentContact: mineChosen ? { email: who?.email ?? null } : null,
    }
  })
}

export async function offerHelp(tx: Tx, actor: Actor, requestId: string, message: string | null) {
  if (isStudent(actor) || !canTeach(actor)) throw new Error('Only a trainer offers help')
  // read, not locked: a trainer of another branch may see the request but not change it (a lock needs that right)
  const [h] = (await tx.execute<{ status: string }>(sql`select status from help_requests where id = ${uuid.parse(requestId)}`)).rows
  if (!h) throw new Error('Request not found')
  if (h.status !== 'open') throw new Error('This request already has a trainer')
  await tx.execute(sql`insert into help_offers (request_id, trainer_id, message) values (${requestId}, ${actor.userId}, ${message?.trim().slice(0, 1000) || null}) on conflict (request_id, trainer_id) do update set message = excluded.message`)
  await audit(tx, actor, { action: 'offer_help', entity: 'help_request', entityId: requestId })
}

export async function withdrawOffer(tx: Tx, actor: Actor, requestId: string) {
  const [h] = (await tx.execute<{ status: string; chosen_trainer_id: string | null }>(sql`select status, chosen_trainer_id from help_requests where id = ${uuid.parse(requestId)}`)).rows
  if (!h) throw new Error('Request not found')
  if (h.chosen_trainer_id === actor.userId && h.status === 'assigned') throw new Error('The student chose you: mark it done, or ask the student to pick someone else')
  await tx.execute(sql`delete from help_offers where request_id = ${requestId} and trainer_id = ${actor.userId}`)
}

/** The student picks one of the trainers who offered; the others are told no by the request moving on. */
export async function chooseHelper(tx: Tx, actor: Actor, requestId: string, trainerId: string) {
  if (!isStudent(actor)) throw new Error('Only the student chooses')
  const [h] = (await tx.execute<{ status: string }>(sql`select status from help_requests where id = ${uuid.parse(requestId)} for update`)).rows
  if (!h) throw new Error('Request not found')
  if (h.status !== 'open') throw new Error('A trainer is already chosen')
  const [o] = (await tx.execute(sql`select 1 from help_offers where request_id = ${requestId} and trainer_id = ${uuid.parse(trainerId)}`)).rows
  if (!o) throw new Error('This trainer has not offered to help')
  await tx.execute(sql`update help_requests set status = 'assigned', chosen_trainer_id = ${trainerId}, updated_at = now() where id = ${requestId}`)
  await audit(tx, actor, { action: 'choose_helper', entity: 'help_request', entityId: requestId, after: { trainerId } })
}

/** Done (by the student or the chosen trainer), or cancelled by the student. */
export async function closeHelp(tx: Tx, actor: Actor, requestId: string, outcome: 'done' | 'cancelled') {
  const [h] = (await tx.execute<{ status: string; chosen_trainer_id: string | null }>(sql`select status, chosen_trainer_id from help_requests where id = ${uuid.parse(requestId)} for update`)).rows
  if (!h) throw new Error('Request not found')
  if (!isStudent(actor) && (outcome === 'cancelled' || h.chosen_trainer_id !== actor.userId)) throw new Error('Only the chosen trainer marks it done')
  if (h.status === 'done' || h.status === 'cancelled') throw new Error(`This request is already ${h.status}`)
  await tx.execute(sql`update help_requests set status = ${outcome}, updated_at = now() where id = ${requestId}`)
}

/** Office view of one student's help requests: what they asked, who offered, and the trainer who took it. */
export type StudentHelpRow = { id: string; no: string; kind: string; title: string; details: string; status: 'open' | 'assigned' | 'done' | 'cancelled'; at: string; offers: string[]; trainer: string | null; trainerBranch: string | null; trainerEmail: string | null }
export async function studentHelp(tx: Tx, actor: Actor, registrationId: string): Promise<StudentHelpRow[]> {
  if (!can(actor, 'read', 'registration')) throw new Error('Forbidden: students')
  const id = uuid.parse(registrationId)
  // the registration must be one this person can see (RLS: their branch; every branch for head office)
  const [reg] = (await tx.execute<{ person_id: string }>(sql`select person_id from registrations where id = ${id}`)).rows
  if (!reg) throw new Error('Student not found')
  const reqs = (await tx.execute<{ id: string; request_no: string; kind: string; title: string; details: string; status: StudentHelpRow['status']; created_at: string; chosen_trainer_id: string | null }>(sql`
    select id, request_no, kind, title, details, status, created_at, chosen_trainer_id from help_requests where person_id = ${reg.person_id} order by created_at desc`)).rows
  if (!reqs.length) return []
  const ids = sql.join(reqs.map((r) => sql`${r.id}::uuid`), sql`, `)
  // trainers can be of any branch: names read on the server's own connection, for exactly these requests
  const offers = await withOrgSystem(actor.orgId, async (sys) => (await sys.execute<{ request_id: string; trainer_id: string; trainer: string; email: string; branch: string | null }>(sql`
    select o.request_id, o.trainer_id, u.name as trainer, u.email, b.name as branch
    from help_offers o join users u on u.id = o.trainer_id left join branches b on b.id = u.branch_id where o.request_id in (${ids}) order by o.created_at`)).rows)
  return reqs.map((h) => {
    const mine = offers.filter((o) => o.request_id === h.id)
    const chosen = mine.find((o) => o.trainer_id === h.chosen_trainer_id)
    return { id: h.id, no: h.request_no, kind: HELP_KINDS.find((k) => k.key === h.kind)?.label ?? h.kind, title: h.title, details: h.details, status: h.status, at: new Date(h.created_at).toISOString(),
      offers: mine.map((o) => o.trainer), trainer: chosen?.trainer ?? null, trainerBranch: chosen?.branch ?? null, trainerEmail: chosen?.email ?? null }
  })
}
