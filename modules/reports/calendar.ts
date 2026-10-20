// The work calendar: for every day of a month, how many calls, leads, visits, follow-ups, registrations and payments
// there were (or are due), and for one chosen day the full list behind each number. Days are India days (IST).
// Each part is shown only to those who may read it; RLS decides which rows they see, branchId only narrows head office.
import { sql, type SQL } from 'drizzle-orm'
import { can } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { NOT_TRANSFERRED_IN } from '@/lib/report-filters'

export type DayCounts = {
  calls: number; followUpCalls: number; leads: number; webLeads: number; visits: number
  followUpsDue: number; expectedVisits: number; registrations: number; payments: number; collected: number
}
export type CalendarDay = {
  calls: { at: string; name: string; phone: string; status: string | null; course: string | null; by: string | null; remark: string | null; followUp: boolean }[]
  leads: { at: string; enquiryNo: string; name: string; phone: string; course: string | null; source: string | null; status: string; assignedTo: string | null }[]
  webLeads: { at: string; name: string; phone: string | null; course: string | null; site: string; enquiryNo: string | null; waiting: boolean }[]
  visits: { at: string; enquiryNo: string; name: string; phone: string; course: string | null; status: string; assignedTo: string | null }[]
  followUps: { kind: 'Lead' | 'Call'; ref: string; name: string; phone: string; course: string | null; status: string | null; assignedTo: string | null }[]
  expectedVisits: { name: string; phone: string; course: string | null; status: string | null; assignedTo: string | null }[]
  registrations: { regNo: string; name: string; phone: string; course: string | null; fee: number; status: string }[]
  payments: { at: string; receiptNo: string; name: string; regNo: string; mode: string; amount: number }[]
}
export type CalendarView = 'month' | 'week' | 'range'
export type CalendarData = {
  view: CalendarView
  month: string // the month shown (month view), or the month of the first day
  from: string; to: string // the days whose full lists are shown (one day, a week or a range)
  gridFrom: string; gridTo: string // the days on screen with their counts
  today: string
  show: { calls: boolean; leads: boolean; webLeads: boolean; registrations: boolean; payments: boolean }
  days: Record<string, DayCounts>
  totals: DayCounts
  detail: CalendarDay
}

const ZERO: DayCounts = { calls: 0, followUpCalls: 0, leads: 0, webLeads: 0, visits: 0, followUpsDue: 0, expectedVisits: 0, registrations: 0, payments: 0, collected: 0 }
const LIMIT = 300
const ist = (col: string) => sql.raw(`(${col} at time zone 'Asia/Kolkata')::date`)
const name = (p: string) => sql.raw(`trim(${p}.first_name || ' ' || coalesce(${p}.last_name, ''))`)

/**
 * `gridFrom`..`gridTo`: the days on screen (counts per day); `from`..`to`: the days listed in full (a day, a week or a
 * range). All YYYY-MM-DD India dates.
 */
export async function calendar(tx: Tx, actor: Actor, q: { view: CalendarView; month: string; from: string; to: string; gridFrom: string; gridTo: string; today: string; branchId: string | null }): Promise<CalendarData> {
  const b = q.branchId
  const show = {
    calls: can(actor, 'read', 'call'),
    leads: can(actor, 'read', 'enquiry'),
    webLeads: can(actor, 'read', 'weblead'),
    registrations: can(actor, 'read', 'registration'),
    payments: can(actor, 'read', 'fee'),
  }
  const inBranch = (col: string) => sql`(${b}::uuid is null and ${sql.raw(col)} in (select id from branches where is_active) or ${sql.raw(col)} = ${b}::uuid)`
  const rows = async <T>(query: SQL) => (await tx.execute<T & Record<string, unknown>>(query)).rows
  const n = (v: unknown) => Number(v ?? 0)

  // ---- per-day counts for the month
  const days: Record<string, DayCounts> = {}
  const put = (list: { d: string; n: unknown; s?: unknown }[], key: keyof DayCounts, sum?: keyof DayCounts) => {
    for (const r of list) {
      const k = String(r.d).slice(0, 10)
      days[k] ??= { ...ZERO }
      days[k][key] += n(r.n)
      if (sum) days[k][sum] += n(r.s)
    }
  }
  const inMonth = (expr: SQL) => sql`${expr} between ${q.gridFrom}::date and ${q.gridTo}::date`

  if (show.calls) {
    put(await rows<{ d: string; n: number }>(sql`select ${ist('c.called_at')} as d, count(*)::int as n from calls c where ${inBranch('c.branch_id')} and ${inMonth(ist('c.called_at'))} group by 1`), 'calls')
    put(await rows<{ d: string; n: number }>(sql`select ${ist('f.called_at')} as d, count(*)::int as n from call_followups f join calls c on c.id = f.call_id where ${inBranch('f.branch_id')} and ${inMonth(ist('f.called_at'))} group by 1`), 'followUpCalls')
    // calls still open (not made an enquiry, not dead) with a follow-up or a promised visit on that day
    put(await rows<{ d: string; n: number }>(sql`select c.follow_up_date as d, count(*)::int as n from calls c where ${inBranch('c.branch_id')} and c.enquiry_id is null and coalesce(c.status, '') <> 'Dead lead' and ${inMonth(sql`c.follow_up_date`)} group by 1`), 'followUpsDue')
    put(await rows<{ d: string; n: number }>(sql`select c.expected_visit_date as d, count(*)::int as n from calls c where ${inBranch('c.branch_id')} and c.enquiry_id is null and coalesce(c.status, '') <> 'Dead lead' and ${inMonth(sql`c.expected_visit_date`)} group by 1`), 'expectedVisits')
  }
  if (show.leads) {
    put(await rows<{ d: string; n: number }>(sql`select ${ist('e.created_at')} as d, count(*)::int as n from enquiries e where ${inBranch('e.branch_id')} and not e.visited and ${inMonth(ist('e.created_at'))} group by 1`), 'leads')
    put(await rows<{ d: string; n: number }>(sql`select ${ist('coalesce(e.visited_at, e.created_at)')} as d, count(*)::int as n from enquiries e where ${inBranch('e.branch_id')} and e.visited and ${inMonth(ist('coalesce(e.visited_at, e.created_at)'))} group by 1`), 'visits')
    put(await rows<{ d: string; n: number }>(sql`select e.next_follow_up as d, count(*)::int as n from enquiries e where ${inBranch('e.branch_id')} and e.status not in ('joined', 'not_joined', 'dead') and ${inMonth(sql`e.next_follow_up`)} group by 1`), 'followUpsDue')
  }
  if (show.webLeads) {
    put(await rows<{ d: string; n: number }>(sql`select ${ist('w.submitted_at')} as d, count(*)::int as n from web_leads w where (${b}::uuid is null or w.branch_id = ${b}::uuid) and ${inMonth(ist('w.submitted_at'))} group by 1`), 'webLeads')
  }
  if (show.registrations) {
    put(await rows<{ d: string; n: number }>(sql`select r.enrollment_date as d, count(*)::int as n from registrations r where ${inBranch('r.branch_id')} and ${inMonth(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN} group by 1`), 'registrations')
  }
  if (show.payments) {
    put(await rows<{ d: string; n: number; s: number }>(sql`select ${ist('p.paid_at')} as d, count(*)::int as n, sum(p.amount)::bigint as s from v_live_payments p where ${inBranch('p.branch_id')} and ${inMonth(ist('p.paid_at'))} group by 1`), 'payments', 'collected')
  }

  const totals = { ...ZERO }
  for (const c of Object.values(days)) for (const k of Object.keys(totals) as (keyof DayCounts)[]) totals[k] += c[k]

  // ---- the chosen day, week or range, in full
  const onDay = (expr: SQL) => sql`${expr} between ${q.from}::date and ${q.to}::date`
  const detail: CalendarDay = { calls: [], leads: [], webLeads: [], visits: [], followUps: [], expectedVisits: [], registrations: [], payments: [] }

  if (show.calls) {
    const made = await rows<{ at: string; name: string | null; phone: string | null; status: string | null; course: string | null; by: string | null; remark: string | null; follow_up: boolean }>(sql`
      select * from (
        select c.called_at as at, ${name('p')} as name, p.phone, c.status, co.title as course, u.name as by, coalesce(c.call_remark, c.remarks) as remark, false as follow_up
        from calls c left join persons p on p.id = c.person_id left join courses co on co.id = c.course_id left join users u on u.id = c.received_by
        where ${inBranch('c.branch_id')} and ${onDay(ist('c.called_at'))}
        union all
        select f.called_at, ${name('p')}, p.phone, f.status, co.title, u.name, coalesce(f.call_remark, f.remarks), true
        from call_followups f join calls c on c.id = f.call_id left join persons p on p.id = c.person_id left join courses co on co.id = c.course_id left join users u on u.id = f.by_user
        where ${inBranch('f.branch_id')} and ${onDay(ist('f.called_at'))}
      ) x order by at limit ${LIMIT}`)
    detail.calls = made.map((r) => ({ at: new Date(r.at).toISOString(), name: r.name || '(no name)', phone: r.phone ?? '', status: r.status, course: r.course, by: r.by, remark: r.remark, followUp: !!r.follow_up }))

    const due = await rows<{ name: string | null; phone: string | null; course: string | null; status: string | null; assigned: string | null; expected: boolean }>(sql`
      select ${name('p')} as name, p.phone, co.title as course, c.status, u.name as assigned, (c.expected_visit_date between ${q.from}::date and ${q.to}::date) as expected
      from calls c left join persons p on p.id = c.person_id left join courses co on co.id = c.course_id left join users u on u.id = coalesce(c.assigned_to, c.received_by)
      where ${inBranch('c.branch_id')} and c.enquiry_id is null and coalesce(c.status, '') <> 'Dead lead' and (${onDay(sql`c.follow_up_date`)} or ${onDay(sql`c.expected_visit_date`)})
      order by name limit ${LIMIT}`)
    for (const r of due) {
      const row = { name: r.name || '(no name)', phone: r.phone ?? '', course: r.course, status: r.status, assignedTo: r.assigned }
      if (r.expected) detail.expectedVisits.push(row)
      else detail.followUps.push({ kind: 'Call', ref: 'Random call', ...row })
    }
  }
  if (show.leads) {
    const ofDay = async (visited: boolean) => rows<{ at: string; enquiry_no: string; name: string; phone: string; course: string | null; source: string | null; status: string; assigned: string | null }>(sql`
      select ${visited ? sql.raw('coalesce(e.visited_at, e.created_at)') : sql.raw('e.created_at')} as at, e.enquiry_no, ${name('p')} as name, p.phone, co.title as course, l.value as source, e.status::text as status, u.name as assigned
      from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id left join lookups l on l.id = e.source_id left join users u on u.id = e.assigned_to
      where ${inBranch('e.branch_id')} and e.visited = ${visited} and ${onDay(ist(visited ? 'coalesce(e.visited_at, e.created_at)' : 'e.created_at'))}
      order by at limit ${LIMIT}`)
    detail.leads = (await ofDay(false)).map((r) => ({ at: new Date(r.at).toISOString(), enquiryNo: r.enquiry_no, name: r.name, phone: r.phone, course: r.course, source: r.source, status: r.status, assignedTo: r.assigned }))
    detail.visits = (await ofDay(true)).map((r) => ({ at: new Date(r.at).toISOString(), enquiryNo: r.enquiry_no, name: r.name, phone: r.phone, course: r.course, status: r.status, assignedTo: r.assigned }))
    const fu = await rows<{ enquiry_no: string; name: string; phone: string; course: string | null; status: string; assigned: string | null; visited: boolean }>(sql`
      select e.enquiry_no, ${name('p')} as name, p.phone, co.title as course, e.status::text as status, u.name as assigned, e.visited
      from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id left join users u on u.id = e.assigned_to
      where ${inBranch('e.branch_id')} and e.status not in ('joined', 'not_joined', 'dead') and ${onDay(sql`e.next_follow_up`)}
      order by name limit ${LIMIT}`)
    detail.followUps.unshift(...fu.map((r) => ({ kind: 'Lead' as const, ref: r.enquiry_no, name: r.name, phone: r.phone, course: r.course, status: r.status, assignedTo: r.assigned })))
  }
  if (show.webLeads) {
    const w = await rows<{ at: string; name: string; phone: string | null; course: string | null; site: string; enquiry_no: string | null; branch_id: string | null }>(sql`
      select w.submitted_at as at, w.name, w.phone, w.course, w.site_host as site, e.enquiry_no, w.branch_id
      from web_leads w left join enquiries e on e.id = w.enquiry_id
      where (${b}::uuid is null or w.branch_id = ${b}::uuid) and ${onDay(ist('w.submitted_at'))} order by at limit ${LIMIT}`)
    detail.webLeads = w.map((r) => ({ at: new Date(r.at).toISOString(), name: r.name, phone: r.phone, course: r.course, site: r.site, enquiryNo: r.enquiry_no, waiting: !r.branch_id }))
  }
  if (show.registrations) {
    const r = await rows<{ reg_no: string; name: string; phone: string; course: string | null; fee: number; status: string }>(sql`
      select r.reg_no, ${name('p')} as name, p.phone, coalesce(co.title, r.custom_course_title) as course, r.total_fee as fee, r.status::text as status
      from registrations r join persons p on p.id = r.person_id left join courses co on co.id = r.course_id
      where ${inBranch('r.branch_id')} and ${onDay(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN} order by r.created_at limit ${LIMIT}`)
    detail.registrations = r.map((x) => ({ regNo: x.reg_no, name: x.name, phone: x.phone, course: x.course, fee: n(x.fee), status: x.status }))
  }
  if (show.payments) {
    const p = await rows<{ at: string; receipt_no: string; name: string; reg_no: string; mode: string; amount: number }>(sql`
      select pay.paid_at as at, rc.receipt_no, ${name('pe')} as name, r.reg_no, coalesce(m.value, '') as mode, pay.amount
      from v_live_payments pay join receipts rc on rc.payment_id = pay.id join registrations r on r.id = pay.registration_id join persons pe on pe.id = r.person_id left join lookups m on m.id = pay.mode_id
      where ${inBranch('pay.branch_id')} and ${onDay(ist('pay.paid_at'))} order by pay.paid_at limit ${LIMIT}`)
    detail.payments = p.map((x) => ({ at: new Date(x.at).toISOString(), receiptNo: x.receipt_no, name: x.name, regNo: x.reg_no, mode: x.mode, amount: n(x.amount) }))
  }

  return { view: q.view, month: q.month, from: q.from, to: q.to, gridFrom: q.gridFrom, gridTo: q.gridTo, today: q.today, show, days, totals, detail }
}
