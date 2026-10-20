// A batch taught by a trainer of another branch. The batch's academic manager (batch: update) asks a trainer from
// another branch; the trainer accepts or declines in their own login. Accepting makes them the batch's trainer, and
// row-level security then lets them (only them) see that batch's students and mark their attendance and grades.
// Changing the batch's trainer later ends that access by itself.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'

const uuid = z.string().uuid()
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export type TrainerOption = { id: string; name: string; branch: string }
export type OutgoingTrainerRequest = { id: string; batchId: string; trainer: string; requestedAt: string; note: string | null }
export type IncomingTrainerRequest = { id: string; from: string; batch: string; note: string | null; requestedAt: string }

/** Trainers of the other branches (to ask one to take a batch). Names and branches only. */
export async function otherBranchTrainers(actor: Actor): Promise<TrainerOption[]> {
  assertCan(actor, 'update', 'batch')
  return withOrgSystem(actor.orgId, async (tx) => (await tx.execute<TrainerOption>(sql`
    select distinct u.id, u.name, b.name as branch
    from users u join branches b on b.id = u.branch_id
    where exists (select 1 from user_roles ur join roles ro on ro.key = ur.role where ur.user_id = u.id and 'teaching:read' = any(ro.permissions)) and u.is_active and u.deleted_at is null and u.branch_id is distinct from ${actor.branchId}::uuid
    order by b.name, u.name`)).rows)
}

/** Asks a trainer of another branch to take one of this branch's batches. One open request per batch. */
export async function requestTrainer(tx: Tx, actor: Actor, raw: { batchId: string; trainerId: string; note?: string | null }) {
  assertCan(actor, 'update', 'batch')
  const batchId = uuid.parse(raw.batchId)
  const trainerId = uuid.parse(raw.trainerId)
  const note = raw.note?.trim().slice(0, 300) || null
  const [b] = (await tx.execute<{ id: string; branch_id: string; branch: string; name: string; course: string | null; days: number[] | null; t1: string | null; t2: string | null; members: number; trainer_id: string | null }>(sql`
    select b.id, b.branch_id, br.name as branch, b.name, coalesce(c.title, d.name) as course, b.days,
      to_char(b.start_time, 'HH24:MI') as t1, to_char(b.end_time, 'HH24:MI') as t2, b.trainer_id,
      (select count(*)::int from batch_members m where m.batch_id = b.id) as members
    from batches b join branches br on br.id = b.branch_id join departments d on d.id = b.department_id left join courses c on c.id = b.course_id
    where b.id = ${batchId}`)).rows
  if (!b) throw new Error('Batch not found')
  if (b.trainer_id === trainerId) throw new Error('This trainer already teaches this batch')
  const [t] = await withOrgSystem(actor.orgId, async (s) => (await s.execute<{ name: string; branch: string; branch_id: string | null }>(sql`
    select u.name, coalesce(br.name, 'Head office') as branch, u.branch_id from users u left join branches br on br.id = u.branch_id
    where u.id = ${trainerId} and exists (select 1 from user_roles ur join roles ro on ro.key = ur.role where ur.user_id = u.id and 'teaching:read' = any(ro.permissions)) and u.is_active and u.deleted_at is null`)).rows)
  if (!t) throw new Error('Pick a trainer')
  if (t.branch_id === b.branch_id) throw new Error('This trainer is in this branch: choose them as the batch’s trainer instead')
  const [open] = (await tx.execute(sql`select 1 from trainer_requests where batch_id = ${batchId} and status = 'pending'`)).rows
  if (open) throw new Error('This batch already has a request waiting; cancel it first')
  const when = b.days?.length ? ` · ${b.days.map((x) => WEEK[x - 1]).join(', ')}${b.t1 && b.t2 ? ` ${b.t1}–${b.t2}` : ''}` : ''
  const label = `${b.name} — ${b.course ?? ''}${when} · ${b.members} student${b.members === 1 ? '' : 's'}`
  const [r] = (await tx.execute<{ id: string }>(sql`
    insert into trainer_requests (batch_id, branch_id, trainer_id, trainer_label, branch_label, batch_label, note, requested_by)
    values (${batchId}, ${b.branch_id}, ${trainerId}, ${`${t.name} · ${t.branch}`}, ${b.branch}, ${label}, ${note}, ${actor.userId})
    returning id`)).rows
  await audit(tx, actor, { action: 'request', entity: 'trainer_request', entityId: r.id, after: { batchId, trainerId } })
  return r.id
}

/** The batch's branch withdraws a request the trainer has not answered. */
export async function cancelTrainerRequest(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'update', 'batch')
  const [r] = (await tx.execute<{ id: string }>(sql`
    update trainer_requests set status = 'cancelled', decided_by = ${actor.userId}, decided_at = now()
    where id = ${uuid.parse(id)} and status = 'pending' and branch_id is not distinct from coalesce(${actor.branchId}::uuid, branch_id) returning id`)).rows
  if (!r) throw new Error('This request is no longer waiting')
  await audit(tx, actor, { action: 'cancel', entity: 'trainer_request', entityId: r.id })
}

/** Requests this branch is waiting on, per batch. */
export async function outgoingTrainerRequests(tx: Tx): Promise<OutgoingTrainerRequest[]> {
  return (await tx.execute<{ id: string; batch_id: string; trainer_label: string; requested_at: string; note: string | null }>(sql`
    select id, batch_id, trainer_label, requested_at, note from trainer_requests where status = 'pending' and branch_id = coalesce(app_branch(), branch_id)`)).rows
    .map((r) => ({ id: r.id, batchId: r.batch_id, trainer: r.trainer_label, requestedAt: new Date(r.requested_at).toISOString(), note: r.note }))
}

/** Requests waiting for this trainer's answer (from any branch). */
export async function incomingTrainerRequests(tx: Tx, actor: Actor): Promise<IncomingTrainerRequest[]> {
  return (await tx.execute<{ id: string; branch_label: string; batch_label: string; note: string | null; requested_at: string }>(sql`
    select id, branch_label, batch_label, note, requested_at from trainer_requests where status = 'pending' and trainer_id = ${actor.userId} order by requested_at`)).rows
    .map((r) => ({ id: r.id, from: r.branch_label, batch: r.batch_label, note: r.note, requestedAt: new Date(r.requested_at).toISOString() }))
}

/**
 * The trainer answers. Accepting makes them the batch's trainer. The batch belongs to another branch, so this one
 * write runs as the system, after checking the request is this trainer's own and still waiting.
 */
export async function decideTrainerRequest(actor: Actor, id: string, accept: boolean, note?: string | null) {
  const reqId = uuid.parse(id)
  return withOrgSystem(actor.orgId, async (tx) => {
    const [r] = (await tx.execute<{ id: string; batch_id: string }>(sql`
      select id, batch_id from trainer_requests where id = ${reqId} and trainer_id = ${actor.userId} and status = 'pending' for update`)).rows
    if (!r) throw new Error('This request is no longer waiting')
    await tx.execute(sql`update trainer_requests set status = ${accept ? 'accepted' : 'declined'}, decided_by = ${actor.userId}, decided_at = now(), decision_note = ${note?.trim().slice(0, 300) || null} where id = ${r.id}`)
    if (accept) await tx.execute(sql`update batches set trainer_id = ${actor.userId} where id = ${r.batch_id}`)
    await audit(tx, actor, { action: accept ? 'accept' : 'decline', entity: 'trainer_request', entityId: r.id, after: { batchId: r.batch_id } })
  })
}
