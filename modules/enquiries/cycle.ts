// The lead cycle: one lead's whole life on one timeline, from the first contact to the certificate.
//   website form -> random call(s) and their follow-ups -> lead added -> calls / status changes / follow-ups ->
//   visit -> demo -> registration -> payments -> certificate request, accounts approval, issue
// plus the system log of who changed what. Read-only; RLS decides what the viewer may see.
import { sql } from 'drizzle-orm'
import { assertCan, can } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'

export type CycleKind = 'web' | 'call' | 'lead' | 'status' | 'followup' | 'visit' | 'registration' | 'payment' | 'certificate' | 'log'
export type CycleEvent = { at: string; kind: CycleKind; title: string; text: string | null; by: string | null }
export type CycleStage = { key: string; label: string; at: string | null; done: boolean }
export type LeadCycle = {
  enquiryId: string; enquiryNo: string; regNo: string | null; registrationId: string | null
  name: string; phone: string; email: string | null; location: string | null
  course: string | null; source: string | null; branch: string; status: string; assignedTo: string | null
  createdAt: string; nextFollowUp: string | null
  stages: CycleStage[]
  events: CycleEvent[]
  money: { total: number; paid: number; balance: number } | null
}

const STATUS: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead', active: 'Active', on_hold: 'On hold', discontinued: 'Discontinued', completed: 'Completed' }
const st = (s: unknown) => (s == null ? '' : STATUS[String(s)] ?? String(s))
const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
const day = (v: unknown) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function leadCycle(tx: Tx, actor: Actor, rawId: string): Promise<LeadCycle | null> {
  assertCan(actor, 'read', 'enquiry')
  if (!UUID.test(rawId)) return null
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute<T & Record<string, unknown>>(q)).rows
  const [e] = await rows<Record<string, unknown>>(sql`
    select e.*, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, p.email, co.title as course, l.value as source,
      b.name as branch, u.name as assigned, cu.name as created_by_name, du.name as demo_by_name
    from enquiries e join persons p on p.id = e.person_id left join courses co on co.id = e.course_id left join lookups l on l.id = e.source_id
      join branches b on b.id = e.branch_id left join users u on u.id = e.assigned_to
      left join users cu on cu.id = e.created_by left join users du on du.id = e.demo_by
    where e.id = ${rawId}`)
  if (!e) return null
  const id = rawId
  const events: CycleEvent[] = []
  const push = (at: unknown, kind: CycleKind, title: string, text: string | null = null, by: unknown = null) => { const a = iso(at); if (a) events.push({ at: a, kind, title, text: text || null, by: by ? String(by) : null }) }

  // the website form(s) that brought the lead
  for (const w of await rows<Record<string, unknown>>(sql`select submitted_at, site_host, source_url, message, course from web_leads where enquiry_id = ${id}`)) {
    push(w.submitted_at, 'web', `Website form filled on ${w.site_host}`, [w.course && `Course: ${w.course}`, w.message, w.source_url && `Page: ${w.source_url}`].filter(Boolean).join('\n'))
  }

  // random calls of this person (before or for this lead) and every follow-up call on them
  let callIds: string[] = []
  if (can(actor, 'read', 'call')) {
    const calls = await rows<Record<string, unknown>>(sql`
      select c.id, c.called_at, c.status, c.call_remark, c.remarks, c.follow_up_date, c.expected_visit_date, u.name as by
      from calls c left join users u on u.id = c.received_by
      where c.enquiry_id = ${id} or (c.person_id = ${e.person_id as string} and c.called_at <= coalesce(${e.created_at as string}::timestamptz, now()) + interval '1 day')`)
    callIds = calls.map((c) => String(c.id))
    for (const c of calls) push(c.called_at, 'call', `Random call${c.status ? ` — ${c.status}` : ''}`, [c.call_remark && `Caller said: ${c.call_remark}`, c.remarks && `Note: ${c.remarks}`, c.follow_up_date && `Next follow-up: ${day(c.follow_up_date)}`, c.expected_visit_date && `Will visit: ${day(c.expected_visit_date)}`].filter(Boolean).join('\n'), c.by)
    if (callIds.length) {
      for (const f of await rows<Record<string, unknown>>(sql`
        select f.called_at, f.status, f.call_remark, f.remarks, f.next_follow_up, f.expected_visit_date, f.dead_reason, u.name as by
        from call_followups f left join users u on u.id = f.by_user where f.call_id in (${sql.join(callIds.map((c) => sql`${c}::uuid`), sql`, `)})`)) {
        push(f.called_at, 'followup', `Follow-up call${f.status ? ` — ${f.status}` : ''}`, [f.call_remark && `Caller said: ${f.call_remark}`, f.remarks && `Note: ${f.remarks}`, f.next_follow_up && `Next follow-up: ${day(f.next_follow_up)}`, f.expected_visit_date && `Will visit: ${day(f.expected_visit_date)}`, f.dead_reason && `Dead: ${f.dead_reason}`].filter(Boolean).join('\n'), f.by)
      }
    }
  }

  // the lead itself
  push(e.created_at, 'lead', `Lead added — ${e.enquiry_no}`, [e.course && `Course: ${e.course}`, e.source && `Source: ${e.source}`, e.location && `Location: ${e.location}`].filter(Boolean).join('\n'), e.created_by_name)
  if (e.assigned_at) push(e.assigned_at, 'lead', `Assigned to ${e.assigned ?? 'a counsellor'}`)
  if (e.call_at) push(e.call_at, 'followup', `Call made${e.call_done ? '' : ' (not done)'}`, e.call_remark ? `Remark: ${e.call_remark}` : null)
  for (const v of await rows<Record<string, unknown>>(sql`
    select v.at, v.from_status, v.to_status, v.follow_up_date, v.note, u.name as by from enquiry_events v left join users u on u.id = v.by_user where v.enquiry_id = ${id}`)) {
    const change = v.from_status !== v.to_status
    push(v.at, change ? 'status' : 'followup', change ? `Status: ${v.from_status ? `${st(v.from_status)} → ` : ''}${st(v.to_status)}` : 'Follow-up', [v.note, v.follow_up_date && `Next follow-up: ${day(v.follow_up_date)}`].filter(Boolean).join('\n'), v.by)
  }
  if (e.visited) push(e.visited_at ?? e.created_at, 'visit', 'Visited the branch')
  if (e.demo_by_name) {
    const [demo] = await rows<{ at: string }>(sql`select min(at) as at from enquiry_events where enquiry_id = ${id} and to_status = 'demo'`)
    if (!demo?.at) push(e.updated_at, 'visit', `Demo given by ${e.demo_by_name}`)
  }

  // registration, payments, certificate
  let money: LeadCycle['money'] = null
  const [r] = can(actor, 'read', 'registration') ? await rows<Record<string, unknown>>(sql`
    select r.id, r.reg_no, r.enrollment_date, r.joining_date, r.total_fee, r.status, r.project_certificate, r.created_at, u.name as by, coalesce(co.title, r.custom_course_title) as course,
      coalesce(fb.balance, 0)::bigint as balance
    from registrations r left join users u on u.id = r.created_by left join courses co on co.id = r.course_id left join v_fee_balance fb on fb.registration_id = r.id
    where r.enquiry_id = ${id}`) : []
  if (r) {
    push(r.created_at, 'registration', `Registered — ${r.reg_no}`, [`Course: ${r.course ?? '—'}`, `Fees: ${inr(Number(r.total_fee))}`, `Registered on ${day(r.enrollment_date)}`, r.joining_date && `Joins ${day(r.joining_date)}`, r.project_certificate && 'Project certificate included'].filter(Boolean).join('\n'), r.by)
    for (const x of await rows<Record<string, unknown>>(sql`select x.at, x.from_status, x.to_status, x.note, u.name as by from registration_events x left join users u on u.id = x.by_user where x.registration_id = ${r.id as string} and x.from_status is not null`)) {
      push(x.at, 'registration', `Registration: ${st(x.from_status)} → ${st(x.to_status)}`, (x.note as string) ?? null, x.by)
    }
    if (can(actor, 'read', 'fee')) {
      for (const p of await rows<Record<string, unknown>>(sql`
        select p.paid_at, p.amount, m.value as mode, rc.receipt_no, u.name as by from payments p left join lookups m on m.id = p.mode_id left join receipts rc on rc.payment_id = p.id left join users u on u.id = p.received_by
        where p.registration_id = ${r.id as string}`)) push(p.paid_at, 'payment', `Payment ${inr(Number(p.amount))}${p.mode ? ` by ${p.mode}` : ''}`, p.receipt_no ? `Receipt ${p.receipt_no}` : null, p.by)
      const total = Number(r.total_fee), balance = Number(r.balance)
      money = { total, paid: total - balance, balance }
    }
    if (can(actor, 'read', 'certificate')) {
      for (const q of await rows<Record<string, unknown>>(sql`
        select q.requested_at, q.fee_cleared_at, q.decided_at, q.status, q.rejection_reason, ru.name as req_by, cu.name as cleared_by, du.name as decided_by
        from certificate_requests q left join users ru on ru.id = q.requested_by left join users cu on cu.id = q.fee_cleared_by left join users du on du.id = q.decided_by
        where q.registration_id = ${r.id as string}`)) {
        push(q.requested_at, 'certificate', 'Certificate requested', null, q.req_by)
        if (q.fee_cleared_at) push(q.fee_cleared_at, 'certificate', 'Accounts approved: fees clear', null, q.cleared_by)
        if (q.status === 'rejected') push(q.decided_at, 'certificate', 'Certificate request rejected', (q.rejection_reason as string) ?? null, q.decided_by)
      }
      for (const c of await rows<Record<string, unknown>>(sql`select c.issued_at, c.cert_no, c.is_revoked, c.revoked_reason, u.name as by from certificates c left join users u on u.id = c.issued_by where c.registration_id = ${r.id as string}`)) {
        push(c.issued_at, 'certificate', `Certificate issued — ${c.cert_no}`, c.is_revoked ? `Later revoked: ${c.revoked_reason ?? ''}` : null, c.by)
      }
    }
  }

  // the system log: every edit made to the lead, its calls and its registration
  if (can(actor, 'read', 'audit')) {
    const ids = [id, ...callIds, ...(r ? [String(r.id)] : [])]
    for (const a of await rows<Record<string, unknown>>(sql`
      select a.at, a.action, a.entity, u.name as by from audit_logs a left join users u on u.id = a.user_id
      where a.entity_id in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)}) order by a.at limit 300`)) {
      push(a.at, 'log', `${String(a.entity).replace(/_/g, ' ')}: ${String(a.action).replace(/_/g, ' ')}`, null, a.by)
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at))
  const first = (k: CycleKind[]) => events.find((x) => k.includes(x.kind))?.at ?? null
  const demoAt = events.find((x) => x.kind === 'status' && /→ Demo$|^Status: Demo$/.test(x.title))?.at ?? (e.demo_by_name ? iso(e.updated_at) : null)
  const paidAt = first(['payment'])
  const certAt = events.find((x) => x.kind === 'certificate' && x.title.startsWith('Certificate issued'))?.at ?? null
  const stages: CycleStage[] = [
    { key: 'first', label: 'First contact', at: first(['web', 'call']) ?? iso(e.created_at), done: true },
    { key: 'lead', label: 'Lead added', at: iso(e.created_at), done: true },
    { key: 'visit', label: 'Visited', at: e.visited ? iso(e.visited_at ?? e.created_at) : null, done: !!e.visited },
    { key: 'demo', label: 'Demo', at: demoAt, done: !!demoAt },
    { key: 'registered', label: 'Registered', at: r ? iso(r.created_at) : null, done: !!r },
    { key: 'paid', label: money && money.balance <= 0 ? 'Fees clear' : 'Fees paid', at: paidAt, done: !!money && money.balance <= 0 },
    { key: 'cert', label: 'Certificate', at: certAt, done: !!certAt },
  ]

  return {
    enquiryId: id, enquiryNo: String(e.enquiry_no), regNo: r ? String(r.reg_no) : null, registrationId: r ? String(r.id) : null,
    name: String(e.name), phone: String(e.phone ?? ''), email: (e.email as string) ?? null, location: (e.location as string) ?? null,
    course: (e.course as string) ?? null, source: (e.source as string) ?? null, branch: String(e.branch), status: st(e.status), assignedTo: (e.assigned as string) ?? null,
    createdAt: iso(e.created_at)!, nextFollowUp: (e.next_follow_up as string) ?? null,
    stages, events, money,
  }
}
