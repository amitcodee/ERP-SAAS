// Lead distribution: head office (all branches) or a branch head (own branch, by RLS) hands cold/unworked enquiries
// to telecallers, evenly, oldest first. A telecaller then works them from "My leads", even across branches
// (see the lead policies in migration 0027).
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

export const LEAD_STATUSES = ['new', 'contacted', 'follow_up', 'not_joined', 'dead'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type Telecaller = { id: string; name: string; branchCode: string | null; openLeads: number }

/** People who can work a lead queue: active users holding any role with lead:read (or super admin). */
export async function listTelecallers(tx: Tx, actor: Actor): Promise<Telecaller[]> {
  assertCan(actor, 'assign', 'lead')
  const res = await tx.execute<{ id: string; name: string; code: string | null; open: number }>(sql`
    select u.id, u.name, b.code,
      (select count(*)::int from enquiries e where e.assigned_to = u.id and e.status not in ('joined', 'dead'))
        + (select count(*)::int from calls k where k.assigned_to = u.id and k.enquiry_id is null and coalesce(k.status, '') <> 'Dead lead') as open
    from users u left join branches b on b.id = u.branch_id
    where u.is_active and u.deleted_at is null
      and exists (select 1 from user_roles ur join roles r on r.key = ur.role where ur.user_id = u.id and 'lead:read' = any(r.permissions) and r.kind = 'staff')
    order by u.name`)
  return res.rows.map((r) => ({ id: r.id, name: r.name, branchCode: r.code, openLeads: Number(r.open) }))
}

export const poolInput = z.object({
  /** all = leads and visited enquiries · lead = not visited yet · visited = came to the office · call = random calls that have not visited */
  kind: z.enum(['all', 'lead', 'visited', 'call']).default('all'),
  branchId: z.string().uuid().optional().nullable(), // super admin: one branch or all (null)
  categoryId: z.union([z.string().uuid(), z.literal('none')]).optional().nullable(), // a lead category, 'none' = no category yet, null = any
  statuses: z.array(z.enum(LEAD_STATUSES)).min(1, 'Pick at least one status'),
  unassignedOnly: z.boolean().default(true),
  olderThanDays: z.number().int().min(0).max(3650).default(0), // "cold": untouched for N days
})
export type PoolInput = z.input<typeof poolInput>

const poolWhere = (i: z.infer<typeof poolInput>, actor: Actor) => sql`
  e.status = any(${`{${i.statuses.join(',')}}`}::enquiry_status[])
  and (${i.kind !== 'lead'} or not e.visited) and (${i.kind !== 'visited'} or e.visited)
  and (${i.branchId ?? null}::uuid is null or e.branch_id = ${i.branchId ?? null})
  and (${i.categoryId == null} or (${i.categoryId === 'none'} and e.category_id is null) or e.category_id = ${i.categoryId && i.categoryId !== 'none' ? i.categoryId : null}::uuid)
  and (${actor.role === 'super_admin'} or e.branch_id = ${actor.branchId})
  and (${!i.unassignedOnly} or e.assigned_to is null)
  and e.updated_at <= now() - make_interval(days => ${i.olderThanDays})`

/** Random calls that can still be handed out: not visited yet, not a dead lead. "Untouched" counts from the last call made on it. */
const callPoolWhere = (i: z.infer<typeof poolInput>, actor: Actor) => sql`
  k.enquiry_id is null and coalesce(k.status, '') <> 'Dead lead'
  and (${i.branchId ?? null}::uuid is null or k.branch_id = ${i.branchId ?? null})
  and (${i.categoryId == null} or (${i.categoryId === 'none'} and k.category_id is null) or k.category_id = ${i.categoryId && i.categoryId !== 'none' ? i.categoryId : null}::uuid)
  and (${actor.role === 'super_admin'} or k.branch_id = ${actor.branchId})
  and (${!i.unassignedOnly} or k.assigned_to is null)
  and greatest(k.called_at, coalesce((select max(f.called_at) from call_followups f where f.call_id = k.id), k.called_at)) <= now() - make_interval(days => ${i.olderThanDays})`

/** How many leads match (shown before distributing). */
export async function leadPool(tx: Tx, actor: Actor, raw: PoolInput): Promise<{ available: number; byBranch: { code: string; n: number }[]; byCategory: { name: string; n: number }[] }> {
  assertCan(actor, 'assign', 'lead')
  const i = poolInput.parse(raw)
  if (i.kind === 'call') {
    const byBranch = (await tx.execute<{ code: string; n: number }>(sql`select b.code, count(*)::int as n from calls k join branches b on b.id = k.branch_id where ${callPoolWhere(i, actor)} group by b.code order by b.code`)).rows
    const byCat = (await tx.execute<{ name: string; n: number }>(sql`select coalesce(lc.name, 'No category') as name, count(*)::int as n from calls k left join lead_categories lc on lc.id = k.category_id where ${callPoolWhere(i, actor)} group by 1 order by 2 desc, 1`)).rows
    return { available: byBranch.reduce((s, r) => s + Number(r.n), 0), byBranch: byBranch.map((r) => ({ code: r.code, n: Number(r.n) })), byCategory: byCat.map((r) => ({ name: r.name, n: Number(r.n) })) }
  }
  const rows = (await tx.execute<{ code: string; n: number }>(sql`
    select b.code, count(*)::int as n from enquiries e join branches b on b.id = e.branch_id where ${poolWhere(i, actor)} group by b.code order by b.code`)).rows
  const cats = (await tx.execute<{ name: string; n: number }>(sql`
    select coalesce(lc.name, 'No category') as name, count(*)::int as n from enquiries e left join lead_categories lc on lc.id = e.category_id where ${poolWhere(i, actor)} group by 1 order by 2 desc, 1`)).rows
  return { available: rows.reduce((s, r) => s + Number(r.n), 0), byBranch: rows.map((r) => ({ code: r.code, n: Number(r.n) })), byCategory: cats.map((r) => ({ name: r.name, n: Number(r.n) })) }
}

export type PoolLead = {
  id: string; ref: string | null; name: string; phone: string | null; branch: string | null; category: string | null; status: string | null
  assignedToId: string | null; assignedTo: string | null; touchedAt: string
}

/** The matching leads themselves (oldest first, the order they are handed out in), for ticking on the screen. */
export async function poolList(tx: Tx, actor: Actor, raw: PoolInput): Promise<PoolLead[]> {
  assertCan(actor, 'assign', 'lead')
  const i = poolInput.parse(raw)
  type Row = { id: string; ref: string | null; name: string | null; phone: string | null; branch: string | null; category: string | null; status: string | null; assigned_to: string | null; assigned_name: string | null; touched: Date }
  const res = await tx.execute<Row>(i.kind === 'call'
    ? sql`select k.id, null as ref, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, b.code as branch, lc.name as category, k.status, k.assigned_to, u.name as assigned_name, k.called_at as touched
        from calls k left join persons p on p.id = k.person_id left join branches b on b.id = k.branch_id left join lead_categories lc on lc.id = k.category_id left join users u on u.id = k.assigned_to
        where ${callPoolWhere(i, actor)} order by k.called_at limit 500`
    : sql`select e.id, e.enquiry_no as ref, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, b.code as branch, lc.name as category, e.status::text as status, e.assigned_to, u.name as assigned_name, e.updated_at as touched
        from enquiries e join persons p on p.id = e.person_id left join branches b on b.id = e.branch_id left join lead_categories lc on lc.id = e.category_id left join users u on u.id = e.assigned_to
        where ${poolWhere(i, actor)} order by e.updated_at, e.created_at limit 500`)
  return res.rows.map((r) => ({
    id: r.id, ref: r.ref, name: r.name ?? '—', phone: r.phone, branch: r.branch, category: r.category, status: r.status, assignedToId: r.assigned_to,
    assignedTo: r.assigned_to ? r.assigned_name ?? 'Staff of another branch' : null, touchedAt: new Date(r.touched).toISOString(),
  }))
}

export const distributeInput = poolInput.extend({
  /** Hand out exactly these leads (ticked on the screen), whoever holds them now. Left out = the oldest matching leads. */
  leadIds: z.array(z.string().uuid()).max(1000).optional(),
  telecallerIds: z.array(z.string().uuid()).min(1, 'Pick at least one telecaller'),
  perPerson: z.number().int().min(1).max(500),
})
export type DistributeInput = z.input<typeof distributeInput>

/** Round-robin, oldest lead first, at most perPerson each. Returns how many each person got. */
export async function distributeLeads(tx: Tx, actor: Actor, raw: DistributeInput) {
  assertCan(actor, 'assign', 'lead')
  const i = distributeInput.parse(raw)
  const people = await listTelecallers(tx, actor)
  const chosen = [...new Set(i.telecallerIds)].map((id) => people.find((p) => p.id === id))
  if (chosen.some((p) => !p)) throw new Error('Pick telecallers from the list (someone chosen cannot work leads, or is not in your branch)')
  // Ticked leads are handed out as chosen, including ones somebody already holds (the screen asks before sending those).
  const ids = i.leadIds?.length ? `{${[...new Set(i.leadIds)].join(',')}}` : null
  const scope = ids ? { ...i, unassignedOnly: false } : i
  const leads = (await tx.execute<{ id: string }>(i.kind === 'call'
    ? sql`select k.id from calls k where ${callPoolWhere(scope, actor)} and (${ids}::uuid[] is null or k.id = any(${ids}::uuid[])) order by k.called_at limit ${i.perPerson * chosen.length} for update skip locked`
    : sql`select e.id from enquiries e where ${poolWhere(scope, actor)} and (${ids}::uuid[] is null or e.id = any(${ids}::uuid[])) order by e.updated_at, e.created_at limit ${i.perPerson * chosen.length} for update skip locked`)).rows
  if (!leads.length) throw new Error('No leads match these filters')
  const counts: Record<string, number> = {}
  for (let n = 0; n < leads.length; n++) {
    const p = chosen[n % chosen.length]!
    await tx.execute(i.kind === 'call'
      ? sql`update calls set assigned_to = ${p.id}, assigned_at = now() where id = ${leads[n].id}`
      : sql`update enquiries set assigned_to = ${p.id}, assigned_at = now() where id = ${leads[n].id}`)
    counts[p.id] = (counts[p.id] ?? 0) + 1
  }
  const result = chosen.map((p) => ({ id: p!.id, name: p!.name, assigned: counts[p!.id] ?? 0 }))
  await audit(tx, actor, { action: 'distribute_leads', entity: i.kind === 'call' ? 'call' : 'enquiry', after: { filters: { kind: i.kind, branchId: i.branchId ?? 'all', categoryId: i.categoryId ?? 'all', statuses: i.statuses, unassignedOnly: i.unassignedOnly, olderThanDays: i.olderThanDays }, result } })
  return { total: leads.length, result }
}

export type LeadProgress = {
  id: string; name: string; branchCode: string | null
  total: number; worked: number; called: number; due: number; visited: number; joined: number; lost: number; lastActivity: string | null
}

/**
 * What each person has done with the leads given to them (the leads this actor may see: own branch, or all for head office).
 * worked = called, or moved off "New". due = a follow-up date that is today or past on a lead still open.
 */
export async function leadProgress(tx: Tx, actor: Actor): Promise<LeadProgress[]> {
  assertCan(actor, 'assign', 'lead')
  const res = await tx.execute<{ id: string; name: string | null; code: string | null; total: number; worked: number; called: number; due: number; visited: number; joined: number; lost: number; last: Date | null }>(sql`
    select e.assigned_to as id, u.name, b.code,
      count(*)::int as total,
      count(*) filter (where e.call_done or e.status <> 'new')::int as worked,
      count(*) filter (where e.call_done)::int as called,
      count(*) filter (where e.next_follow_up <= current_date and e.status not in ('joined', 'dead'))::int as due,
      count(*) filter (where e.visited)::int as visited,
      count(*) filter (where e.status = 'joined')::int as joined,
      count(*) filter (where e.status in ('not_joined', 'dead'))::int as lost,
      max(e.updated_at) filter (where e.call_done or e.status <> 'new') as last
    from enquiries e left join users u on u.id = e.assigned_to left join branches b on b.id = u.branch_id
    where e.assigned_to is not null and e.assigned_at is not null
    group by e.assigned_to, u.name, b.code order by count(*) desc, u.name`)
  // Random calls handed out: worked = a follow-up call was made since it was given.
  const calls = await tx.execute<{ id: string; name: string | null; code: string | null; total: number; worked: number; due: number; visited: number; lost: number; last: Date | null }>(sql`
    select k.assigned_to as id, u.name, b.code,
      count(*)::int as total,
      count(*) filter (where fu.last >= k.assigned_at or k.enquiry_id is not null)::int as worked,
      count(*) filter (where k.follow_up_date <= current_date and k.enquiry_id is null and coalesce(k.status, '') <> 'Dead lead')::int as due,
      count(*) filter (where k.enquiry_id is not null)::int as visited,
      count(*) filter (where k.status = 'Dead lead')::int as lost,
      max(fu.last) filter (where fu.last >= k.assigned_at) as last
    from calls k left join users u on u.id = k.assigned_to left join branches b on b.id = u.branch_id
      left join lateral (select max(f.called_at) as last from call_followups f where f.call_id = k.id) fu on true
    where k.assigned_to is not null and k.assigned_at is not null
    group by k.assigned_to, u.name, b.code`)
  const byId = new Map<string, LeadProgress>()
  for (const r of res.rows) byId.set(r.id, {
    id: r.id, name: r.name ?? 'Staff of another branch', branchCode: r.code, total: r.total, worked: r.worked, called: r.called, due: r.due,
    visited: r.visited, joined: r.joined, lost: r.lost, lastActivity: r.last ? new Date(r.last).toISOString() : null,
  })
  for (const c of calls.rows) {
    const p = byId.get(c.id) ?? { id: c.id, name: c.name ?? 'Staff of another branch', branchCode: c.code, total: 0, worked: 0, called: 0, due: 0, visited: 0, joined: 0, lost: 0, lastActivity: null }
    const last = c.last ? new Date(c.last).toISOString() : null
    byId.set(c.id, { ...p, total: p.total + c.total, worked: p.worked + c.worked, called: p.called + c.worked, due: p.due + c.due, visited: p.visited + c.visited, lost: p.lost + c.lost, lastActivity: last && (!p.lastActivity || last > p.lastActivity) ? last : p.lastActivity })
  }
  return [...byId.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

export type PersonLeads = {
  leads: {
    kind: 'lead' | 'visited' | 'call'
    id: string; enquiryNo: string; name: string; phone: string; branch: string | null; category: string | null; status: string; visited: boolean
    interested: boolean | null; interestPct: number | null; callDone: boolean; callAt: string | null; callRemark: string | null; nextFollowUp: string | null; assignedAt: string | null
  }[]
  /** The calls and status changes this person recorded on those leads, newest first. */
  activity: { id: string; at: string; enquiryNo: string; name: string; fromStatus: string | null; toStatus: string; followUpDate: string | null; note: string | null }[]
}

/** The leads given to one person and what they recorded on them. */
export async function personLeads(tx: Tx, actor: Actor, rawUserId: string): Promise<PersonLeads> {
  assertCan(actor, 'assign', 'lead')
  const userId = z.string().uuid().parse(rawUserId)
  const leads = await tx.execute<{ id: string; enquiry_no: string; name: string; phone: string; branch: string | null; category: string | null; status: string; visited: boolean; interested: boolean | null; interest_pct: number | null; call_done: boolean; call_at: Date | null; call_remark: string | null; next_follow_up: string | null; assigned_at: Date | null }>(sql`
    select e.id, e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, b.code as branch, lc.name as category, e.status::text, e.visited,
      e.interested, e.interest_pct, e.call_done, e.call_at, e.call_remark, e.next_follow_up::text, e.assigned_at
    from enquiries e join persons p on p.id = e.person_id left join branches b on b.id = e.branch_id left join lead_categories lc on lc.id = e.category_id
    where e.assigned_to = ${userId} and e.assigned_at is not null
    order by e.updated_at desc limit 500`)
  const activity = await tx.execute<{ id: string; at: Date; enquiry_no: string; name: string; from_status: string | null; to_status: string; follow_up_date: string | null; note: string | null }>(sql`
    select ev.id, ev.at, e.enquiry_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, ev.from_status::text, ev.to_status::text, ev.follow_up_date::text, ev.note
    from enquiry_events ev join enquiries e on e.id = ev.enquiry_id join persons p on p.id = e.person_id
    where ev.by_user = ${userId} and e.assigned_to = ${userId} and ev.from_status is not null
    order by ev.at desc limit 100`)
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  const calls = await tx.execute<{ id: string; name: string | null; phone: string | null; branch: string | null; category: string | null; status: string | null; enquiry_id: string | null; interested: boolean | null; interest_pct: number | null; last: Date | null; call_remark: string | null; follow_up_date: string | null; assigned_at: Date | null }>(sql`
    select k.id, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, b.code as branch, lc.name as category, k.status, k.enquiry_id, k.interested, k.interest_pct,
      (select max(f.called_at) from call_followups f where f.call_id = k.id and f.called_at >= k.assigned_at) as last, k.call_remark, k.follow_up_date::text, k.assigned_at
    from calls k left join persons p on p.id = k.person_id left join branches b on b.id = k.branch_id left join lead_categories lc on lc.id = k.category_id
    where k.assigned_to = ${userId} and k.assigned_at is not null
    order by k.assigned_at desc limit 500`)
  const callActivity = await tx.execute<{ id: string; at: Date; name: string | null; status: string | null; next_follow_up: string | null; call_remark: string | null; remarks: string | null }>(sql`
    select f.id, f.called_at as at, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, f.status, f.next_follow_up::text, f.call_remark, f.remarks
    from call_followups f join calls k on k.id = f.call_id left join persons p on p.id = k.person_id
    where f.by_user = ${userId} and k.assigned_to = ${userId}
    order by f.called_at desc limit 100`)
  return {
    leads: [...leads.rows.map((l) => ({
      kind: (l.visited ? 'visited' : 'lead') as 'lead' | 'visited' | 'call',
      id: l.id, enquiryNo: l.enquiry_no, name: l.name, phone: l.phone, branch: l.branch, category: l.category, status: l.status, visited: l.visited, interested: l.interested,
      interestPct: l.interest_pct, callDone: l.call_done, callAt: iso(l.call_at), callRemark: l.call_remark, nextFollowUp: l.next_follow_up, assignedAt: iso(l.assigned_at),
    })), ...calls.rows.map((k) => ({
      kind: 'call' as const, id: k.id, enquiryNo: 'Random call', name: k.name ?? '—', phone: k.phone ?? '', branch: k.branch, category: k.category, status: k.status ?? 'No status', visited: !!k.enquiry_id,
      interested: k.interested, interestPct: k.interest_pct, callDone: !!k.last, callAt: iso(k.last), callRemark: k.call_remark, nextFollowUp: k.follow_up_date, assignedAt: iso(k.assigned_at),
    }))],
    activity: [
      ...activity.rows.map((a) => ({ id: a.id, at: new Date(a.at).toISOString(), enquiryNo: a.enquiry_no, name: a.name, fromStatus: a.from_status, toStatus: a.to_status, followUpDate: a.follow_up_date, note: a.note })),
      ...callActivity.rows.map((a) => ({ id: a.id, at: new Date(a.at).toISOString(), enquiryNo: 'Random call', name: a.name ?? '—', fromStatus: null, toStatus: a.status ?? 'Follow-up call', followUpDate: a.next_follow_up, note: [a.call_remark, a.remarks].filter(Boolean).join(' · ') || null })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1)),
  }
}
