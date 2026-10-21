// Fee reminders: generate (idempotent) -> queue in the outbox -> deliver through a provider.
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { assertCan } from '@/lib/auth/permissions'
import { notifications, persons } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import type { Channel, Provider } from '@/lib/notify/providers'
import type { RemindersConfig } from '@/lib/config/store'
import { todayIST } from '@/lib/ist'
import { branchWord, WA_MESSAGES, waMessageFor } from '@/lib/notify/whatsapp'
import { brandIn } from '@/lib/brand'

/** The reminder stages from Settings → Reminders: days before the due date, the due date, days overdue. */
export function reminderStages(c: RemindersConfig) {
  return [
    ...c.daysBefore.map((d) => ({ key: `due_in_${d}`, offset: -d, kind: 'soon' as const, template: 'fee_due_soon' })),
    ...(c.onDueDay ? [{ key: 'due_today', offset: 0, kind: 'today' as const, template: 'fee_due_today' }] : []),
    ...c.overdueDays.map((d) => ({ key: `overdue_${d}`, offset: d, kind: 'overdue' as const, template: 'fee_overdue' })),
  ]
}

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** Fills a reminder text: {{name}} {{first_name}} {{amount}} {{due_date}} {{reg_no}} {{branch}} {{institute}}. */
export function reminderText(text: string, v: { name: string; amount: number; dueDate: string; regNo: string; branch: string; institute: string }) {
  const vars: Record<string, string> = { name: v.name, first_name: v.name.split(' ')[0], amount: inr(v.amount), due_date: fmtDate(v.dueDate), reg_no: v.regNo, branch: branchWord(v.branch, v.institute), institute: v.institute }
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m)
}

/**
 * Queues the reminders that are due today, on each channel set in Settings → Reminders. Safe to run any number of
 * times a day: each (installment, stage, channel) has a unique dedupe key, so nothing is ever queued twice.
 * Skips students who are on hold / discontinued and installments already paid.
 */
export async function generateFeeReminders(tx: Tx, cfg: RemindersConfig, today = todayIST()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('today must be YYYY-MM-DD')
  const stages = reminderStages(cfg).filter((s) => Number.isInteger(s.offset) && Math.abs(s.offset) <= 365)
  if (!stages.length || !cfg.channels.length) return { considered: 0, queued: 0 }
  const res = await tx.execute<{
    inst_id: string; branch_id: string; person_id: string; registration_id: string; amount: number; due_date: string
    name: string; phone: string; email: string | null; reg_no: string; branch: string; days: number
  }>(sql`
    select i.id as inst_id, i.branch_id, r.person_id, r.id as registration_id, i.amount, i.due_date::text,
      trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.phone, p.email, r.reg_no, b.name as branch, (${today}::date - i.due_date) as days
    from installments i
    join registrations r on r.id = i.registration_id and r.status = 'active'
    join persons p on p.id = r.person_id
    join branches b on b.id = i.branch_id
    where i.status = 'scheduled' and (${today}::date - i.due_date) = any(${`{${stages.map((s) => s.offset).join(',')}}`}::int[])`)

  let queued = 0
  const { name: institute } = await brandIn(tx)
  for (const r of res.rows) {
    const stage = stages.find((s) => s.offset === Number(r.days))!
    for (const channel of cfg.channels) {
      const to = channel === 'email' ? r.email : r.phone
      if (!to) continue
      const body = reminderText(cfg.texts[stage.kind], { name: r.name, amount: r.amount, dueDate: r.due_date, regNo: r.reg_no, branch: r.branch, institute })
      const inserted = await tx
        .insert(notifications)
        .values({ branchId: r.branch_id, personId: r.person_id, registrationId: r.registration_id, channel, template: stage.template, toAddress: to, body, dedupeKey: `fee:${r.inst_id}:${stage.key}:${channel}` })
        .onConflictDoNothing({ target: notifications.dedupeKey })
        .returning({ id: notifications.id })
      queued += inserted.length
    }
  }
  return { considered: res.rows.length, queued }
}

/** Delivers queued messages. No provider for a channel => they simply stay queued. Retryable failures stay queued (max 3 tries). */
export async function dispatchQueued(tx: Tx, providerFor: (c: Channel, branchId?: string | null) => Promise<Provider | null>, limit = 100) {
  const rows = await tx.select().from(notifications).where(eq(notifications.status, 'queued')).orderBy(asc(notifications.createdAt)).limit(limit).for('update', { skipLocked: true })
  const out = { sent: 0, failed: 0, waiting: 0 }
  // names for the channels that greet by name (WhatsApp)
  const ids = [...new Set(rows.map((n) => n.personId).filter((id): id is string => !!id))]
  const names = new Map(ids.length ? (await tx.select({ id: persons.id, first: persons.firstName, last: persons.lastName }).from(persons).where(inArray(persons.id, ids)))
    .map((p) => [p.id, [p.first, p.last].filter(Boolean).join(' ')]) : [])
  for (const n of rows) {
    // an event message that waited too long (WhatsApp was off, AiSensy down) is dropped, not sent days late
    const wa = n.channel === 'whatsapp' ? waMessageFor(n.template) : null
    const maxAge = wa ? (WA_MESSAGES[wa] as { maxAgeHours?: number }).maxAgeHours : undefined
    if (maxAge && Date.now() - n.createdAt.getTime() > maxAge * 3600_000) {
      await tx.update(notifications).set({ status: 'skipped', error: `Not sent: waited more than ${maxAge} hours` }).where(eq(notifications.id, n.id))
      continue
    }
    const provider = await providerFor(n.channel, n.branchId) // e-mail goes out from the branch's own server when it has one
    if (!provider) { out.waiting++; continue }
    const r = await provider.send({ channel: n.channel, to: n.toAddress, body: n.body, template: n.template, name: n.personId ? names.get(n.personId) : null, params: n.params, campaign: n.campaign, media: n.media, ...(n.html ? { html: n.html } : {}), ...(n.subject ? { subject: n.subject } : {}) }).catch((e) => ({ ok: false as const, error: String(e), retryable: true }))
    if (r.ok) {
      await tx.update(notifications).set({ status: 'sent', sentAt: new Date(), providerRef: r.ref ?? null, error: null }).where(eq(notifications.id, n.id))
      out.sent++
    } else {
      const tries = Number((n.error ?? '').match(/^\[(\d+)\]/)?.[1] ?? 0) + 1
      const giveUp = !r.retryable || tries >= 3
      await tx.update(notifications).set({ status: giveUp ? 'failed' : 'queued', error: `[${tries}] ${r.error}` }).where(eq(notifications.id, n.id))
      if (giveUp) out.failed++
      else out.waiting++
    }
  }
  return out
}

export type NotificationLog = { counts: { queued: number; sent: number; failed: number }; rows: { id: string; channel: string; template: string; to: string; body: string; status: string; error: string | null; createdAt: string; sentAt: string | null }[] }

export async function listNotifications(tx: Tx, actor: Actor, limit = 30): Promise<NotificationLog> {
  assertCan(actor, 'read', 'report')
  const res = await tx.execute<{ id: string; channel: string; template: string; to_address: string; body: string; status: string; error: string | null; created_at: string; sent_at: string | null }>(sql`
    select id, channel, template, to_address, body, status, error, created_at::text, sent_at::text
    from notifications order by created_at desc limit ${limit}`)
  const [c] = (await tx.execute<{ queued: number; sent: number; failed: number }>(sql`
    select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed from notifications`)).rows
  return { counts: { queued: c.queued, sent: c.sent, failed: c.failed }, rows: res.rows.map((r) => ({ id: r.id, channel: r.channel, template: r.template, to: r.to_address, body: r.body, status: r.status, error: r.error, createdAt: r.created_at, sentAt: r.sent_at })) }
}
