// The student portal's detail per enrolment: the course, their batches and trainers, every class marked, grades, the
// fee plan and their internship letters. The student's own registrations come from the database under the student
// rule (it returns only theirs); details the student rule hides (trainer contact, class topics, letters) are then read
// on the server's own connection, for exactly those registrations and nothing else.
import { sql } from 'drizzle-orm'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { feeSchedule } from '../fees/service'
import { UUID } from '@/lib/auth/acting'

export type StudyBatch = { name: string; days: number[] | null; start: string | null; end: string | null; timing: string | null; room: string | null; trainer: string | null; trainerEmail: string | null }
export type StudyClass = { date: string; present: boolean; topic: string | null; batch: string }
export type StudyGrade = { kind: 'assignment' | 'test' | 'capstone'; title: string; score: number | null; maxScore: number | null; approved: boolean; at: string; sheetDocId: string | null
  /** capstone: what the project was built with */
  tools: string | null }
export type StudyTopic = { module: string | null; title: string; coveredOn: string | null }
export type StudyLetter = { id: string; refNo: string; status: string; offerIssuedAt: string | null; completedAt: string | null }

export type Study = {
  registrationId: string
  course: string; department: string | null; regNo: string; status: string
  enrolledOn: string; joinedOn: string | null; endsOn: string | null; courseHours: number | null; classMode: string | null
  branch: { name: string; address: string | null; city: string | null; phone: string | null; email: string | null }
  batches: StudyBatch[]
  classes: StudyClass[]
  attendance: { sessions: number; present: number; pct: number }
  grades: StudyGrade[]
  installments: { dueDate: string; amount: number; status: string }[]
  letters: StudyLetter[]
  /** The course syllabus, with what the student's batch has covered (and when). */
  courseId: string | null; syllabus: StudyTopic[]; syllabusFile: boolean
}

export async function myStudy(tx: Tx, actor: Actor): Promise<Study[]> {
  if (actor.role !== 'student') throw new Error('Forbidden: student portal')
  // only this student's registrations come back (student RLS)
  const regs = (await tx.execute<{ id: string; reg_no: string; status: string; enrollment_date: string; joining_date: string | null; expected_end_date: string | null; course_hours: number | null; course: string | null; department: string | null; class_mode: string | null; branch_id: string; course_id: string | null }>(sql`
    select r.id, r.course_id, r.reg_no, r.status::text as status, r.enrollment_date::text, r.joining_date::text, r.expected_end_date::text, r.course_hours,
      coalesce(c.title, r.custom_course_title) as course, d.name as department, md.value as class_mode, r.branch_id
    from registrations r left join courses c on c.id = r.course_id left join departments d on d.id = r.department_id left join lookups md on md.id = r.class_mode_id
    order by r.enrollment_date desc`)).rows
  if (!regs.length) return []
  const ids = regs.map((r) => r.id)
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)

  // what the student rule hides, for these registrations only
  const hidden = await withOrgSystem(actor.orgId, async (sys) => ({
    branches: (await sys.execute<{ id: string; name: string; address: string | null; city: string | null; phone: string | null; email: string | null }>(sql`
      select id, name, address, city, phone, email from branches where id in (select branch_id from registrations where id in (${idList}))`)).rows,
    batches: (await sys.execute<{ registration_id: string; name: string; days: number[] | null; start: string | null; end: string | null; timing: string | null; room: string | null; trainer: string | null; trainer_email: string | null }>(sql`
      select m.registration_id, b.name, b.days, to_char(b.start_time, 'HH24:MI') as start, to_char(b.end_time, 'HH24:MI') as end, b.timing, b.room,
        u.name as trainer, u.email as trainer_email
      from batch_members m join batches b on b.id = m.batch_id left join users u on u.id = b.trainer_id
      where m.registration_id in (${idList}) and b.is_active order by b.start_time nulls last, b.name`)).rows,
    classes: (await sys.execute<{ registration_id: string; date: string; present: boolean; topic: string | null; batch: string }>(sql`
      select a.registration_id, s.session_date::text as date, a.present, s.topic, b.name as batch
      from attendance a join class_sessions s on s.id = a.session_id join batches b on b.id = s.batch_id
      where a.registration_id in (${idList}) order by s.session_date desc`)).rows,
    letters: (await sys.execute<{ registration_id: string; id: string; ref_no: string; status: string; offer_issued_at: string | null; completed_at: string | null }>(sql`
      select registration_id, id, ref_no, status, offer_issued_at, completed_at from internships where registration_id in (${idList}) order by created_at`)).rows,
  }))
  // grades: readable under the student rule
  const grades = (await tx.execute<{ registration_id: string; kind: StudyGrade['kind']; title: string; score: number | null; max_score: number | null; approved_at: string | null; created_at: string; sheet_doc_id: string | null; tools: string | null }>(sql`
    select registration_id, kind::text as kind, title, score, max_score, approved_at, created_at, sheet_doc_id, tools from assessments order by created_at desc`)).rows
  // the syllabus of each course (readable by all) and what the student's batches covered (student rule: their batches)
  const courseIds = [...new Set(regs.map((r) => r.course_id).filter(Boolean))] as string[]
  const topics = courseIds.length ? (await tx.execute<{ id: string; course_id: string; module: string | null; title: string }>(sql`
    select id, course_id, module, title from course_topics where course_id in (${sql.join(courseIds.map((c) => sql`${c}::uuid`), sql`, `)}) order by sort_order, created_at`)).rows : []
  const covered = (await tx.execute<{ topic_id: string; covered_on: string; registration_id: string }>(sql`
    select bt.topic_id, bt.covered_on::text, m.registration_id from batch_topics bt join batch_members m on m.batch_id = bt.batch_id`)).rows
  const files = courseIds.length ? (await tx.execute<{ course_id: string }>(sql`select course_id from course_syllabus_files where course_id in (${sql.join(courseIds.map((c) => sql`${c}::uuid`), sql`, `)})`)).rows.map((f) => f.course_id) : []

  const out: Study[] = []
  for (const r of regs) {
    const b = hidden.branches.find((x) => x.id === r.branch_id)
    const classes = hidden.classes.filter((c) => c.registration_id === r.id).map((c) => ({ date: c.date, present: c.present, topic: c.topic, batch: c.batch }))
    const present = classes.filter((c) => c.present).length
    const sched = await feeSchedule(tx, actor, r.id).catch(() => null)
    out.push({
      registrationId: r.id, course: r.course ?? r.department ?? 'Course', department: r.department, regNo: r.reg_no, status: r.status,
      enrolledOn: r.enrollment_date, joinedOn: r.joining_date, endsOn: r.expected_end_date, courseHours: r.course_hours, classMode: r.class_mode,
      branch: { name: b?.name ?? '', address: b?.address ?? null, city: b?.city ?? null, phone: b?.phone ?? null, email: b?.email ?? null },
      batches: hidden.batches.filter((x) => x.registration_id === r.id).map((x) => ({ name: x.name, days: x.days, start: x.start, end: x.end, timing: x.timing, room: x.room, trainer: x.trainer, trainerEmail: x.trainer_email })),
      classes,
      attendance: { sessions: classes.length, present, pct: classes.length ? Math.round((present / classes.length) * 100) : 0 },
      grades: grades.filter((g) => g.registration_id === r.id).map((g) => ({ kind: g.kind, title: g.title, score: g.score, maxScore: g.max_score, approved: !!g.approved_at, at: new Date(g.created_at).toISOString(), sheetDocId: g.sheet_doc_id, tools: g.tools })),
      courseId: r.course_id, syllabusFile: !!r.course_id && files.includes(r.course_id),
      syllabus: topics.filter((t) => t.course_id === r.course_id).map((t) => ({ module: t.module, title: t.title, coveredOn: covered.find((c) => c.topic_id === t.id && c.registration_id === r.id)?.covered_on ?? null })),
      installments: (sched?.installments ?? []).map((i) => ({ dueDate: i.dueDate, amount: i.amount, status: i.status })),
      letters: hidden.letters.filter((l) => l.registration_id === r.id).map((l) => ({
        id: l.id, refNo: l.ref_no, status: l.status, offerIssuedAt: l.offer_issued_at ? new Date(l.offer_issued_at).toISOString() : null, completedAt: l.completed_at ? new Date(l.completed_at).toISOString() : null,
      })),
    })
  }
  return out
}

/** Whether this registration is the signed-in student's own (the student rule returns only theirs). */
export async function ownsRegistration(tx: Tx, registrationId: string) {
  if (!UUID.test(registrationId)) return false
  return (await tx.execute(sql`select 1 from registrations where id = ${registrationId}`)).rows.length > 0
}
