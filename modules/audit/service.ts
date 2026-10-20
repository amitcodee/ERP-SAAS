// Read side of the audit log (audit_logs is append-only; lib/audit.ts writes it). Powers the Logs screen.
import { sql } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import type { Actor, Tx } from '@/lib/db/withTenant'
import type { ListQuery } from '@/lib/list-query'
import { cleanQuery, inRange } from '@/lib/list-query-sql'

const WORD = /^[a-z_]{1,40}$/

const ACTION: Record<string, string> = {
  create: 'Added', update: 'Edited', delete: 'Deleted', restore: 'Restored', transition: 'Changed the status of', follow_up: 'Saved a follow-up on', update_lead: 'Edited the lead details of',
  login: 'Signed in', login_password_ok: 'Entered the password (code pending)', change_password: 'Changed their password', reset_password: 'Reset the password of',
  reset_password_by_link: 'Reset their password by e-mail link', request_password_reset: 'Asked for a password reset link', update_own_profile: 'Edited their own profile',
  set_roles: 'Changed the roles of', create_student_login: 'Created a student login', distribute_leads: 'Distributed leads', discount: 'Gave a discount on',
  issue: 'Issued', revoke: 'Revoked', request: 'Requested', reject: 'Rejected', clear_fees: 'Cleared the fees for', mark_attendance: 'Marked attendance for',
  approve_capstone: 'Approved the capstone of', add_member: 'Added a student to', activate: 'Activated', share_staff: 'Shared staff with', unshare_staff: 'Stopped sharing staff with',
  two_factor_on: 'Turned on two-step sign-in', two_factor_off: 'Turned off two-step sign-in',
}
const ENTITY: Record<string, string> = {
  enquiry: 'enquiry / lead', call: 'random call', user: 'user', registration: 'registration', payment: 'payment', branch: 'branch', role: 'role', setting: 'rule',
  lead_category: 'lead category', course: 'course', batch: 'batch', document: 'document', certificate: 'certificate', certificate_request: 'certificate request',
  class_session: 'class', assessment: 'assessment',
}
/** Actions that are about the person themselves: the sentence needs no "what". */
const SELF = new Set(['login', 'login_password_ok', 'change_password', 'reset_password_by_link', 'request_password_reset', 'update_own_profile', 'two_factor_on', 'two_factor_off'])

export const actionLabel = (a: string) => ACTION[a] ?? a.replace(/_/g, ' ')
export const entityLabel = (e: string) => ENTITY[e] ?? e.replace(/_/g, ' ')

const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase()
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  return String(v).slice(0, 80)
}
const HIDDEN = /password|hash|secret|token/i
const ID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

/** What changed, in words: "status: New → Follow-up; next follow up: — → 2026-10-05". Ids and secrets are left out. */
export function describeChange(before: unknown, after: unknown): string {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !HIDDEN.test(k))
  const parts: string[] = []
  for (const k of keys) {
    const had = k in b, has = k in a
    if (had && has && JSON.stringify(b[k]) === JSON.stringify(a[k])) continue
    const val = has ? a[k] : b[k]
    if (typeof val === 'string' && ID_LIKE.test(val)) continue // a bare id says nothing to a reader
    parts.push(had && has ? `${words(k)}: ${show(b[k])} → ${show(a[k])}` : `${words(k)}: ${show(val)}`)
  }
  return parts.join('; ').slice(0, 400)
}

export type LogRow = { id: string; at: string; by: string | null; branch: string | null; action: string; entity: string; what: string; subject: string | null; detail: string; ip: string | null }

/**
 * Filters (query.f): entity, action, user (id), branch (id). Search: who, action, entity, record id. Date range = when.
 * Newest first (dir asc = oldest first). Branch staff see their own branch's log; head office sees all (RLS).
 */
export async function listLogs(tx: Tx, actor: Actor, opts: { query?: ListQuery; limit?: number; offset?: number } = {}): Promise<{ rows: LogRow[]; total: number }> {
  assertCan(actor, 'read', 'audit')
  const c = cleanQuery(opts.query)
  const entity = c.f('entity'), action = c.f('action')
  const at = sql`a.at`
  const where = sql.join([
    sql`true`,
    entity && WORD.test(entity) ? sql`a.entity = ${entity}` : undefined,
    action && WORD.test(action) ? sql`a.action = ${action}` : undefined,
    c.id('user') ? sql`a.user_id = ${c.id('user')}` : undefined,
    c.id('branch') ? sql`a.branch_id = ${c.id('branch')}` : undefined,
    c.like ? sql`(u.name ilike ${c.like} or a.action ilike ${c.like} or a.entity ilike ${c.like} or a.entity_id ilike ${c.like})` : undefined,
    inRange(at, c.from, c.to),
  ].filter((x): x is NonNullable<typeof x> => !!x), sql` and `)
  const dir = sql.raw(c.sort === 'at' && c.dir === 'asc' ? 'asc' : 'desc')
  const res = await tx.execute<{ id: string; at: Date; by: string | null; branch: string | null; action: string; entity: string; entity_id: string | null; before: unknown; after: unknown; ip: string | null; subject: string | null }>(sql`
    select a.id, a.at, u.name as by, b.code as branch, a.action, a.entity, a.entity_id, a.before, a.after, a.ip,
      case a.entity
        when 'enquiry' then (select e.enquiry_no || ' · ' || trim(p.first_name || ' ' || coalesce(p.last_name, '')) from enquiries e join persons p on p.id = e.person_id where e.id::text = a.entity_id)
        when 'call' then (select trim(p.first_name || ' ' || coalesce(p.last_name, '')) || ' · ' || p.phone from calls k join persons p on p.id = k.person_id where k.id::text = a.entity_id)
        when 'registration' then (select r.reg_no from registrations r where r.id::text = a.entity_id)
        when 'user' then (select x.name from users x where x.id::text = a.entity_id)
        when 'branch' then (select x.code || ' — ' || x.name from branches x where x.id::text = a.entity_id)
        when 'lead_category' then (select x.name from lead_categories x where x.id::text = a.entity_id)
        when 'course' then (select x.title from courses x where x.id::text = a.entity_id)
      end as subject
    from audit_logs a left join users u on u.id = a.user_id left join branches b on b.id = a.branch_id
    where ${where} order by a.at ${dir}, a.id desc limit ${opts.limit ?? 25} offset ${opts.offset ?? 0}`)
  const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs a left join users u on u.id = a.user_id where ${where}`)
  return {
    total: total.rows[0]?.n ?? 0,
    rows: res.rows.map((r) => ({
      id: r.id, at: new Date(r.at).toISOString(), by: r.by, branch: r.branch, action: r.action, entity: r.entity, ip: r.ip,
      what: SELF.has(r.action) ? actionLabel(r.action) : `${actionLabel(r.action)} ${/^[aeiou]/.test(entityLabel(r.entity)) ? 'an' : 'a'} ${entityLabel(r.entity)}`,
      // Their own account is not a "subject"; a deleted or out-of-reach record has none either.
      subject: SELF.has(r.action) ? null : r.subject,
      detail: describeChange(r.before, r.after),
    })),
  }
}

/** The actions, areas and people that appear in the log, for the filter dropdowns. */
export async function logFilters(tx: Tx, actor: Actor) {
  assertCan(actor, 'read', 'audit')
  const [actions, entities, people] = [
    await tx.execute<{ v: string }>(sql`select distinct action as v from audit_logs order by 1`),
    await tx.execute<{ v: string }>(sql`select distinct entity as v from audit_logs order by 1`),
    await tx.execute<{ id: string; name: string }>(sql`select u.id, u.name from users u where exists (select 1 from audit_logs a where a.user_id = u.id) order by u.name limit 300`),
  ]
  return {
    actions: actions.rows.map((r) => ({ value: r.v, label: actionLabel(r.v) })),
    entities: entities.rows.map((r) => ({ value: r.v, label: entityLabel(r.v).replace(/^./, (ch) => ch.toUpperCase()) })),
    people: people.rows.map((r) => ({ value: r.id, label: r.name })),
  }
}
