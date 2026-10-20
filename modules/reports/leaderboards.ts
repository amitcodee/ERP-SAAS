// Leaderboards over a period, for the branch (head office: every branch, or the one picked in the sidebar).
//   Admissions: each telecaller / counselor's leads (assigned to them, or added by them when nobody was assigned),
//     how many visited and joined, and the conversion % (joined / leads). Follow-ups = enquiry updates they made.
//   Trainers: an index out of 100 from their batches in the period — attendance (40), test scores (30), syllabus
//     covered on running batches (20) — scaled to 90 over the parts that have data, plus up to 10 for help given
//     (2 per help request marked done, at most 5).
//   Students: attendance and average test score in the period, half each (or whichever there is).
// Read on the server's own connection with an explicit branch filter, so a telecaller or trainer sees the whole
// board of their branch (names and totals only), not just their own rows.
import { sql } from 'drizzle-orm'
import { withOrgSystem, type Actor } from '@/lib/db/withTenant'
import { MIN_LEADS } from './leaderboard-rules'

export type Period = { from: string; to: string }
export type AdmissionsRow = { userId: string; name: string; branch: string | null; leads: number; visited: number; joined: number; conversion: number; followUps: number }
export type TrainerRow = {
  userId: string; name: string; branch: string | null; batches: number
  attendance: number | null; sessions: number; testAvg: number | null; tests: number; syllabus: number | null; helpDone: number; index: number | null
}
export type StudentRow = { registrationId: string; regNo: string; name: string; course: string; batch: string | null; branch: string | null; attendance: number | null; sessions: number; testAvg: number | null; tests: number; score: number }
export type Leaderboards = { admissions: AdmissionsRow[] | null; trainers: TrainerRow[] | null; students: StudentRow[] | null; batches: { id: string; name: string }[] }

const pct = (v: unknown) => (v == null ? null : Math.round(Number(v) * 1000) / 10)
const day = (col: ReturnType<typeof sql>) => sql`(${col} at time zone 'Asia/Kolkata')::date`

export function trainerIndex(t: Pick<TrainerRow, 'attendance' | 'testAvg' | 'syllabus' | 'helpDone'>): number | null {
  const parts = ([[t.attendance, 40], [t.testAvg, 30], [t.syllabus, 20]] as const).filter(([v]) => v != null) as [number, number][]
  if (!parts.length) return null
  const base = parts.reduce((s, [v, w]) => s + v * w, 0) / parts.reduce((s, [, w]) => s + w, 0) // 0-100
  return Math.round((base * 0.9 + Math.min(t.helpDone, 5) * 2) * 10) / 10
}

export async function leaderboards(actor: Actor, p: Period, show: { admissions: boolean; teaching: boolean }, batchId: string | null = null): Promise<Leaderboards> {
  const b = actor.branchId ?? null
  const inBranch = (col: ReturnType<typeof sql>) => sql`(${b}::uuid is null or ${col} = ${b}::uuid)`
  // working in a second branch for their own work only: just their own row, their own batches and their own students
  const own = actor.ownOnly ? actor.userId : null
  return withOrgSystem(actor.orgId, async (tx) => {
    let admissions: AdmissionsRow[] | null = null
    if (show.admissions) {
      const rows = (await tx.execute<{ id: string; name: string; branch: string | null; leads: number; visited: number; joined: number; follow_ups: number }>(sql`
        with leads as (
          select coalesce(e.assigned_to, e.created_by) as uid, e.visited,
            (e.status = 'joined' or exists (select 1 from registrations r where r.enquiry_id = e.id)) as joined
          from enquiries e
          where e.deleted_at is null and ${inBranch(sql`e.branch_id`)}
            and ${day(sql`coalesce(e.assigned_at, e.created_at)`)} between ${p.from}::date and ${p.to}::date
        ), ups as (
          select ev.by_user as uid, count(*)::int as n from enquiry_events ev
          where ${inBranch(sql`ev.branch_id`)} and ${day(sql`ev.at`)} between ${p.from}::date and ${p.to}::date group by 1
        )
        select u.id, u.name, br.name as branch, count(*)::int as leads, count(*) filter (where l.visited)::int as visited,
          count(*) filter (where l.joined)::int as joined, coalesce(max(ups.n), 0)::int as follow_ups
        from leads l join users u on u.id = l.uid left join branches br on br.id = u.branch_id left join ups on ups.uid = u.id
        group by u.id, u.name, br.name`)).rows
      admissions = rows
        .filter((r) => !own || r.id === own)
        .map((r) => ({ userId: r.id, name: r.name, branch: r.branch, leads: r.leads, visited: r.visited, joined: r.joined, conversion: r.leads ? Math.round((r.joined / r.leads) * 1000) / 10 : 0, followUps: r.follow_ups }))
        .sort((x, y) => Number(y.leads >= MIN_LEADS) - Number(x.leads >= MIN_LEADS) || y.conversion - x.conversion || y.joined - x.joined || y.leads - x.leads)
    }

    let trainers: TrainerRow[] | null = null
    let students: StudentRow[] | null = null
    let batches: { id: string; name: string }[] = []
    if (show.teaching) {
      const rows = (await tx.execute<{ id: string; name: string; branch: string | null; batches: number; att: string | null; sessions: number; tst: string | null; tests: number; syl: string | null; help: number }>(sql`
        with tb as (
          select b.id, b.trainer_id, b.course_id, b.is_active from batches b
          where b.deleted_at is null and b.trainer_id is not null and ${inBranch(sql`b.branch_id`)} ${own ? sql`and b.trainer_id = ${own}::uuid` : sql``}
        ), att as (
          select tb.trainer_id, avg(a.present::int) as pct, count(distinct s.id)::int as sessions
          from tb join class_sessions s on s.batch_id = tb.id and s.session_date between ${p.from}::date and ${p.to}::date
          join attendance a on a.session_id = s.id group by 1
        ), tst as (
          select tb.trainer_id, avg(least(a.score::numeric / t.max_score, 1)) as pct, count(distinct t.id)::int as tests
          from tb join tests t on t.batch_id = tb.id and t.test_date between ${p.from}::date and ${p.to}::date
          join assessments a on a.test_id = t.id and a.score is not null group by 1
        ), syl as (
          select tb.trainer_id, avg(least((select count(*) from batch_topics bt where bt.batch_id = tb.id)::numeric / ct.n, 1)) as pct
          from tb join lateral (select count(*) as n from course_topics c where c.course_id = tb.course_id) ct on ct.n > 0
          where tb.is_active group by 1
        ), hlp as (
          select h.chosen_trainer_id as trainer_id, count(*)::int as done from help_requests h
          where h.status = 'done' and ${day(sql`h.updated_at`)} between ${p.from}::date and ${p.to}::date group by 1
        )
        select u.id, u.name, br.name as branch, (select count(*)::int from tb where tb.trainer_id = u.id and tb.is_active) as batches,
          att.pct as att, coalesce(att.sessions, 0) as sessions, tst.pct as tst, coalesce(tst.tests, 0) as tests, syl.pct as syl, coalesce(hlp.done, 0) as help
        from users u left join branches br on br.id = u.branch_id
          left join att on att.trainer_id = u.id left join tst on tst.trainer_id = u.id left join syl on syl.trainer_id = u.id left join hlp on hlp.trainer_id = u.id
        where u.id in (select trainer_id from tb) and u.is_active and u.deleted_at is null`)).rows
      trainers = rows
        .map((r) => {
          const t = { attendance: pct(r.att), testAvg: pct(r.tst), syllabus: pct(r.syl), helpDone: r.help }
          return { userId: r.id, name: r.name, branch: r.branch, batches: r.batches, sessions: r.sessions, tests: r.tests, ...t, index: trainerIndex(t) }
        })
        .sort((x, y) => (y.index ?? -1) - (x.index ?? -1) || x.name.localeCompare(y.name))

      const srows = (await tx.execute<{ id: string; reg_no: string; name: string; course: string; batch: string | null; branch: string | null; att: string | null; sessions: number; tst: string | null; tests: number }>(sql`
        with att as (
          select a.registration_id, avg(a.present::int) as pct, count(*)::int as sessions
          from attendance a join class_sessions s on s.id = a.session_id where s.session_date between ${p.from}::date and ${p.to}::date
          ${batchId ? sql`and s.batch_id = ${batchId}::uuid` : sql``} group by 1
        ), tst as (
          select a.registration_id, avg(least(a.score::numeric / t.max_score, 1)) as pct, count(*)::int as tests
          from assessments a join tests t on t.id = a.test_id where a.score is not null and t.test_date between ${p.from}::date and ${p.to}::date
          ${batchId ? sql`and t.batch_id = ${batchId}::uuid` : sql``} group by 1
        )
        select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, coalesce(c.title, r.custom_course_title, d.name) as course,
          (select string_agg(b.name, ', ') from batch_members m join batches b on b.id = m.batch_id where m.registration_id = r.id and b.deleted_at is null) as batch,
          br.name as branch, att.pct as att, coalesce(att.sessions, 0) as sessions, tst.pct as tst, coalesce(tst.tests, 0) as tests
        from registrations r join persons p on p.id = r.person_id left join courses c on c.id = r.course_id left join departments d on d.id = r.department_id
          left join branches br on br.id = r.branch_id left join att on att.registration_id = r.id left join tst on tst.registration_id = r.id
        where r.status in ('active', 'completed') and r.deleted_at is null and ${inBranch(sql`r.branch_id`)} and (att.registration_id is not null or tst.registration_id is not null)
          ${batchId ? sql`and exists (select 1 from batch_members m where m.registration_id = r.id and m.batch_id = ${batchId}::uuid)` : sql``}
          ${own ? sql`and (r.created_by = ${own}::uuid or exists (select 1 from batch_members m join batches ob on ob.id = m.batch_id where m.registration_id = r.id and ob.trainer_id = ${own}::uuid))` : sql``}`)).rows
      students = srows
        .map((r) => {
          const attendance = pct(r.att), testAvg = pct(r.tst)
          const parts = [attendance, testAvg].filter((v): v is number => v != null)
          return { registrationId: r.id, regNo: r.reg_no, name: r.name, course: r.course, batch: r.batch, branch: r.branch, attendance, sessions: r.sessions, testAvg, tests: r.tests, score: Math.round((parts.reduce((s, v) => s + v, 0) / parts.length) * 10) / 10 }
        })
        .sort((x, y) => y.score - x.score || y.sessions + y.tests - (x.sessions + x.tests) || x.name.localeCompare(y.name))
        .slice(0, 100)

      batches = (await tx.execute<{ id: string; name: string }>(sql`select id, name from batches where deleted_at is null and is_active and ${inBranch(sql`branch_id`)} ${own ? sql`and trainer_id = ${own}::uuid` : sql``} order by name limit 300`)).rows
    }
    return { admissions, trainers, students, batches }
  })
}
