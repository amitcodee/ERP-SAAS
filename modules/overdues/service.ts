// Overdues: leads whose follow-up date has passed, and fees whose installment date has passed — escalated on their
// own as days go by: after `manager` days to the branch manager, after `head office` days to head office (super admin)
// (Settings → Rules). The level is worked out from the dates, so it is always current: nothing to store or clear;
// following a lead up (a new date) or taking the payment ends it. The daily job mails each one what reached them.
import { sql, type SQL } from 'drizzle-orm'
import { can } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { RULES } from '@/modules/settings/service'

export type Level = 0 | 1 | 2 // 0: overdue, with its owner; 1: with the branch manager; 2: with head office
export type Thresholds = { leadManager: number; leadHeadOffice: number; feeManager: number; feeHeadOffice: number }
export type OverdueLead = {
  kind: 'enquiry' | 'call'; id: string; name: string; phone: string; course: string | null; status: string; interestPct: number | null
  dueOn: string; days: number; level: Level; branch: string; owner: string | null; ownerId: string | null
}
export type OverdueFee = {
  registrationId: string; regNo: string; name: string; phone: string; course: string | null; overdue: number; balance: number
  installments: number; oldestDue: string; days: number; level: Level; branch: string; owner: string | null; ownerId: string | null
}
export type OverdueQuery = { tab?: string; level?: string; age?: string; kind?: string; mine?: string; branch?: string; q?: string }
export type Overdues = {
  tab: 'leads' | 'fees'; can: { leads: boolean; fees: boolean }; thresholds: Thresholds
  counts: { leads: Record<'all' | 'owner' | 'manager' | 'headOffice', number>; fees: Record<'all' | 'owner' | 'manager' | 'headOffice', number> & { amount: number } }
  leads: OverdueLead[]; fees: OverdueFee[]; total: number
}

const LIMIT = 300
const num = (v: unknown) => Number(v ?? 0)

/** The escalation days from Settings → Rules (head office never before the branch manager). */
export async function thresholds(tx: Tx): Promise<Thresholds> {
  const rows = (await tx.execute<{ key: string; value: unknown }>(sql`select key, value from settings where branch_id is null and key like 'escalation.%'`)).rows
  const v = (k: keyof typeof RULES) => { const r = rows.find((x) => x.key === k); return r ? Number(r.value) : RULES[k].fallback }
  const leadManager = v('escalation.lead_manager_days'), feeManager = v('escalation.fee_manager_days')
  return { leadManager, leadHeadOffice: Math.max(leadManager, v('escalation.lead_head_office_days')), feeManager, feeHeadOffice: Math.max(feeManager, v('escalation.fee_head_office_days')) }
}

const level = (days: SQL, manager: number, head: number) => sql`(case when ${days} >= ${head} then 2 when ${days} >= ${manager} then 1 else 0 end)`

/** Every open lead (enquiry or random call) past its follow-up date. */
export function overdueLeadsSql(t: Thresholds, where: SQL = sql`true`) {
  return sql`
    with l as (
      select 'enquiry' as kind, e.id, e.branch_id, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, co.title as course,
        e.status::text as status, e.interest_pct, e.next_follow_up as due_on, coalesce(e.assigned_to, e.created_by) as owner_id
      from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id
      where e.status not in ('joined', 'not_joined', 'dead') and e.next_follow_up < current_date
      union all
      select 'call', c.id, c.branch_id, trim(coalesce(p.first_name, 'Caller') || ' ' || coalesce(p.last_name, '')), coalesce(p.phone, ''), co.title,
        coalesce(c.status, 'Open'), c.interest_pct, c.follow_up_date, coalesce(c.assigned_to, c.received_by)
      from calls c left join persons p on p.id = c.person_id left join courses co on co.id = c.course_id
      where c.follow_up_date < current_date and c.enquiry_id is null and coalesce(c.status, '') not in ('Dead lead', 'Visited')
    ), x as (select l.*, (current_date - l.due_on) as days from l)
    select x.*, ${level(sql`x.days`, t.leadManager, t.leadHeadOffice)} as level, b.name as branch, u.name as owner
    from x join branches b on b.id = x.branch_id left join users u on u.id = x.owner_id
    where ${where}`
}

/** Every registration with an installment past its date and money still due (the amount overdue, never above the balance). */
export function overdueFeesSql(t: Thresholds, where: SQL = sql`true`) {
  return sql`
    with d as (
      select i.registration_id, sum(i.amount)::bigint as amount, count(*)::int as n, min(i.due_date) as oldest
      from installments i where i.status = 'scheduled' and i.due_date < current_date group by i.registration_id
    ), x as (
      select r.id as registration_id, r.reg_no, r.branch_id, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone,
        coalesce(co.title, r.custom_course_title) as course, least(d.amount, fb.balance)::bigint as overdue, fb.balance::bigint as balance,
        d.n as installments, d.oldest as oldest_due, (current_date - d.oldest) as days, r.created_by as owner_id
      from d join registrations r on r.id = d.registration_id join persons p on p.id = r.person_id
        join v_fee_balance fb on fb.registration_id = r.id left join courses co on co.id = r.course_id
      where r.status in ('active', 'on_hold') and fb.balance > 0 -- students still studying, as on the Fees page and in Reports
    )
    select x.*, ${level(sql`x.days`, t.feeManager, t.feeHeadOffice)} as level, b.name as branch, u.name as owner
    from x join branches b on b.id = x.branch_id left join users u on u.id = x.owner_id
    where ${where}`
}

export async function overdues(tx: Tx, actor: Actor, q: OverdueQuery = {}): Promise<Overdues> {
  const canLeads = can(actor, 'read', 'enquiry') || can(actor, 'read', 'call')
  const canFees = can(actor, 'read', 'fee')
  if (!canLeads && !canFees) throw new Error('Forbidden: overdues')
  const tab: Overdues['tab'] = q.tab === 'fees' ? (canFees ? 'fees' : 'leads') : canLeads ? 'leads' : 'fees'
  const t = await thresholds(tx)

  // the branch worked in (head office: all, or the one picked here / in the sidebar)
  const branch = actor.branchId ?? (q.branch && /^[0-9a-f-]{36}$/i.test(q.branch) ? q.branch : null)
  const scope = sql`(${branch}::uuid is null or x.branch_id = ${branch}::uuid)`
  const like = q.q?.trim() ? `%${q.q.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null
  const common: SQL[] = [scope]
  if (q.mine === '1') common.push(sql`x.owner_id = ${actor.userId}`)
  const age = { '1-7': [1, 7], '8-30': [8, 30], '31-90': [31, 90], '90+': [91, 100000] }[q.age ?? '']
  if (age) common.push(sql`x.days between ${age[0]} and ${age[1]}`)
  // each list its own extras: the kind of lead; a registration number to search fees by
  const leadF = [...common, ...(like ? [sql`(x.name ilike ${like} or x.phone ilike ${like})`] : []), ...(q.kind === 'enquiry' || q.kind === 'call' ? [sql`x.kind = ${q.kind}`] : [])]
  const feeF = [...common, ...(like ? [sql`(x.name ilike ${like} or x.phone ilike ${like} or x.reg_no ilike ${like})`] : [])]
  const leadWhere = sql.join(leadF, sql` and `), feeWhere = sql.join(feeF, sql` and `)
  const lv = { owner: 0, manager: 1, head_office: 2 }[q.level ?? ''] as Level | undefined
  const byLevel = lv === undefined ? sql`true` : sql`y.level = ${lv}`

  const count = async (body: SQL, money: boolean) => {
    const [c] = (await tx.execute<Record<string, unknown>>(sql`select count(*)::int as all,
        count(*) filter (where level = 0)::int as owner, count(*) filter (where level = 1)::int as manager, count(*) filter (where level = 2)::int as head
        ${money ? sql`, coalesce(sum(overdue), 0)::bigint as amount` : sql``}
      from (${body}) y`)).rows
    return { all: num(c?.all), owner: num(c?.owner), manager: num(c?.manager), headOffice: num(c?.head), amount: num(c?.amount) }
  }
  const leadCounts = canLeads ? await count(overdueLeadsSql(t, leadWhere), false) : { all: 0, owner: 0, manager: 0, headOffice: 0 }
  const feeCounts = canFees ? await count(overdueFeesSql(t, feeWhere), true) : { all: 0, owner: 0, manager: 0, headOffice: 0, amount: 0 }

  const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
  let leads: OverdueLead[] = [], fees: OverdueFee[] = []
  if (tab === 'leads') {
    leads = (await tx.execute<Record<string, unknown>>(sql`select * from (${overdueLeadsSql(t, leadWhere)}) y where ${byLevel} order by y.level desc, y.days desc, y.name limit ${LIMIT}`)).rows.map((r) => ({
      kind: r.kind as OverdueLead['kind'], id: String(r.id), name: String(r.name), phone: String(r.phone ?? ''), course: (r.course as string) ?? null, status: String(r.status),
      interestPct: r.interest_pct == null ? null : num(r.interest_pct), dueOn: iso(r.due_on), days: num(r.days), level: num(r.level) as Level, branch: String(r.branch),
      owner: (r.owner as string) ?? null, ownerId: (r.owner_id as string) ?? null,
    }))
  } else {
    fees = (await tx.execute<Record<string, unknown>>(sql`select * from (${overdueFeesSql(t, feeWhere)}) y where ${byLevel} order by y.level desc, y.days desc, y.overdue desc limit ${LIMIT}`)).rows.map((r) => ({
      registrationId: String(r.registration_id), regNo: String(r.reg_no), name: String(r.name), phone: String(r.phone ?? ''), course: (r.course as string) ?? null,
      overdue: num(r.overdue), balance: num(r.balance), installments: num(r.installments), oldestDue: iso(r.oldest_due), days: num(r.days), level: num(r.level) as Level,
      branch: String(r.branch), owner: (r.owner as string) ?? null, ownerId: (r.owner_id as string) ?? null,
    }))
  }
  const pick = (c: { all: number; owner: number; manager: number; headOffice: number }) => (lv === undefined ? c.all : [c.owner, c.manager, c.headOffice][lv])
  return {
    tab, can: { leads: canLeads, fees: canFees }, thresholds: t,
    counts: { leads: leadCounts, fees: feeCounts },
    leads, fees, total: pick(tab === 'leads' ? leadCounts : feeCounts),
  }
}

/** For the bell and the dashboard: what has reached this person (branch manager: level 1+ in their branch; head office: level 2). */
export async function escalatedToMe(tx: Tx, actor: Actor): Promise<{ leads: number; fees: number }> {
  const head = actor.role === 'super_admin'
  if (!head && !can(actor, 'read', 'overdue')) return { leads: 0, fees: 0 }
  const t = await thresholds(tx)
  const where = sql`(${actor.branchId}::uuid is null or x.branch_id = ${actor.branchId}::uuid)`
  const min = head ? 2 : 1
  const n = async (body: SQL) => num((await tx.execute<{ n: number }>(sql`select count(*)::int as n from (${body}) y where y.level >= ${min}`)).rows[0]?.n)
  return {
    leads: can(actor, 'read', 'enquiry') || can(actor, 'read', 'call') ? await n(overdueLeadsSql(t, where)) : 0,
    fees: can(actor, 'read', 'fee') ? await n(overdueFeesSql(t, where)) : 0,
  }
}
