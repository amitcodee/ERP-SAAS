// The report card of one registration: every marked test and assignment with its percentage and grade, the overall
// result (total marks over total maximums) with its grade and pass / fail, the rank in the student's batch, the
// attendance and the capstone project. Grades follow the institute's bands (Settings → Report cards, lib/grades.ts).
import { sql } from 'drizzle-orm'
import type { Tx } from '@/lib/db/withTenant'
import { gradeOf, overall, pctOf, ranks, type GradesConfig } from '@/lib/grades'

export type ReportCard = {
  student: { name: string; father: string | null; regNo: string; course: string | null; branch: string; enrolledOn: string; endsOn: string | null; status: string; photoId: string | null }
  marks: { title: string; kind: 'test' | 'assignment'; date: string; score: number; maxScore: number; pct: number; grade: string }[]
  /** marked-to-be, without a score yet (an answer sheet uploaded, marks still to come) */
  pending: number
  overall: { score: number; max: number; pct: number; grade: string; label: string; passed: boolean } | null
  rank: { rank: number; of: number; batch: string } | null
  attendance: { present: number; total: number; pct: number | null }
  capstone: { title: string; approved: boolean } | null
  passPct: number
}

/** The report card, read in the caller's transaction (its RLS decides whose it may be), or null when not found. */
export async function reportCardIn(tx: Tx, registrationId: string, grades: GradesConfig): Promise<ReportCard | null> {
  const [s] = (await tx.execute<{ name: string; father: string | null; reg_no: string; course: string | null; branch: string; enrolled: string; ends: string | null; status: string; photo_id: string | null }>(sql`
    select trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.father_name as father, r.reg_no, coalesce(c.title, r.custom_course_title, d.name) as course,
      b.name as branch, r.enrollment_date::text as enrolled, r.expected_end_date::text as ends, r.status,
      (select dc.id from registration_documents dc where dc.registration_id = r.id and dc.kind = 'photo' order by dc.uploaded_at desc limit 1) as photo_id
    from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id
      left join courses c on c.id = r.course_id left join departments d on d.id = r.department_id where r.id = ${registrationId}`)).rows
  if (!s) return null
  const rows = (await tx.execute<{ title: string; kind: string; score: number | null; max_score: number | null; date: string; approved: boolean }>(sql`
    select a.title, a.kind::text, a.score, a.max_score, coalesce(t.test_date, a.created_at::date)::text as date, a.approved_at is not null as approved
    from assessments a left join tests t on t.id = a.test_id where a.registration_id = ${registrationId} order by coalesce(t.test_date, a.created_at::date), a.created_at`)).rows
  const marked = rows.filter((r) => r.kind !== 'capstone')
  const marks = marked.filter((r) => r.score != null && r.max_score != null && r.max_score > 0).map((r) => {
    const pct = pctOf(r.score!, r.max_score!)
    return { title: r.title, kind: r.kind as 'test' | 'assignment', date: r.date, score: r.score!, maxScore: r.max_score!, pct, grade: gradeOf(pct, grades.bands).grade }
  })
  const all = overall(marks)
  const band = all ? gradeOf(all.pct, grades.bands) : null
  const cap = rows.filter((r) => r.kind === 'capstone')
  const [att] = (await tx.execute<{ present: number; total: number }>(sql`
    select count(*) filter (where present)::int as present, count(*)::int as total from attendance where registration_id = ${registrationId}`)).rows
  return {
    student: { name: s.name, father: s.father, regNo: s.reg_no, course: s.course, branch: s.branch, enrolledOn: s.enrolled, endsOn: s.ends, status: s.status, photoId: s.photo_id },
    marks, pending: marked.length - marks.length,
    overall: all && band ? { ...all, grade: band.grade, label: band.label, passed: all.pct >= grades.passPct } : null,
    rank: await batchRank(tx, registrationId),
    attendance: { present: att?.present ?? 0, total: att?.total ?? 0, pct: att?.total ? pctOf(att.present, att.total) : null },
    capstone: cap.length ? { title: cap[cap.length - 1].title, approved: cap.some((c) => c.approved) } : null,
    passPct: grades.passPct,
  }
}

/**
 * The student's place in their latest batch, by the overall result over that batch's tests, among the members who
 * have marks there. Null when the student has no marked test in a batch.
 */
async function batchRank(tx: Tx, registrationId: string): Promise<ReportCard['rank']> {
  const [b] = (await tx.execute<{ id: string; name: string }>(sql`
    select bt.id, bt.name from batch_members m join batches bt on bt.id = m.batch_id where m.registration_id = ${registrationId} order by m.joined_at desc limit 1`)).rows
  if (!b) return null
  const rows = (await tx.execute<{ registration_id: string; score: number; max: number }>(sql`
    select a.registration_id, sum(a.score)::int as score, sum(a.max_score)::int as max
    from assessments a join tests t on t.id = a.test_id join batch_members m on m.batch_id = t.batch_id and m.registration_id = a.registration_id
    where t.batch_id = ${b.id} and a.score is not null and a.max_score > 0 group by a.registration_id`)).rows
  const ranked = ranks(rows.map((r) => ({ id: r.registration_id, pct: pctOf(r.score, r.max) })))
  const me = ranked.find((r) => r.id === registrationId)
  return me ? { rank: me.rank, of: ranked.length, batch: b.name } : null
}
