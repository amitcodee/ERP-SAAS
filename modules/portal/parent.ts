// A parent's or guardian's view of one registration, through a private link (/p/<token>) the office sends them, e.g.
// by WhatsApp: the student's attendance, fees (with receipts and Pay online) and marks, read-only. No account to make
// or remember. The token is random (24 bytes) and only its hash is kept; a new link for the registration stops the
// old one, and the office can stop it. Links last a year from when they were made.
import { createHash, randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { parentLinks } from '@/lib/db/schema'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { paymentChannel } from '@/modules/fees/plan'
import { dueNow } from '@/modules/fees/online'

const LINK_DAYS = 365
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')
/** A token as the link carries it: base64url, 32 characters. */
export const looksLikeToken = (t: string) => /^[A-Za-z0-9_-]{32}$/.test(t)

/**
 * Makes the parent's link of a registration (stopping the one before) and returns its token. The office, with the
 * right to give portal logins; the registration must be one the caller can see (RLS).
 */
export async function createParentLink(tx: Tx, actor: Actor, registrationId: string): Promise<{ token: string; guardianPhone: string | null; name: string }> {
  assertCan(actor, 'create', 'user')
  const [r] = (await tx.execute<{ id: string; branch_id: string; first_name: string; guardian_phone: string | null }>(sql`
    select r.id, r.branch_id, p.first_name, p.guardian_phone from registrations r join persons p on p.id = r.person_id where r.id = ${registrationId}`)).rows
  if (!r) throw new Error('Registration not found')
  await tx.execute(sql`update parent_links set revoked_at = now() where registration_id = ${r.id} and revoked_at is null`)
  const token = randomBytes(24).toString('base64url')
  await tx.insert(parentLinks).values({ branchId: r.branch_id, registrationId: r.id, tokenHash: hashOf(token), createdBy: actor.userId })
  await audit(tx, actor, { action: 'create', entity: 'parent_link', entityId: r.id })
  return { token, guardianPhone: r.guardian_phone, name: r.first_name }
}

/** Stops the registration's parent link. */
export async function revokeParentLink(tx: Tx, actor: Actor, registrationId: string) {
  assertCan(actor, 'create', 'user')
  const res = await tx.execute(sql`update parent_links set revoked_at = now() where registration_id = ${registrationId} and revoked_at is null`)
  if (!res.rowCount) throw new Error('There is no link to stop')
  await audit(tx, actor, { action: 'revoke', entity: 'parent_link', entityId: registrationId })
}

/** Whether the registration has a live parent link, and when it was last opened. */
export async function parentLinkState(tx: Tx, registrationId: string): Promise<{ live: boolean; createdAt: string | null; lastSeenAt: string | null }> {
  const [l] = (await tx.execute<{ created_at: string; last_seen_at: string | null }>(sql`
    select created_at::text, last_seen_at::text from parent_links where registration_id = ${registrationId} and revoked_at is null
      and created_at > now() - make_interval(days => ${LINK_DAYS}) order by created_at desc limit 1`)).rows
  return { live: !!l, createdAt: l?.created_at ?? null, lastSeenAt: l?.last_seen_at ?? null }
}

export type ParentView = {
  registrationId: string; createdBy: string
  student: { name: string; regNo: string; course: string | null; branch: string; status: string; enrolledOn: string; endsOn: string | null }
  fees: { charged: number; discounted: number; paid: number; balance: number; payNow: number
    installments: { dueDate: string; amount: number; status: string }[]
    receipts: { receiptNo: string; amount: number; paidAt: string; online: boolean; cancelled: boolean }[] }
  attendance: { total: number; present: number; recent: { date: string; present: boolean; batch: string }[] }
  marks: { title: string; kind: string; score: number | null; maxScore: number | null; date: string }[]
}

/** What the link shows, or null for a token that is unknown, stopped or too old. Each opening is noted (last seen). */
export async function parentView(orgId: string, token: string): Promise<ParentView | null> {
  if (!looksLikeToken(token)) return null
  return withOrgSystem(orgId, (tx) => parentViewIn(tx, token))
}
export async function parentViewIn(tx: Tx, token: string): Promise<ParentView | null> {
  const [l] = (await tx.execute<{ id: string; registration_id: string; created_by: string }>(sql`
    select id, registration_id, created_by from parent_links where token_hash = ${hashOf(token)} and revoked_at is null
      and created_at > now() - make_interval(days => ${LINK_DAYS})`)).rows
  if (!l) return null
  await tx.execute(sql`update parent_links set last_seen_at = now() where id = ${l.id}`)
  const id = l.registration_id
  const [s] = (await tx.execute<{ name: string; reg_no: string; course: string | null; branch: string; status: string; enrolled: string; ends: string | null }>(sql`
    select trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, r.reg_no, coalesce(c.title, r.custom_course_title, d.name) as course, b.name as branch,
      r.status, r.enrollment_date::text as enrolled, r.expected_end_date::text as ends
    from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id
      left join courses c on c.id = r.course_id left join departments d on d.id = r.department_id where r.id = ${id}`)).rows
  if (!s) return null
  const [bal] = (await tx.execute<{ charged: number; discounted: number; paid: number; balance: number }>(sql`select charged, discounted, paid, balance from v_fee_balance where registration_id = ${id}`)).rows
  const installments = (await tx.execute<{ dueDate: string; amount: number; status: string }>(sql`
    select due_date::text as "dueDate", amount, status from installments where registration_id = ${id} and status <> 'cancelled' order by due_date`)).rows
  const receipts = (await tx.execute<{ receipt_no: string; amount: number; paid_at: string; mode: string; cancelled: boolean }>(sql`
    select rc.receipt_no, p.amount, p.paid_at::text, m.value as mode, exists (select 1 from payment_reversals x where x.payment_id = p.id) as cancelled
    from payments p join receipts rc on rc.payment_id = p.id join lookups m on m.id = p.mode_id where p.registration_id = ${id} order by p.paid_at desc`)).rows
  const att = (await tx.execute<{ date: string; present: boolean; batch: string }>(sql`
    select s.session_date::text as date, a.present, bt.name as batch from attendance a join class_sessions s on s.id = a.session_id join batches bt on bt.id = s.batch_id
    where a.registration_id = ${id} order by s.session_date desc`)).rows
  const marks = (await tx.execute<{ title: string; kind: string; score: number | null; maxScore: number | null; date: string }>(sql`
    select title, kind::text, score, max_score as "maxScore", created_at::text as date from assessments where registration_id = ${id} order by created_at desc limit 30`)).rows
  return {
    registrationId: id, createdBy: l.created_by,
    student: { name: s.name, regNo: s.reg_no, course: s.course, branch: s.branch, status: s.status, enrolledOn: s.enrolled, endsOn: s.ends },
    fees: { ...(bal ?? { charged: 0, discounted: 0, paid: 0, balance: 0 }), payNow: s.status === 'transferred' ? 0 : await dueNow(tx, id), installments,
      receipts: receipts.map((r) => ({ receiptNo: r.receipt_no, amount: r.amount, paidAt: r.paid_at, online: paymentChannel(r.mode) === 'online', cancelled: r.cancelled })) },
    attendance: { total: att.length, present: att.filter((a) => a.present).length, recent: att.slice(0, 20) },
    marks,
  }
}
