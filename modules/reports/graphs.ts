// Graphs: the admissions work over a period, drawn day by day (or month by month for long periods), plus where the
// leads came from, how far they got, which courses they asked for, and who did the work. Days are India days (IST).
// RLS decides which rows count; branchId only narrows head office.
import { sql, type SQL } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { NOT_TRANSFERRED_IN } from '@/lib/report-filters'

export type GraphPoint = { key: string; calls: number; leads: number; visits: number; registrations: number; collected: number }
export type Ranked = { name: string; count: number; extra?: number }
export type Graphs = {
  from: string; to: string; by: 'day' | 'month'
  series: GraphPoint[]
  totals: Omit<GraphPoint, 'key'>
  funnel: { leads: number; visited: number; demo: number; registered: number; dead: number }
  sources: Ranked[] // leads per source; extra = how many of them registered
  courses: Ranked[] // leads per course asked for; extra = registrations for that course
  staff: { name: string; calls: number; visits: number; registrations: number }[]
  branches: { name: string; leads: number; registrations: number; collected: number }[]
  months: { key: string; leads: number; registrations: number; collected: number }[] // the last 12 months to the period's end
  regCourses: { name: string; count: number; fee: number }[] // registrations in the period per course, with the fees agreed
  departments: { name: string; count: number }[] // registrations per department
  statuses: { name: string; count: number }[] // the period's leads by where they stand now
  modes: { name: string; count: number; total: number }[] // money by mode of payment
}

export async function graphs(tx: Tx, actor: Actor, q: { from: string; to: string; branchId: string | null }): Promise<Graphs> {
  assertCan(actor, 'read', 'report')
  const b = q.branchId
  const rows = async <T>(query: SQL) => (await tx.execute<T & Record<string, unknown>>(query)).rows
  const n = (v: unknown) => Number(v ?? 0)
  const inBranch = (col: string) => sql`(${b}::uuid is null and ${sql.raw(col)} in (select id from branches where is_active) or ${sql.raw(col)} = ${b}::uuid)`
  const ist = (col: string) => sql.raw(`(${col} at time zone 'Asia/Kolkata')::date`)
  const between = (expr: SQL) => sql`${expr} between ${q.from}::date and ${q.to}::date`

  // Up to ~3 months: one point a day; longer: one a month.
  const spanDays = (Date.parse(q.to) - Date.parse(q.from)) / 86400000 + 1
  const by: 'day' | 'month' = spanDays > 92 ? 'month' : 'day'
  const bucket = (expr: SQL) => (by === 'day' ? sql`to_char(${expr}, 'YYYY-MM-DD')` : sql`to_char(${expr}, 'YYYY-MM')`)

  const visitAt = 'coalesce(e.visited_at, e.created_at)'
  // one transaction runs one query at a time, so these go in turn
  const calls = await rows<{ k: string; n: number }>(sql`select ${bucket(ist('c.called_at'))} as k, count(*)::int as n from calls c where ${inBranch('c.branch_id')} and ${between(ist('c.called_at'))} group by 1`)
  const leads = await rows<{ k: string; n: number }>(sql`select ${bucket(ist('e.created_at'))} as k, count(*)::int as n from enquiries e where ${inBranch('e.branch_id')} and ${between(ist('e.created_at'))} group by 1`)
  const visits = await rows<{ k: string; n: number }>(sql`select ${bucket(ist(visitAt))} as k, count(*)::int as n from enquiries e where ${inBranch('e.branch_id')} and e.visited and ${between(ist(visitAt))} group by 1`)
  const regs = await rows<{ k: string; n: number }>(sql`select ${bucket(sql`r.enrollment_date`)} as k, count(*)::int as n from registrations r where ${inBranch('r.branch_id')} and ${between(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN} group by 1`)
  const money = await rows<{ k: string; n: number }>(sql`select ${bucket(ist('p.paid_at'))} as k, sum(p.amount)::bigint as n from v_live_payments p where ${inBranch('p.branch_id')} and ${between(ist('p.paid_at'))} group by 1`)

  // every day/month of the period, zero-filled, so the lines do not skip quiet days
  const keys: string[] = []
  const cur = new Date(`${q.from}T00:00:00Z`), end = new Date(`${q.to}T00:00:00Z`)
  if (by === 'month') cur.setUTCDate(1)
  while (cur <= end) {
    keys.push(by === 'day' ? cur.toISOString().slice(0, 10) : cur.toISOString().slice(0, 7))
    if (by === 'day') cur.setUTCDate(cur.getUTCDate() + 1); else cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  const map = (list: { k: string; n: number }[]) => new Map(list.map((r) => [r.k, n(r.n)]))
  const [mc, ml, mv, mr, mm] = [map(calls), map(leads), map(visits), map(regs), map(money)]
  const series = keys.map((k) => ({ key: k, calls: mc.get(k) ?? 0, leads: ml.get(k) ?? 0, visits: mv.get(k) ?? 0, registrations: mr.get(k) ?? 0, collected: mm.get(k) ?? 0 }))
  const totals = series.reduce((t, s) => ({ calls: t.calls + s.calls, leads: t.leads + s.leads, visits: t.visits + s.visits, registrations: t.registrations + s.registrations, collected: t.collected + s.collected }), { calls: 0, leads: 0, visits: 0, registrations: 0, collected: 0 })

  // the leads that came in during the period, and how far each one got (to today)
  const [f] = await rows<{ leads: number; visited: number; demo: number; registered: number; dead: number }>(sql`
    select count(*)::int as leads, count(*) filter (where e.visited)::int as visited,
      count(*) filter (where exists (select 1 from enquiry_events v where v.enquiry_id = e.id and v.to_status = 'demo'))::int as demo,
      count(*) filter (where exists (select 1 from registrations r where r.enquiry_id = e.id))::int as registered,
      count(*) filter (where e.status = 'dead')::int as dead
    from enquiries e where ${inBranch('e.branch_id')} and ${between(ist('e.created_at'))}`)

  const sources = await rows<{ name: string; count: number; extra: number }>(sql`
    select coalesce(l.value, 'Not recorded') as name, count(*)::int as count, count(*) filter (where exists (select 1 from registrations r where r.enquiry_id = e.id))::int as extra
    from enquiries e left join lookups l on l.id = e.source_id where ${inBranch('e.branch_id')} and ${between(ist('e.created_at'))}
    group by 1 order by count desc limit 10`)
  const courses = await rows<{ name: string; count: number; extra: number }>(sql`
    select coalesce(co.title, 'Not chosen yet') as name, count(*)::int as count, count(*) filter (where exists (select 1 from registrations r where r.enquiry_id = e.id))::int as extra
    from enquiries e left join courses co on co.id = e.course_id where ${inBranch('e.branch_id')} and ${between(ist('e.created_at'))}
    group by 1 order by count desc limit 10`)
  const staff = await rows<{ name: string; calls: number; visits: number; registrations: number }>(sql`
    select u.name,
      (select count(*)::int from calls c where c.received_by = u.id and ${inBranch('c.branch_id')} and ${between(ist('c.called_at'))})
        + (select count(*)::int from call_followups f where f.by_user = u.id and ${inBranch('f.branch_id')} and ${between(ist('f.called_at'))}) as calls,
      (select count(*)::int from enquiries e where e.assigned_to = u.id and e.visited and ${inBranch('e.branch_id')} and ${between(ist(visitAt))}) as visits,
      (select count(*)::int from registrations r where r.created_by = u.id and ${inBranch('r.branch_id')} and ${between(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN}) as registrations
    from users u where u.deleted_at is null and u.is_active`)
  const branches = await rows<{ name: string; leads: number; registrations: number; collected: number }>(sql`
    select br.name,
      (select count(*)::int from enquiries e where e.branch_id = br.id and ${between(ist('e.created_at'))}) as leads,
      (select count(*)::int from registrations r where r.branch_id = br.id and ${between(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN}) as registrations,
      (select coalesce(sum(p.amount), 0)::bigint from v_live_payments p where p.branch_id = br.id and ${between(ist('p.paid_at'))}) as collected
    from branches br where br.is_active and (${b}::uuid is null or br.id = ${b}::uuid) order by br.name`)

  const months = await rows<{ k: string; leads: number; registrations: number; collected: number }>(sql`
    with m as (select to_char(g, 'YYYY-MM') as k from generate_series(date_trunc('month', ${q.to}::date) - interval '11 months', date_trunc('month', ${q.to}::date), interval '1 month') g)
    select m.k,
      (select count(*)::int from enquiries e where ${inBranch('e.branch_id')} and to_char(${ist('e.created_at')}, 'YYYY-MM') = m.k) as leads,
      (select count(*)::int from registrations r where ${inBranch('r.branch_id')} and to_char(r.enrollment_date, 'YYYY-MM') = m.k and ${NOT_TRANSFERRED_IN}) as registrations,
      (select coalesce(sum(p.amount), 0)::bigint from v_live_payments p where ${inBranch('p.branch_id')} and to_char(${ist('p.paid_at')}, 'YYYY-MM') = m.k) as collected
    from m order by m.k`)
  const regCourses = await rows<{ name: string; count: number; fee: number }>(sql`
    select coalesce(co.title, r.custom_course_title, 'Custom course') as name, count(*)::int as count, sum(r.total_fee)::bigint as fee
    from registrations r left join courses co on co.id = r.course_id where ${inBranch('r.branch_id')} and ${between(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN}
    group by 1 order by count desc limit 10`)
  const departments = await rows<{ name: string; count: number }>(sql`
    select coalesce(d.name, 'Other') as name, count(*)::int as count
    from registrations r left join departments d on d.id = r.department_id where ${inBranch('r.branch_id')} and ${between(sql`r.enrollment_date`)} and ${NOT_TRANSFERRED_IN}
    group by 1 order by count desc limit 8`)
  const statuses = await rows<{ name: string; count: number }>(sql`
    select e.status::text as name, count(*)::int as count from enquiries e where ${inBranch('e.branch_id')} and ${between(ist('e.created_at'))} group by 1 order by count desc`)
  const modes = await rows<{ name: string; count: number; total: number }>(sql`
    select coalesce(m.value, 'Other') as name, count(*)::int as count, sum(p.amount)::bigint as total
    from v_live_payments p left join lookups m on m.id = p.mode_id where ${inBranch('p.branch_id')} and ${between(ist('p.paid_at'))} group by 1 order by total desc`)

  return {
    from: q.from, to: q.to, by, series, totals,
    months: months.map((m) => ({ key: m.k, leads: n(m.leads), registrations: n(m.registrations), collected: n(m.collected) })),
    regCourses: regCourses.map((r) => ({ name: r.name, count: n(r.count), fee: n(r.fee) })),
    departments: departments.map((r) => ({ name: r.name, count: n(r.count) })),
    statuses: statuses.map((r) => ({ name: r.name, count: n(r.count) })),
    modes: modes.map((r) => ({ name: r.name, count: n(r.count), total: n(r.total) })),
    funnel: { leads: n(f?.leads), visited: n(f?.visited), demo: n(f?.demo), registered: n(f?.registered), dead: n(f?.dead) },
    sources: sources.map((s) => ({ name: s.name, count: n(s.count), extra: n(s.extra) })),
    courses: courses.map((s) => ({ name: s.name, count: n(s.count), extra: n(s.extra) })),
    staff: staff.map((s) => ({ name: s.name, calls: n(s.calls), visits: n(s.visits), registrations: n(s.registrations) }))
      .filter((s) => s.calls + s.visits + s.registrations > 0).sort((a, c) => c.calls + c.visits * 3 + c.registrations * 10 - (a.calls + a.visits * 3 + a.registrations * 10)).slice(0, 12),
    branches: branches.map((r) => ({ name: r.name, leads: n(r.leads), registrations: n(r.registrations), collected: n(r.collected) })),
  }
}
