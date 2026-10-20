// "My day": what a signed-in person should act on, built from THEIR permissions (so it follows their roles, and a
// person with several roles sees every matching section). RLS keeps every number inside their branch / their leads.
import { sql } from 'drizzle-orm'
import { can } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { canAnswerTickets, escalateOverdue } from '@/modules/support/service'
import { escalatedToMe } from '@/modules/overdues/service'
import { NOT_TRANSFERRED_IN } from '@/lib/report-filters'

export type HomeTile = { label: string; value: string; tone: 'blue' | 'amber' | 'green' | 'violet' | 'red'; goTo: string }
export type HomeSection = { title: string; tiles: HomeTile[] }

/** One line in the bell: something waiting for this person, how many, and the page that deals with it. */
export type Alert = { label: string; count: number; tone: 'amber' | 'red'; goTo: string }

/** The bell: every "My day" count that needs action (amber / red and not zero), plus call follow-ups that are due. */
export async function myAlerts(tx: Tx, actor: Actor): Promise<Alert[]> {
  const out: Alert[] = []
  if (can(actor, 'read', 'call')) {
    const all = actor.role === 'super_admin' && !actor.branchId
    const r = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from calls
      where follow_up_date <= current_date and enquiry_id is null and coalesce(status, '') <> 'Dead lead' and (${all} or branch_id = ${actor.branchId})`)).rows[0]
    if (Number(r?.n ?? 0) > 0) out.push({ label: 'Random-call follow-ups due today / overdue', count: Number(r.n), tone: 'amber', goTo: 'Random Call' })
  }
  if (can(actor, 'update', 'setting')) {
    // head office: IPs the sign-in ladder blocked in the last day
    const r = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ip_rules where kind = 'block' and auto and created_at > now() - interval '24 hours'`)).rows[0]
    if (Number(r?.n ?? 0) > 0) out.push({ label: 'IPs blocked for too many wrong passwords (last 24 h)', count: Number(r.n), tone: 'red', goTo: 'Sign-in Security' })
  }
  // overdue leads / fees that have climbed to this person (branch manager, head office)
  const up = await escalatedToMe(tx, actor)
  if (up.leads) out.push({ label: 'Overdue leads escalated to you', count: up.leads, tone: 'red', goTo: 'Overdues' })
  if (up.fees) out.push({ label: 'Overdue fees escalated to you', count: up.fees, tone: 'red', goTo: 'Overdues' })
  for (const t of (await myHome(tx, actor)).flatMap((s) => s.tiles)) {
    if ((t.tone === 'amber' || t.tone === 'red') && /^\d+$/.test(t.value) && Number(t.value) > 0) out.push({ label: t.label, count: Number(t.value), tone: t.tone, goTo: t.goTo })
  }
  return out
}

const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN')

export async function myHome(tx: Tx, actor: Actor): Promise<HomeSection[]> {
  const one = async (q: ReturnType<typeof sql>) => (await tx.execute<Record<string, number>>(q)).rows[0] ?? {}
  const n = (v: unknown) => Number(v ?? 0)
  const out: HomeSection[] = []

  // the help desk comes first (head office sees every branch's questions; a branch, its own)
  if (canAnswerTickets(actor)) {
    await escalateOverdue(tx)
    const r = await one(sql`select count(*) filter (where status = 'open')::int as waiting, count(*) filter (where status = 'answered')::int as answered,
        count(*) filter (where status = 'open' and due_at < now())::int as overdue, count(*) filter (where status <> 'closed' and escalation_level > 0)::int as escalated
      from support_tickets where (${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId}) and (${actor.role === 'super_admin'} or not to_head_office)`)
    out.push({ title: 'Help desk', tiles: [
      { label: 'Tickets waiting for a reply', value: String(n(r.waiting)), tone: n(r.waiting) ? 'red' : 'green', goTo: 'Help Desk' },
      { label: 'Past their reply time (SLA)', value: String(n(r.overdue)), tone: n(r.overdue) ? 'red' : 'green', goTo: 'Help Desk' },
      { label: 'Escalated', value: String(n(r.escalated)), tone: n(r.escalated) ? 'red' : 'green', goTo: 'Help Desk' },
      { label: 'Answered, waiting on the other side', value: String(n(r.answered)), tone: 'blue', goTo: 'Help Desk' },
    ] })
  }

  // every staff member: tickets given to them, and their own tickets that got an answer
  {
    const r = await one(sql`select count(*) filter (where assigned_to = ${actor.userId} and status = 'open')::int as mine,
        count(*) filter (where created_by = ${actor.userId} and kind = 'internal' and status = 'answered')::int as answered
      from support_tickets where assigned_to = ${actor.userId} or (created_by = ${actor.userId} and kind = 'internal')`)
    if (n(r.mine) || n(r.answered)) out.push({ title: 'My tickets', tiles: [
      { label: 'Given to me, waiting for my reply', value: String(n(r.mine)), tone: n(r.mine) ? 'red' : 'green', goTo: 'My Tickets' },
      { label: 'My tickets answered', value: String(n(r.answered)), tone: 'blue', goTo: 'My Tickets' },
    ] })
  }

  // whoever approves the syllabus (head office): changes the branches sent, waiting for approval
  if (can(actor, 'approve', 'teaching')) {
    const r = await one(sql`select count(*)::int as n from syllabus_changes where status = 'pending'`)
    if (n(r.n)) out.push({ title: 'Syllabus', tiles: [{ label: 'Syllabus changes waiting for approval', value: String(n(r.n)), tone: 'red', goTo: 'Courses' }] })
  }

  if (can(actor, 'read', 'lead')) {
    const r = await one(sql`select count(*) filter (where status not in ('joined', 'dead'))::int as open,
        count(*) filter (where status not in ('joined', 'dead') and next_follow_up <= current_date)::int as due
      from enquiries where assigned_to = ${actor.userId}`)
    out.push({ title: 'My leads', tiles: [
      { label: 'Open leads assigned to me', value: String(n(r.open)), tone: 'blue', goTo: 'My Leads' },
      { label: 'Call back today / overdue', value: String(n(r.due)), tone: n(r.due) ? 'amber' : 'green', goTo: 'My Leads' },
    ] })
  }
  if (can(actor, 'read', 'enquiry')) {
    const r = await one(sql`select count(*) filter (where created_at::date = current_date)::int as today,
        count(*) filter (where next_follow_up <= current_date and status not in ('joined', 'dead'))::int as due,
        count(*) filter (where status = 'new')::int as untouched
      from enquiries where ${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId}`)
    out.push({ title: 'Enquiries', tiles: [
      { label: 'New enquiries today', value: String(n(r.today)), tone: 'violet', goTo: 'Enquiry' },
      { label: 'Follow-ups due today / overdue', value: String(n(r.due)), tone: n(r.due) ? 'amber' : 'green', goTo: 'Enquiry Update' },
      { label: 'Not contacted yet', value: String(n(r.untouched)), tone: n(r.untouched) ? 'red' : 'green', goTo: 'Enquiry' },
    ] })
  }
  if (can(actor, 'create', 'registration')) {
    const r = await one(sql`select count(*) filter (where created_at::date = current_date)::int as today,
        count(*) filter (where date_trunc('month', created_at) = date_trunc('month', now()))::int as month
      from registrations r where (${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId}) and ${NOT_TRANSFERRED_IN}`)
    out.push({ title: 'Admissions', tiles: [
      { label: 'Admissions today', value: String(n(r.today)), tone: 'green', goTo: 'Registration' },
      { label: 'Admissions this month', value: String(n(r.month)), tone: 'blue', goTo: 'Registration' },
    ] })
  }
  if (can(actor, 'read', 'fee')) {
    const r = await one(sql`select
        (select coalesce(sum(amount), 0) from v_live_payments where paid_at::date = current_date
           and (${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId}))::bigint as today,
        (select count(*) from v_dues where days_overdue > 0 and registration_id in (select id from registrations where status in ('active', 'on_hold')) and (${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId}))::int as overdue,
        (select coalesce(sum(balance) filter (where balance > 0), 0) from v_fee_balance where ${actor.role === 'super_admin' && !actor.branchId} or branch_id = ${actor.branchId})::bigint as pending`)
    out.push({ title: 'Fees', tiles: [
      { label: 'Collected today', value: inr(n(r.today)), tone: 'green', goTo: 'Fees' },
      { label: 'Installments overdue', value: String(n(r.overdue)), tone: n(r.overdue) ? 'red' : 'green', goTo: 'Fees' },
      { label: 'Total pending dues', value: inr(n(r.pending)), tone: 'amber', goTo: 'Fees' },
    ] })
  }
  const certTiles: HomeTile[] = []
  if (can(actor, 'clear', 'certificate')) {
    const r = await one(sql`select count(*)::int as n from certificate_requests where status = 'pending' and fee_cleared_at is null`)
    certTiles.push({ label: 'Waiting for fee clearance', value: String(n(r.n)), tone: n(r.n) ? 'amber' : 'green', goTo: 'Certificate Requests' })
  }
  if (can(actor, 'approve', 'certificate')) {
    const r = await one(sql`select count(*)::int as n from certificate_requests where status = 'pending' and fee_cleared_at is not null`)
    certTiles.push({ label: 'Fees cleared, ready to issue', value: String(n(r.n)), tone: n(r.n) ? 'violet' : 'green', goTo: 'Issue Certificate' })
  }
  if (certTiles.length) out.push({ title: 'Certificates', tiles: certTiles })
  if (can(actor, 'read', 'teaching')) {
    const own = !can(actor, 'update', 'batch')
    const r = await one(sql`select count(*)::int as today,
        count(*) filter (where not exists (select 1 from class_sessions s where s.batch_id = b.id and s.session_date = current_date))::int as unmarked
      from batches b where b.is_active and extract(isodow from current_date)::int = any(coalesce(b.days, '{}'))
        and (${!own} or b.trainer_id = ${actor.userId})`)
    const h = await one(sql`select count(*)::int as n from help_requests q where q.status = 'open'
      and not exists (select 1 from help_offers o where o.request_id = q.id and o.trainer_id = ${actor.userId})`)
    out.push({ title: own ? 'My classes' : 'Classes', tiles: [
      { label: 'Students asking trainers for help', value: String(n(h.n)), tone: n(h.n) ? 'amber' : 'green', goTo: 'Project Help' },
      { label: 'Classes today', value: String(n(r.today)), tone: 'blue', goTo: 'My Classes' },
      { label: 'Attendance not marked yet', value: String(n(r.unmarked)), tone: n(r.unmarked) ? 'amber' : 'green', goTo: 'My Classes' },
    ] })
  }
  return out
}
