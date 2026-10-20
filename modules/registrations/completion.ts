// Course completion. A registration becomes COMPLETED on its own once everything it was admitted for is done:
//   - the syllabus: one of the student's batches has covered every topic of the course;
//   - the course certificate is issued (and not revoked) — it carries the project certificate when one was chosen;
//   - the internship letters picked at admission (or on an internship set up later) are issued: the completion
//     certificate when it was asked for, else the selection letter.
// It is checked after each step that can finish the list (a class's topics, a certificate, a letter). A manager can
// also mark a course completed by hand, with a reason (e.g. a custom course with no syllabus in the panel).
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { registrationEvents, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'

export type Completion = {
  status: string
  syllabus: { covered: number; total: number; done: boolean }
  certificate: { done: boolean; project: boolean }
  internship: { needs: 'none' | 'offer' | 'completion'; done: boolean }
  missing: string[]
  ready: boolean
}

type Row = {
  id: string; status: string; total: number; covered: number; cert: boolean; project: boolean
  wants_offer: boolean; wants_completion: boolean; intern: boolean; offer_issued: boolean; completion_issued: boolean
}

const rowsFor = (tx: Tx, ids: string[]) => tx.execute<Row>(sql`
  select r.id, r.status::text as status, r.project_certificate as project,
    (select count(*)::int from course_topics t where t.course_id = r.course_id) as total,
    coalesce((select max(n) from (select count(distinct bt.topic_id)::int as n from batch_members m
      join batch_topics bt on bt.batch_id = m.batch_id join course_topics t on t.id = bt.topic_id and t.course_id = r.course_id
      where m.registration_id = r.id group by m.batch_id) x), 0) as covered,
    exists (select 1 from certificates c where c.registration_id = r.id and not c.is_revoked) as cert,
    r.internship_offer as wants_offer, r.internship_completion as wants_completion,
    it.id is not null as intern, coalesce(it.offer_issued_at is not null, false) as offer_issued, coalesce(it.completed_at is not null, false) as completion_issued
  from registrations r
  left join lateral (select i.id, i.offer_issued_at, i.completed_at from internships i where i.registration_id = r.id and i.status <> 'cancelled' order by i.created_at desc limit 1) it on true
  where r.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)

function judge(r: Row): Completion {
  const syllabus = { covered: Math.min(r.covered, r.total), total: r.total, done: r.total > 0 && r.covered >= r.total }
  const needs = r.wants_completion || r.intern ? 'completion' : r.wants_offer ? 'offer' : 'none'
  const internship = { needs, done: needs === 'none' || (needs === 'completion' ? r.completion_issued : r.offer_issued || r.completion_issued) } as Completion['internship']
  const missing: string[] = []
  if (!r.total) missing.push('No syllabus for this course in the panel')
  else if (!syllabus.done) missing.push(`Syllabus: ${syllabus.covered} of ${syllabus.total} topics covered`)
  if (!r.cert) missing.push(r.project ? 'Course and project certificate not issued' : 'Course certificate not issued')
  if (!internship.done) missing.push(needs === 'completion' ? 'Internship completion certificate not issued' : 'Internship selection letter not issued')
  return { status: r.status, syllabus, certificate: { done: r.cert, project: r.project }, internship, missing, ready: !missing.length }
}

/** Where one registration stands on the way to completion. */
export async function completionStatus(tx: Tx, actor: Actor, registrationId: string): Promise<Completion | null> {
  assertCan(actor, 'read', 'registration')
  const [r] = (await rowsFor(tx, [z.string().uuid().parse(registrationId)])).rows
  return r ? judge(r) : null
}

async function complete(tx: Tx, actor: Actor, id: string, from: string, note: string) {
  const [reg] = await tx.update(registrations).set({ status: 'completed', updatedAt: new Date() }).where(sql`${registrations.id} = ${id} and ${registrations.status} = ${from}`).returning({ branchId: registrations.branchId })
  if (!reg) return false
  await tx.insert(registrationEvents).values({ registrationId: id, branchId: reg.branchId, byUser: actor.userId, fromStatus: from as 'active', toStatus: 'completed', note })
  await audit(tx, actor, { action: 'transition', entity: 'registration', entityId: id, before: { status: from }, after: { status: 'completed', note } })
  return true
}

/** Completes every given ACTIVE registration whose list is done. Run on the server's own connection after the step that may have finished it. */
export async function completeIfDone(tx: Tx, actor: Actor, registrationIds: (string | null | undefined)[]) {
  const ids = [...new Set(registrationIds.filter((x): x is string => !!x))]
  if (!ids.length) return []
  const done: string[] = []
  for (const r of (await rowsFor(tx, ids)).rows) {
    if (r.status !== 'active' || !judge(r).ready) continue
    if (await complete(tx, actor, r.id, 'active', 'Course completed: syllabus covered and certificates issued')) done.push(r.id)
  }
  return done
}

/** A manager marks a course completed by hand, with a reason; what was still missing is kept with it. */
export async function markCompleted(tx: Tx, actor: Actor, raw: { registrationId: string; note: string }) {
  assertCan(actor, 'approve', 'registration')
  const id = z.string().uuid().parse(raw.registrationId)
  const note = z.string().trim().min(3, 'Say why the course is marked completed').max(500).parse(raw.note)
  const [r] = (await rowsFor(tx, [id])).rows
  if (!r) throw new Error('Registration not found')
  if (r.status !== 'active' && r.status !== 'on_hold') throw new Error(`A ${r.status.replace('_', ' ')} registration cannot be marked completed`)
  const missing = judge(r).missing
  await complete(tx, actor, id, r.status, missing.length ? `${note} (marked by hand; still missing: ${missing.join('; ')})` : note)
  return { missing }
}
