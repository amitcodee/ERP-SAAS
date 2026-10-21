// WhatsApp messages on events (lead, call, visit, registration, certificate; lib/notify/whatsapp.ts lists them).
// Queued in the outbox inside the event's own transaction, so a save that fails sends nothing, and delivered within
// a minute by the panel's scheduler. Nothing is queued while WhatsApp is off or the message is switched off in
// Settings, so switching it on later never sends old news. Imports of old data pass `quiet` and send nothing.
import { sql } from 'drizzle-orm'
import { getConfig } from '@/lib/config/store'
import { notifications } from '@/lib/db/schema'
import { txOrg, type Tx } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { todayIST } from '@/lib/ist'
import { branchWord, waParams, waText, WA_MESSAGES, type WaEventKey } from '@/lib/notify/whatsapp'
import { brandIn } from '@/lib/brand'

export type WaEvent = {
  branchId: string
  personId?: string | null
  registrationId?: string | null
  phone: string | null | undefined
  vars: Record<string, string | null | undefined>
  /** What makes it the same message twice (the outbox never queues one key twice). */
  once: string
}

/** Whether this message goes out at all: WhatsApp on, and the message not switched off in Settings. */
export async function waOn(tx: Tx, key: WaEventKey) {
  const { config: c } = await getConfig(await txOrg(tx), 'whatsapp').catch(() => ({ config: null }))
  const m = WA_MESSAGES[key] as { optIn?: boolean }
  return !!c?.enabled && (m.optIn ? !!c.on?.includes(key) : !c.off?.includes(key))
}

/** Queues one event message. Never fails the event: a problem is logged and the save goes on. Returns whether it was queued. */
export async function queueWhatsApp(tx: Tx, key: WaEventKey, e: WaEvent): Promise<boolean> {
  try {
    if (!e.phone?.replace(/\D/g, '')) return false
    if (!(await waOn(tx, key))) return false
    const params = waParams(key, e.vars)
    const body = waText(key, params, (await brandIn(tx)).name)
    // a savepoint: a refused insert must not spoil the event's own transaction
    const rows = await tx.transaction((sp) => sp.insert(notifications).values({
      branchId: e.branchId, personId: e.personId ?? null, registrationId: e.registrationId ?? null,
      channel: 'whatsapp', template: WA_MESSAGES[key].covers[0], toAddress: e.phone!, body, params,
      dedupeKey: `wa:${key}:${e.once}`,
    }).onConflictDoNothing({ target: notifications.dedupeKey }).returning({ id: notifications.id }))
    return rows.length > 0
  } catch (err) {
    log.warn('whatsapp.queue_failed', { key, error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

type PersonRow = { first_name: string; phone: string | null; branch: string }
const personOf = async (tx: Tx, personId: string, branchId: string) => (await tx.execute<PersonRow>(sql`
  select p.first_name, p.phone, b.name as branch from persons p, branches b where p.id = ${personId} and b.id = ${branchId}`)).rows[0] as PersonRow | undefined
/** The branch as the message names it ("Mohali", not "<institute> Mohali"). */
const branchOf = async (tx: Tx, branch: string) => branchWord(branch, (await brandIn(tx)).name)

/** "Thank you for choosing <institute>": a new lead or a random call. One a day per person, whichever came first. */
export async function thankForEnquiry(tx: Tx, branchId: string, personId: string) {
  if (!(await waOn(tx, 'enquiry_thanks'))) return false
  const p = await personOf(tx, personId, branchId)
  if (!p) return false
  return queueWhatsApp(tx, 'enquiry_thanks', { branchId, personId, phone: p.phone, vars: { first_name: p.first_name, branch: await branchOf(tx, p.branch) }, once: `${personId}:${todayIST()}` })
}

/** "Thank you for visiting": once a day per person. */
export async function thankForVisit(tx: Tx, branchId: string, personId: string) {
  if (!(await waOn(tx, 'visit_thanks'))) return false
  const p = await personOf(tx, personId, branchId)
  if (!p) return false
  return queueWhatsApp(tx, 'visit_thanks', { branchId, personId, phone: p.phone, vars: { first_name: p.first_name, branch: await branchOf(tx, p.branch) }, once: `${personId}:${todayIST()}` })
}

/** "You have successfully registered": once per registration. */
export async function confirmRegistration(tx: Tx, registrationId: string) {
  if (!(await waOn(tx, 'registration'))) return false
  const [r] = (await tx.execute<PersonRow & { branch_id: string; person_id: string; reg_no: string; course: string | null }>(sql`
    select p.first_name, p.phone, b.name as branch, r.branch_id, r.person_id, r.reg_no, coalesce(co.title, r.custom_course_title, d.name) as course
    from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id
      left join courses co on co.id = r.course_id left join departments d on d.id = r.department_id
    where r.id = ${registrationId}`)).rows
  if (!r) return false
  return queueWhatsApp(tx, 'registration', {
    branchId: r.branch_id, personId: r.person_id, registrationId, phone: r.phone,
    vars: { first_name: r.first_name, branch: await branchOf(tx, r.branch), reg_no: r.reg_no, course: r.course ?? 'your course' }, once: registrationId,
  })
}

/** "Your certificate has been issued", with the link to view / download it. Once per certificate request. */
export async function announceCertificate(tx: Tx, requestId: string, origin: string) {
  if (!(await waOn(tx, 'certificate'))) return false
  const [c] = (await tx.execute<{ first_name: string; phone: string | null; course: string | null; cert_no: string; hash: string; branch_id: string; person_id: string; registration_id: string }>(sql`
    select p.first_name, p.phone, coalesce(co.title, r.custom_course_title, d.name) as course, ce.cert_no, ce.verification_hash as hash,
      ce.branch_id, r.person_id, r.id as registration_id
    from certificates ce join registrations r on r.id = ce.registration_id join persons p on p.id = r.person_id
      left join courses co on co.id = r.course_id left join departments d on d.id = r.department_id
    where ce.request_id = ${requestId} and not ce.is_revoked`)).rows
  if (!c) return false
  return queueWhatsApp(tx, 'certificate', {
    branchId: c.branch_id, personId: c.person_id, registrationId: c.registration_id, phone: c.phone,
    vars: { first_name: c.first_name, course: c.course ?? 'your course', cert_no: c.cert_no, link: `${origin}/verify/${c.hash}/certificate` }, once: requestId,
  })
}

/**
 * "<name> was absent from today's class": to each absent student's parent or guardian (else the student), once per
 * class and student. Only for today's class (a register filled in late tells nobody of an old absence).
 */
export async function alertAbsences(tx: Tx, sessionId: string, registrationIds: string[]) {
  if (!registrationIds.length || !(await waOn(tx, 'absence'))) return 0
  const rows = (await tx.execute<{ registration_id: string; person_id: string; branch_id: string; first_name: string; phone: string | null; guardian_phone: string | null; batch: string; branch: string }>(sql`
    select r.id as registration_id, p.id as person_id, s.branch_id, p.first_name, p.phone, p.guardian_phone, bt.name as batch, b.name as branch
    from class_sessions s join batches bt on bt.id = s.batch_id join branches b on b.id = s.branch_id
      join registrations r on r.id = any(${`{${registrationIds.join(',')}}`}::uuid[]) join persons p on p.id = r.person_id
    where s.id = ${sessionId} and s.session_date = ${todayIST()}::date`)).rows
  let n = 0
  for (const r of rows) {
    const phone = r.guardian_phone?.replace(/\D/g, '').length ? r.guardian_phone : r.phone
    if (await queueWhatsApp(tx, 'absence', { branchId: r.branch_id, personId: r.person_id, registrationId: r.registration_id, phone, vars: { first_name: r.first_name, batch: r.batch, branch: await branchOf(tx, r.branch) }, once: `${sessionId}:${r.registration_id}` })) n++
  }
  return n
}
