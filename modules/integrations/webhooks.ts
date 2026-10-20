// Outgoing webhooks for n8n, Zapier, Make or any tool that takes an HTTPS POST. An event is queued in the same
// transaction as the change that caused it (emit_event), then delivered by the scheduler every minute, signed:
//   X-Techcadd-Signature: sha256=<hex HMAC-SHA256 of the raw body with the webhook's secret>
// Failed deliveries are retried (1 min, 5 min, 30 min, 2 h, 6 h) and then marked failed.
import { createHmac, randomBytes } from 'crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { seal, unseal } from '@/lib/secret-box'
import { assertPublicHost } from '@/lib/net-guard'
import { txOrg, withOrgSystem, type Tx } from '@/lib/db/withTenant'
import { assertModule } from '@/lib/plan/limits'

export const EVENTS = [
  { key: 'lead.created', label: 'New lead or enquiry', what: 'A lead is added (by staff, a call, or a website form).' },
  { key: 'registration.created', label: 'Student registered', what: 'A student is registered for a course.' },
  { key: 'payment.received', label: 'Fee payment received', what: 'A payment is recorded and its receipt issued.' },
  { key: 'certificate.issued', label: 'Certificate issued', what: 'A course certificate is issued.' },
  { key: 'internship.letter_issued', label: 'Internship letter issued', what: 'A selection letter or completion certificate is issued.' },
] as const
export type EventKey = (typeof EVENTS)[number]['key']

/** Queues an event for every active webhook that wants it. Call inside the transaction that made the change. */
export async function emit(tx: Tx, event: EventKey, data: Record<string, unknown>) {
  const payload = { event, id: randomBytes(9).toString('base64url'), occurredAt: new Date().toISOString(), data }
  await tx.execute(sql`select emit_event(${event}, ${JSON.stringify(payload)}::jsonb)`)
}

export type WebhookRow = {
  id: string; name: string; url: string; events: string[]; isActive: boolean; createdAt: string
  lastStatus: number | null; lastDeliveryAt: string | null; lastError: string | null; pending: number; failed: number; sent: number
}
export type DeliveryRow = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; error: string | null; createdAt: string; sentAt: string | null; payload: unknown }

const input = z.object({
  name: z.string().trim().min(2, 'Give it a name').max(80),
  url: z.string().trim().url('Enter the full address, e.g. https://n8n.example.com/webhook/…').refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) address'),
  events: z.array(z.string().refine((e) => e === '*' || EVENTS.some((x) => x.key === e), 'Unknown event')).min(1, 'Pick at least one event'),
})
/** Student data goes out in these calls: only to a public address, and encrypted when the panel is live. */
async function checkUrl(url: string) {
  const u = new URL(url)
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error('Use an https address')
  await assertPublicHost(u.hostname)
}

export async function listWebhooks(tx: Tx): Promise<WebhookRow[]> {
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select w.id, w.name, w.url, w.events, w.is_active, w.created_at, w.last_status, w.last_delivery_at, w.last_error,
      count(d.*) filter (where d.status = 'pending')::int as pending, count(d.*) filter (where d.status = 'failed')::int as failed, count(d.*) filter (where d.status = 'sent')::int as sent
    from webhooks w left join webhook_deliveries d on d.webhook_id = w.id group by w.id order by w.created_at`)).rows
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), url: String(r.url), events: r.events as string[], isActive: !!r.is_active, createdAt: iso(r.created_at)!,
    lastStatus: (r.last_status as number) ?? null, lastDeliveryAt: iso(r.last_delivery_at), lastError: (r.last_error as string) ?? null,
    pending: Number(r.pending), failed: Number(r.failed), sent: Number(r.sent),
  }))
}

/** Adds a webhook. Its signing secret is returned (and can be shown again later). */
export async function createWebhook(tx: Tx, userId: string, raw: { name: string; url: string; events: string[] }) {
  await assertModule(tx, 'api', 'Webhooks')
  const v = input.parse(raw)
  await checkUrl(v.url)
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  const [r] = (await tx.execute<{ id: string }>(sql`
    insert into webhooks (name, url, secret, events, created_by) values (${v.name}, ${v.url}, ${seal(secret, 'settings-secrets', await txOrg(tx))}, ${`{${v.events.map((e) => `"${e.replace(/"/g, '')}"`).join(',')}}`}::text[], ${userId}) returning id`)).rows
  return { id: r.id, secret }
}

export async function updateWebhook(tx: Tx, id: string, raw: { name: string; url: string; events: string[]; isActive: boolean }) {
  const v = input.parse(raw)
  await checkUrl(v.url)
  await tx.execute(sql`update webhooks set name = ${v.name}, url = ${v.url}, events = ${`{${v.events.map((e) => `"${e.replace(/"/g, '')}"`).join(',')}}`}::text[], is_active = ${raw.isActive} where id = ${z.string().uuid().parse(id)}`)
}

export async function deleteWebhook(tx: Tx, id: string) {
  await tx.execute(sql`delete from webhooks where id = ${z.string().uuid().parse(id)}`)
}

export async function webhookSecret(tx: Tx, id: string): Promise<string | null> {
  const [r] = (await tx.execute<{ secret: string }>(sql`select secret from webhooks where id = ${z.string().uuid().parse(id)}`)).rows
  return unseal<string>(r?.secret, 'settings-secrets', await txOrg(tx))
}

export async function listDeliveries(tx: Tx, webhookId: string, limit = 30): Promise<DeliveryRow[]> {
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select id, event, status, attempts, response_status, error, created_at, sent_at, payload from webhook_deliveries
    where webhook_id = ${z.string().uuid().parse(webhookId)} order by created_at desc limit ${limit}`)).rows
  return rows.map((r) => ({
    id: String(r.id), event: String(r.event), status: String(r.status), attempts: Number(r.attempts), responseStatus: (r.response_status as number) ?? null,
    error: (r.error as string) ?? null, createdAt: new Date(r.created_at as string).toISOString(), sentAt: r.sent_at ? new Date(r.sent_at as string).toISOString() : null, payload: r.payload,
  }))
}

/** Sends one signed POST. */
async function post(url: string, secret: string, event: string, deliveryId: string, payload: unknown) {
  const body = JSON.stringify(payload)
  const sig = createHmac('sha256', secret).update(body).digest('hex')
  try {
    await checkUrl(url) // again at send time: the name may point somewhere else since it was saved
    const res = await fetch(url, {
      method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'manual', // a redirect could lead to an internal address
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'techcadd-webhooks/1', 'X-Techcadd-Event': event, 'X-Techcadd-Delivery': deliveryId, 'X-Techcadd-Signature': `sha256=${sig}` },
    })
    const text = (await res.text().catch(() => '')).slice(0, 500)
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body: text, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (e) {
    return { status: null, ok: false, body: '', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }
}

/** Sends a "ping" right away (Settings → Integrations → Send test), and logs it like any delivery. */
export async function testWebhook(tx: Tx, id: string) {
  const [w] = (await tx.execute<{ id: string; url: string; secret: string }>(sql`select id, url, secret from webhooks where id = ${z.string().uuid().parse(id)}`)).rows
  if (!w) throw new Error('Webhook not found')
  const secret = unseal<string>(w.secret, 'settings-secrets', await txOrg(tx))
  if (!secret) throw new Error('The secret cannot be read (AUTH_SECRET changed?): delete and add this webhook again')
  const payload = { event: 'ping', id: randomBytes(9).toString('base64url'), occurredAt: new Date().toISOString(), data: { message: 'Test from techcadd panel', webhookId: w.id } }
  const [d] = (await tx.execute<{ id: string }>(sql`insert into webhook_deliveries (webhook_id, event, payload, status) values (${w.id}, 'ping', ${JSON.stringify(payload)}::jsonb, 'pending') returning id`)).rows
  const r = await post(w.url, secret, 'ping', d.id, payload)
  await tx.execute(sql`update webhook_deliveries set status = ${r.ok ? 'sent' : 'failed'}, attempts = 1, response_status = ${r.status}, response_body = ${r.body}, error = ${r.error}, sent_at = ${r.ok ? sql`now()` : null} where id = ${d.id}`)
  await tx.execute(sql`update webhooks set last_status = ${r.status}, last_delivery_at = now(), last_error = ${r.error} where id = ${w.id}`)
  return { ok: r.ok, status: r.status, error: r.error }
}

const BACKOFF_MIN = [1, 5, 30, 120, 360]

/** Delivers what is due for one org. Run every minute by the scheduler; several runs never send the same delivery twice. */
export async function deliverPendingWebhooks(orgId: string, limit = 50) {
  return withOrgSystem(orgId, async (tx) => {
    const due = (await tx.execute<{ id: string; webhook_id: string; event: string; payload: unknown; attempts: number; url: string; secret: string }>(sql`
      select d.id, d.webhook_id, d.event, d.payload, d.attempts, w.url, w.secret from webhook_deliveries d join webhooks w on w.id = d.webhook_id
      where d.status = 'pending' and d.next_attempt_at <= now() and w.is_active order by d.created_at limit ${limit} for update of d skip locked`)).rows
    let sent = 0, failed = 0
    for (const d of due) {
      const secret = unseal<string>(d.secret, 'settings-secrets', orgId)
      const r = secret ? await post(d.url, secret, d.event, d.id, d.payload) : { status: null, ok: false, body: '', error: 'Secret unreadable' }
      const attempts = d.attempts + 1
      const giveUp = !r.ok && attempts > BACKOFF_MIN.length
      if (r.ok) sent++
      else if (giveUp) failed++
      await tx.execute(sql`update webhook_deliveries set status = ${r.ok ? 'sent' : giveUp ? 'failed' : 'pending'}, attempts = ${attempts}, response_status = ${r.status},
        response_body = ${r.body}, error = ${r.error}, sent_at = ${r.ok ? sql`now()` : null},
        next_attempt_at = now() + make_interval(mins => ${BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]}) where id = ${d.id}`)
      await tx.execute(sql`update webhooks set last_status = ${r.status}, last_delivery_at = now(), last_error = ${r.error} where id = ${d.webhook_id}`)
    }
    // keep student data in the delivery log no longer than needed: a paused webhook's calls give up after 7 days,
    // and finished calls are cleared after 30
    await tx.execute(sql`update webhook_deliveries d set status = 'failed', error = 'Webhook paused' from webhooks w
      where w.id = d.webhook_id and not w.is_active and d.status = 'pending' and d.created_at < now() - interval '7 days'`)
    await tx.execute(sql`delete from webhook_deliveries where status <> 'pending' and created_at < now() - interval '30 days'`)
    return { due: due.length, sent, failed }
  })
}

// ---- what each event carries (read in the same transaction, so it is exactly what was saved)
const one = async (tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute<Record<string, unknown>>(q)).rows[0] ?? null
const PERSON = sql`trim(p.first_name || ' ' || coalesce(p.last_name, ''))`

export async function emitLead(tx: Tx, enquiryId: string, via: string) {
  const d = await one(tx, sql`
    select e.id, e.enquiry_no, e.created_at, e.status::text as status, ${PERSON} as name, p.phone, p.email, src.value as source,
      d.name as department, c.title as course, b.code as branch_code, b.name as branch
    from enquiries e join persons p on p.id = e.person_id join branches b on b.id = e.branch_id left join lookups src on src.id = e.source_id
    left join departments d on d.id = e.department_id left join courses c on c.id = e.course_id where e.id = ${enquiryId}`)
  if (d) await emit(tx, 'lead.created', { ...d, via })
}

export async function emitRegistration(tx: Tx, registrationId: string) {
  const d = await one(tx, sql`
    select r.id, r.reg_no, r.enrollment_date, r.joining_date, r.expected_end_date, ${PERSON} as name, p.phone, p.email,
      coalesce(c.title, r.custom_course_title) as course, d.name as department, b.code as branch_code, b.name as branch, round(r.total_fee / 100.0, 2) as total_fee
    from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id join departments d on d.id = r.department_id
    left join courses c on c.id = r.course_id where r.id = ${registrationId}`)
  if (d) await emit(tx, 'registration.created', d)
}

export async function emitPayment(tx: Tx, paymentId: string, balanceAfter: number) {
  const d = await one(tx, sql`
    select pm.id, rc.receipt_no, pm.paid_at, round(pm.amount / 100.0, 2) as amount, m.value as mode, pm.txn_ref, r.reg_no, ${PERSON} as name, p.phone, p.email,
      b.code as branch_code, b.name as branch
    from payments pm join registrations r on r.id = pm.registration_id join persons p on p.id = r.person_id join branches b on b.id = pm.branch_id
    left join receipts rc on rc.payment_id = pm.id left join lookups m on m.id = pm.mode_id where pm.id = ${paymentId}`)
  if (d) await emit(tx, 'payment.received', { ...d, balance_after: Math.round(balanceAfter) / 100 })
}

export async function emitCertificate(tx: Tx, certificateId: string) {
  const d = await one(tx, sql`
    select ce.id, ce.cert_no, ce.issued_at, ce.verification_hash, r.reg_no, ${PERSON} as name, p.email, coalesce(c.title, r.custom_course_title) as course,
      b.code as branch_code, b.name as branch
    from certificates ce join registrations r on r.id = ce.registration_id join persons p on p.id = r.person_id join branches b on b.id = ce.branch_id
    left join courses c on c.id = r.course_id where ce.id = ${certificateId}`)
  if (d) await emit(tx, 'certificate.issued', d)
}

export async function emitInternshipLetter(tx: Tx, internshipId: string, letter: 'selection' | 'completion') {
  const d = await one(tx, sql`
    select i.id, i.ref_no, i.name, i.email, i.phone, i.designation, i.from_date, i.to_date, b.code as branch_code, b.name as branch
    from internships i join branches b on b.id = i.branch_id where i.id = ${internshipId}`)
  if (d) await emit(tx, 'internship.letter_issued', { ...d, letter })
}
