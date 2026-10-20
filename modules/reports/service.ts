// Read-only numbers for the dashboard and Reports. Every figure is computed from the source tables/views (P6);
// nothing here is stored. RLS decides what the caller may count; branchId only narrows a super admin's view.
// "All branches" means all ACTIVE branches: a closed or test branch drops out of the totals but stays viewable when picked.
import { sql, type SQL } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { NOT_TRANSFERRED_IN } from '@/lib/report-filters'

export type Delta = { value: number; changePct: number | null } // changePct vs the period before, null when no baseline

/** The dashboard's dates (India time, both days included). No range picked: this month so far. */
export type DashRange = { from: string; to: string }
export type Dashboard = {
  range: DashRange & { days: number; prevFrom: string; prevTo: string; picked: boolean }
  enquiries: Delta & { total: number }
  registrations: Delta & { total: number }
  students: number
  followUpsDue: number
  feesCollected: Delta & { total: number } // paise
  pendingDues: number // paise
  /** no range picked: the last 12 months; a picked range: by day (up to 62 days) or by month, oldest first */
  series: { label: string; enquiries: number; registrations: number }[]
  seriesBy: 'day' | 'month'
  byDepartment: { name: string; count: number }[]
  sources: { source: string; enquiries: number; joined: number }[] // in the range
  todaysFollowUps: { enquiryNo: string; name: string; course: string | null; dueDate: string; overdue: boolean }[]
  recentActivity: { who: string; what: string; at: string }[] // in the range
}

const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const todayIn = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
/** A range from the page's ?from / ?to: valid days, from <= to, at most 5 years; null when none or not valid. */
export function dashRange(from?: string | null, to?: string | null): DashRange | null {
  if (!from || !to || !ISO.test(from) || !ISO.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null
  const [a, b] = from <= to ? [from, to] : [to, from]
  return Date.parse(b) - Date.parse(a) > 5 * 366 * 86400000 ? { from: addDays(b, -5 * 365), to: b } : { from: a, to: b }
}

export async function dashboard(tx: Tx, actor: Actor, branchId: string | null, picked: DashRange | null = null): Promise<Dashboard> {
  assertCan(actor, 'read', 'report')
  const b = branchId
  const one = async <T>(q: SQL) => (await tx.execute<T & Record<string, unknown>>(q)).rows
  const today = todayIn()
  const { from, to } = picked ?? { from: today.slice(0, 8) + '01', to: today }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days)
  const inBranch = (col: SQL = sql`branch_id`) => sql`(${b}::uuid is null and ${col} in (select id from branches where is_active) or ${col} = ${b})`
  const day = (col: SQL) => sql`(${col} at time zone 'Asia/Kolkata')::date`
  const within = (col: SQL, f: string, t: string) => sql`${day(col)} between ${f}::date and ${t}::date`

  const [counts] = await one<{
    enq_total: number; enq_cur: number; enq_prev: number; reg_total: number; reg_cur: number; reg_prev: number; students: number; due: number
  }>(sql`
    select
      (select count(*)::int from enquiries where ${inBranch()}) as enq_total,
      (select count(*)::int from enquiries where ${within(sql`created_at`, from, to)} and ${inBranch()}) as enq_cur,
      (select count(*)::int from enquiries where ${within(sql`created_at`, prevFrom, prevTo)} and ${inBranch()}) as enq_prev,
      (select count(*)::int from registrations r where ${inBranch()} and ${NOT_TRANSFERRED_IN}) as reg_total,
      (select count(*)::int from registrations r where ${within(sql`created_at`, from, to)} and ${inBranch()} and ${NOT_TRANSFERRED_IN}) as reg_cur,
      (select count(*)::int from registrations r where ${within(sql`created_at`, prevFrom, prevTo)} and ${inBranch()} and ${NOT_TRANSFERRED_IN}) as reg_prev,
      (select count(*)::int from registrations where status = 'active' and ${inBranch()}) as students,
      (select count(*)::int from enquiries where next_follow_up <= current_date and status not in ('joined', 'dead') and ${inBranch()}) as due`)

  // collected = payments that stand (a reversed one is not money in), on the day they were PAID (India time)
  const [money] = await one<{ total: number; cur: number; prev: number; pending: number }>(sql`
    select
      coalesce(sum(amount), 0)::bigint as total,
      coalesce(sum(amount) filter (where ${within(sql`paid_at`, from, to)}), 0)::bigint as cur,
      coalesce(sum(amount) filter (where ${within(sql`paid_at`, prevFrom, prevTo)}), 0)::bigint as prev,
      (select coalesce(sum(balance) filter (where balance > 0), 0)::bigint from v_fee_balance where ${inBranch()}) as pending
    from v_live_payments where ${inBranch()}`)

  // the trend: the last 12 months, or the picked range by day (up to 62 days) or by month
  const seriesBy: 'day' | 'month' = picked && days <= 62 ? 'day' : 'month'
  const back11 = (() => { const [y, m] = today.split('-').map(Number), k = y * 12 + m - 1 - 11; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01` })()
  const [sFrom, sTo] = picked ? [from, to] : [back11, today]
  const unit = seriesBy
  const series = await one<{ label: string; enquiries: number; registrations: number }>(sql`
    select to_char(m, ${seriesBy === 'day' ? 'DD Mon' : 'Mon'}) as label,
      (select count(*)::int from enquiries e where date_trunc(${unit}, ${day(sql`e.created_at`)}) = m and ${inBranch(sql`e.branch_id`)}) as enquiries,
      (select count(*)::int from registrations r where date_trunc(${unit}, ${day(sql`r.created_at`)}) = m and ${inBranch(sql`r.branch_id`)} and ${NOT_TRANSFERRED_IN}) as registrations
    from generate_series(date_trunc(${unit}, ${sFrom}::date), date_trunc(${unit}, ${sTo}::date), ${'1 ' + unit}::interval) m order by m`)

  const byDepartment = await one<{ name: string; count: number }>(sql`
    select d.name, count(*)::int as count from registrations r join departments d on d.id = r.department_id
    where r.status = 'active' and ${inBranch(sql`r.branch_id`)} group by d.name order by count desc, d.name`)

  const sources = await one<{ source: string; enquiries: number; joined: number }>(sql`
    select coalesce(l.value, 'Not given') as source, count(*)::int as enquiries, count(*) filter (where e.status = 'joined')::int as joined
    from enquiries e left join lookups l on l.id = e.source_id where ${within(sql`e.created_at`, from, to)} and ${inBranch(sql`e.branch_id`)}
    group by l.value order by enquiries desc limit 6`)

  const followUps = await one<{ enquiry_no: string; name: string; course: string | null; due: string; overdue: boolean }>(sql`
    select e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, coalesce(c.title, d.name) as course,
      e.next_follow_up::text as due, e.next_follow_up < current_date as overdue
    from enquiries e join persons p on p.id = e.person_id left join courses c on c.id = e.course_id left join departments d on d.id = e.department_id
    where e.next_follow_up <= current_date and e.status not in ('joined', 'dead') and ${inBranch(sql`e.branch_id`)}
    order by e.next_follow_up, e.created_at limit 6`)

  const activity = await one<{ who: string | null; action: string; entity: string; at: string }>(sql`
    select u.name as who, a.action, a.entity, a.at::text as at
    from audit_logs a left join users u on u.id = a.user_id
    where a.action <> 'login' and (${b}::uuid is null or a.branch_id = ${b}) and ${within(sql`a.at`, from, to)} order by a.at desc limit 8`)

  const n = (v: unknown) => Number(v ?? 0)
  return {
    range: { from, to, days, prevFrom, prevTo, picked: !!picked },
    enquiries: { total: n(counts.enq_total), value: n(counts.enq_cur), changePct: pct(n(counts.enq_cur), n(counts.enq_prev)) },
    registrations: { total: n(counts.reg_total), value: n(counts.reg_cur), changePct: pct(n(counts.reg_cur), n(counts.reg_prev)) },
    students: n(counts.students),
    followUpsDue: n(counts.due),
    feesCollected: { total: n(money.total), value: n(money.cur), changePct: pct(n(money.cur), n(money.prev)) },
    pendingDues: n(money.pending),
    series: series.map((s) => ({ label: s.label, enquiries: n(s.enquiries), registrations: n(s.registrations) })),
    seriesBy,
    byDepartment: byDepartment.map((d) => ({ name: d.name, count: n(d.count) })),
    sources: sources.map((x) => ({ source: x.source, enquiries: n(x.enquiries), joined: n(x.joined) })),
    todaysFollowUps: followUps.map((f) => ({ enquiryNo: f.enquiry_no, name: f.name, course: f.course, dueDate: f.due, overdue: f.overdue })),
    recentActivity: activity.map((a) => ({ who: a.who ?? 'System', what: `${a.action.replace(/_/g, ' ')} ${a.entity.replace(/_/g, ' ')}`, at: a.at })),
  }
}

export type Reports = {
  dues: { bucket: string; count: number; amount: number }[] // paise
  funnel: { enquiries: number; demo: number; joined: number; registered: number; dead: number }
  branches: { code: string; name: string; enquiries: number; registrations: number; collected: number; pending: number }[]
  sources: { source: string; enquiries: number; joined: number }[]
}

export async function reports(tx: Tx, actor: Actor, branchId: string | null): Promise<Reports> {
  assertCan(actor, 'read', 'report')
  const b = branchId
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute<T & Record<string, unknown>>(q)).rows
  const n = (v: unknown) => Number(v ?? 0)

  const dues = await rows<{ bucket: string; count: number; amount: number }>(sql`
    select bucket, count(*)::int as count, sum(amount)::bigint as amount from v_dues
    -- dues of students still studying (active / on hold), as on the Fees page
    where (${b}::uuid is null and branch_id in (select id from branches where is_active) or branch_id = ${b}) and registration_id in (select id from registrations where status in ('active', 'on_hold')) group by bucket`)
  const order = ['upcoming', '0-15', '16-30', '30+']

  const [f] = await rows<{ enquiries: number; demo: number; joined: number; registered: number; dead: number }>(sql`
    select count(*)::int as enquiries,
      count(*) filter (where exists (select 1 from enquiry_events v where v.enquiry_id = e.id and v.to_status = 'demo'))::int as demo,
      count(*) filter (where status = 'joined')::int as joined,
      count(*) filter (where exists (select 1 from registrations r where r.enquiry_id = e.id))::int as registered,
      count(*) filter (where status = 'dead')::int as dead
    from enquiries e where (${b}::uuid is null and e.branch_id in (select id from branches where is_active) or e.branch_id = ${b})`)

  const branches = await rows<{ code: string; name: string; enquiries: number; registrations: number; collected: number; pending: number }>(sql`
    select br.code, br.name,
      (select count(*)::int from enquiries e where e.branch_id = br.id) as enquiries,
      (select count(*)::int from registrations r where r.branch_id = br.id and ${NOT_TRANSFERRED_IN}) as registrations,
      (select coalesce(sum(p.amount), 0)::bigint from v_live_payments p where p.branch_id = br.id) as collected,
      (select coalesce(sum(v.balance) filter (where v.balance > 0), 0)::bigint from v_fee_balance v where v.branch_id = br.id) as pending
    from branches br where br.is_active and (${b}::uuid is null or br.id = ${b}) order by br.name`)

  const sources = await rows<{ source: string; enquiries: number; joined: number }>(sql`
    select coalesce(l.value, 'Unknown') as source, count(*)::int as enquiries, count(*) filter (where e.status = 'joined')::int as joined
    from enquiries e left join lookups l on l.id = e.source_id where (${b}::uuid is null and e.branch_id in (select id from branches where is_active) or e.branch_id = ${b})
    group by l.value order by enquiries desc`)

  return {
    dues: order.map((k) => { const r = dues.find((d) => d.bucket === k); return { bucket: k, count: n(r?.count), amount: n(r?.amount) } }),
    funnel: { enquiries: n(f.enquiries), demo: n(f.demo), joined: n(f.joined), registered: n(f.registered), dead: n(f.dead) },
    branches: branches.map((r) => ({ code: r.code, name: r.name, enquiries: n(r.enquiries), registrations: n(r.registrations), collected: n(r.collected), pending: n(r.pending) })),
    sources: sources.map((s) => ({ source: s.source, enquiries: n(s.enquiries), joined: n(s.joined) })),
  }
}

export type Summaries = {
  enquiries: { total: number; new: number; followUp: number; joined: number }
  registrations: { total: number; active: number; onHold: number; toConvert: number }
  fees: { collected: number; pending: number; overdue: number; registrations: number }
  calls: { total: number; converted: number }
  students: { total: number; eligible: number; awaiting: number; issued: number }
}

/** Headline counters for the list screens: counted over the WHOLE branch (a list only holds one page). */
export async function summaries(tx: Tx, actor: Actor): Promise<Summaries> {
  const one = async (q: ReturnType<typeof sql>) => (await tx.execute<Record<string, number>>(q)).rows[0]
  const n = (v: unknown) => Number(v ?? 0)
  const e = await one(sql`select count(*)::int as total, count(*) filter (where status = 'new')::int as "new",
    count(*) filter (where status = 'follow_up')::int as follow_up, count(*) filter (where status = 'joined')::int as joined from enquiries`)
  const r = await one(sql`select count(*)::int as total, count(*) filter (where status = 'active')::int as active,
    count(*) filter (where status = 'on_hold')::int as on_hold from registrations where app_branch() is null or branch_id = app_branch()`)
  const conv = await one(sql`select count(*)::int as n from enquiries e where e.status <> 'dead' and not exists (select 1 from registrations r where r.enquiry_id = e.id)`)
  const f = await one(sql`select coalesce(sum(amount), 0)::bigint as collected from v_live_payments`)
  const f2 = await one(sql`select coalesce(sum(balance) filter (where balance > 0), 0)::bigint as pending, count(*)::int as regs from v_fee_balance where app_branch() is null or branch_id = app_branch()`)
  const od = await one(sql`select count(*)::int as n from v_dues where days_overdue > 0 and registration_id in (select id from registrations where status in ('active', 'on_hold'))`)
  const c = await one(sql`select count(*)::int as total, count(*) filter (where enquiry_id is not null)::int as converted from calls`)
  const st = await one(sql`select count(*)::int as total,
      count(*) filter (where e.registration_status in ('active','completed') and e.fee_balance <= 0 and e.sessions_total > 0
                         and e.attendance_pct >= e.min_attendance_pct and e.capstone_ok
                         and not exists (select 1 from certificates c where c.registration_id = e.registration_id and not c.is_revoked))::int as eligible
    from v_certificate_eligibility e where app_branch() is null or e.branch_id = app_branch()`)
  const aw = await one(sql`select count(*)::int as n from certificate_requests q where q.status = 'pending'
    and not exists (select 1 from certificates c where c.registration_id = q.registration_id and not c.is_revoked)`)
  const iss = await one(sql`select count(*)::int as n from certificates where not is_revoked`)
  void actor
  return {
    enquiries: { total: n(e.total), new: n(e.new), followUp: n(e.follow_up), joined: n(e.joined) },
    registrations: { total: n(r.total), active: n(r.active), onHold: n(r.on_hold), toConvert: n(conv.n) },
    fees: { collected: n(f.collected), pending: n(f2.pending), overdue: n(od.n), registrations: n(f2.regs) },
    calls: { total: n(c.total), converted: n(c.converted) },
    students: { total: n(st.total), eligible: n(st.eligible), awaiting: n(aw.n), issued: n(iss.n) },
  }
}
