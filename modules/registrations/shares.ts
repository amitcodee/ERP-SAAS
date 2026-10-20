// Shared students: a student of one branch (home) takes classes in another (host) — some days in each, or online.
// The home branch asks (whoever edits admissions there); the host branch accepts into one of its batches (whoever
// manages batches there) or declines; the home branch may cancel while it waits; either side may end it. While it
// is accepted the host sees only that student — in its batch, attendance and tests (database rule
// app_shared_students) — never the home branch's other data or the student's fees. Attendance and marks taken at
// the host count for the student's certificate at home.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { can } from '@/lib/auth/permissions'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'

export type ShareRow = {
  id: string; status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'ended'; direction: 'out' | 'in' | 'both'
  registrationId: string; regNo: string; name: string; phone: string; course: string | null
  fromBranch: string; toBranch: string; mode: 'classroom' | 'online'; schedule: string | null; note: string
  batch: string | null; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; endedAt: string | null
}

const uuid = z.string().uuid()
export const mayAskShare = (a: Actor) => can(a, 'update', 'registration')
export const mayHostShare = (a: Actor) => can(a, 'update', 'batch')

const askInput = z.object({
  registrationId: uuid, toBranchId: uuid,
  mode: z.enum(['classroom', 'online']).default('classroom'),
  schedule: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().min(5, 'Say why (e.g. lives near Mohali on Tue/Thu/Sat)').max(500),
})
export type ShareAsk = z.input<typeof askInput>

/** The home branch asks another branch to take its student for some classes. */
export async function askShare(tx: Tx, actor: Actor, raw: ShareAsk) {
  if (!mayAskShare(actor)) throw new Error('Forbidden: share a student')
  const v = askInput.parse(raw)
  const [r] = (await tx.execute<{ id: string; branch_id: string; status: string }>(sql`select id, branch_id, status::text from registrations where id = ${v.registrationId} for update`)).rows
  if (!r) throw new Error('Registration not found')
  if (actor.branchId && r.branch_id !== actor.branchId) throw new Error('Only the student’s own branch can ask')
  if (r.status !== 'active') throw new Error('Only an active student can take classes in another branch')
  if (r.branch_id === v.toBranchId) throw new Error('That is the student’s own branch')
  const [open] = (await tx.execute(sql`select 1 from student_shares where registration_id = ${r.id} and to_branch_id = ${v.toBranchId} and status in ('pending', 'accepted')`)).rows
  if (open) throw new Error('This student is already shared with (or asked of) that branch')
  const [s] = (await tx.execute<{ id: string }>(sql`
    insert into student_shares (registration_id, from_branch_id, to_branch_id, mode, schedule, note, requested_by)
    values (${r.id}, ${r.branch_id}, ${v.toBranchId}, ${v.mode}, ${v.schedule || null}, ${v.note}, ${actor.userId}) returning id`)).rows
  await audit(tx, actor, { action: 'ask_share', entity: 'registration', entityId: r.id, after: { shareId: s.id, toBranchId: v.toBranchId, mode: v.mode } })
  return s
}

async function lockShare(tx: Tx, id: string) {
  const [s] = (await tx.execute<{ id: string; status: string; registration_id: string; from_branch_id: string; to_branch_id: string; batch_id: string | null }>(sql`
    select id, status, registration_id, from_branch_id, to_branch_id, batch_id from student_shares where id = ${uuid.parse(id)} for update`)).rows
  if (!s) throw new Error('Request not found')
  return s
}

/** The host branch accepts into one of its active batches: the student joins it (their classes there count at home). */
export async function acceptShare(tx: Tx, actor: Actor, shareId: string, batchId: string, note: string | null) {
  if (!mayHostShare(actor)) throw new Error('Only whoever manages batches can accept a student')
  const s = await lockShare(tx, shareId)
  if (actor.branchId ? s.to_branch_id !== actor.branchId : actor.role !== 'super_admin') throw new Error('Only the branch the student comes to can accept')
  if (s.status !== 'pending') throw new Error(`This request is already ${s.status}`)
  const [b] = (await tx.execute<{ id: string; branch_id: string; capacity: number | null; n: number }>(sql`
    select b.id, b.branch_id, b.capacity, (select count(*)::int from batch_members m where m.batch_id = b.id) as n
    from batches b where b.id = ${uuid.parse(batchId)} and b.is_active and b.deleted_at is null`)).rows
  if (!b || b.branch_id !== s.to_branch_id) throw new Error('Choose one of this branch’s batches')
  if (b.capacity && b.n >= b.capacity) throw new Error('That batch is full')
  await tx.execute(sql`insert into batch_members (batch_id, registration_id, branch_id) values (${b.id}, ${s.registration_id}, ${b.branch_id}) on conflict do nothing`)
  await tx.execute(sql`update student_shares set status = 'accepted', batch_id = ${b.id}, decided_by = ${actor.userId}, decided_at = now(), decision_note = ${note?.trim().slice(0, 500) || null} where id = ${s.id}`)
  await audit(tx, actor, { action: 'accept_share', entity: 'student_share', entityId: s.id, after: { batchId: b.id } })
}

/** The host branch says no (with a reason); the home branch may take its request back while it waits. */
export async function declineShare(tx: Tx, actor: Actor, shareId: string, reason: string) {
  const why = z.string().trim().min(3, 'Say why').max(500).parse(reason)
  const s = await lockShare(tx, shareId)
  if (s.status !== 'pending') throw new Error(`This request is already ${s.status}`)
  const host = actor.branchId ? s.to_branch_id === actor.branchId : actor.role === 'super_admin'
  const home = actor.branchId === s.from_branch_id
  if (host && mayHostShare(actor)) await tx.execute(sql`update student_shares set status = 'declined', decided_by = ${actor.userId}, decided_at = now(), decision_note = ${why} where id = ${s.id}`)
  else if (home && mayAskShare(actor)) await tx.execute(sql`update student_shares set status = 'cancelled', decided_by = ${actor.userId}, decided_at = now(), decision_note = ${why} where id = ${s.id}`)
  else throw new Error('Forbidden: decide this request')
  await audit(tx, actor, { action: host ? 'decline_share' : 'cancel_share', entity: 'student_share', entityId: s.id, after: { reason: why } })
}

/** Either branch ends an accepted share: the student leaves the host's batch (their record there stays). */
export async function endShare(actor: Actor, shareId: string, reason: string) {
  const why = z.string().trim().min(3, 'Say why').max(500).parse(reason)
  // the host's batch is not the home branch's to change: done on the server's own connection, for this share only
  return withOrgSystem(actor.orgId, async (tx) => {
    const s = await lockShare(tx, shareId)
    const side = actor.role === 'super_admin' || actor.branchId === s.from_branch_id || actor.branchId === s.to_branch_id
    if (!side || !(mayAskShare(actor) || mayHostShare(actor))) throw new Error('Forbidden: end this share')
    if (s.status !== 'accepted') throw new Error(`This share is ${s.status}`)
    if (s.batch_id) await tx.execute(sql`delete from batch_members where batch_id = ${s.batch_id} and registration_id = ${s.registration_id}`)
    await tx.execute(sql`update student_shares set status = 'ended', ended_by = ${actor.userId}, ended_at = now(), decision_note = coalesce(decision_note || ' · ', '') || ${`Ended: ${why}`} where id = ${s.id}`)
    await audit(tx, actor, { action: 'end_share', entity: 'student_share', entityId: s.id, after: { reason: why } })
  })
}

/** Students this branch shares out (home) and hosts (in); head office sees every branch's. */
export async function listShares(tx: Tx, actor: Actor): Promise<ShareRow[]> {
  if (!can(actor, 'read', 'registration') && !can(actor, 'read', 'batch')) throw new Error('Forbidden: shared students')
  const b = actor.branchId
  const rows = (await tx.execute<Record<string, never>>(sql`
    select s.id, s.status, s.registration_id, s.from_branch_id, s.to_branch_id, s.mode, s.schedule, s.note, s.batch_id,
      s.requested_at, s.decided_at, s.decision_note, s.ended_at, s.requested_by, s.decided_by
    from student_shares s ${b ? sql`where s.from_branch_id = ${b} or s.to_branch_id = ${b}` : sql``}
    order by (s.status = 'pending') desc, (s.status = 'accepted') desc, s.requested_at desc limit 500`)).rows
  if (!rows.length) return []
  // names across the two branches, for exactly these shares
  const ids = (k: string) => sql.join([...new Set(rows.map((r) => r[k]).filter(Boolean) as string[])].map((x) => sql`${x}::uuid`), sql`, `)
  const info = await withOrgSystem(actor.orgId, async (sys) => ({
    regs: (await sys.execute<{ id: string; reg_no: string; name: string; phone: string; course: string | null }>(sql`
      select r.id, r.reg_no, trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, coalesce(c.title, r.custom_course_title) as course
      from registrations r join persons p on p.id = r.person_id left join courses c on c.id = r.course_id where r.id in (${ids('registration_id')})`)).rows,
    branches: (await sys.execute<{ id: string; name: string }>(sql`select id, name from branches where id in (${ids('from_branch_id')}) or id in (${ids('to_branch_id')})`)).rows,
    batches: rows.some((r) => r.batch_id) ? (await sys.execute<{ id: string; name: string }>(sql`select id, name from batches where id in (${ids('batch_id')})`)).rows : [],
    users: (await sys.execute<{ id: string; name: string }>(sql`select id, name from users where id in (${sql.join([...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter(Boolean) as string[])].map((x) => sql`${x}::uuid`).concat(sql`null::uuid`), sql`, `)})`)).rows,
  }))
  const name = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name ?? null
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map((s) => {
    const reg = info.regs.find((x) => x.id === s.registration_id)
    return {
      id: s.id, status: s.status, direction: !b ? 'both' : s.from_branch_id === b ? 'out' : 'in',
      registrationId: s.registration_id, regNo: reg?.reg_no ?? '—', name: reg?.name ?? 'Student', phone: reg?.phone ?? '', course: reg?.course ?? null,
      fromBranch: name(info.branches, s.from_branch_id) ?? 'Branch', toBranch: name(info.branches, s.to_branch_id) ?? 'Branch', mode: s.mode, schedule: s.schedule, note: s.note,
      batch: name(info.batches, s.batch_id), requestedBy: name(info.users, s.requested_by), requestedAt: iso(s.requested_at)!, decidedBy: name(info.users, s.decided_by), decidedAt: iso(s.decided_at), decisionNote: s.decision_note, endedAt: iso(s.ended_at),
    }
  })
}

/** The host branch's active batches, to accept a student into. */
export async function hostBatches(tx: Tx, actor: Actor) {
  if (!mayHostShare(actor)) return []
  return (await tx.execute<{ id: string; name: string; course: string | null; members: number; capacity: number | null }>(sql`
    select b.id, b.name, coalesce(c.title, d.name) as course, (select count(*)::int from batch_members m where m.batch_id = b.id) as members, b.capacity
    from batches b join departments d on d.id = b.department_id left join courses c on c.id = b.course_id
    where b.is_active and b.deleted_at is null ${actor.branchId ? sql`and b.branch_id = ${actor.branchId}` : sql``} order by b.name`)).rows
}
