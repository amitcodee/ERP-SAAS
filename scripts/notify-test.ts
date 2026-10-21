// Reminder generation, dedupe and delivery bookkeeping, in ONE rolled-back transaction, with a FAKE provider.
import { eq } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, notifications, users } from '../lib/db/schema'
import { aisensy, type Provider } from '../lib/notify/providers'
import { WA_MESSAGES, waMessageFor, waParams } from '../lib/notify/whatsapp'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { recordPayment } from '../modules/fees/service'
import { dispatchQueued, generateFeeReminders, listNotifications, reminderText } from '../modules/notifications/service'
import { DEFAULTS } from '../lib/config/store'
import { createRegistration, transitionRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { sql } from 'drizzle-orm'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const day = (base: string, off: number) => new Date(new Date(base + 'T00:00:00Z').getTime() + off * 86400000).toISOString().slice(0, 10)

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'NA1', name: 'Notify A' }).returning()
      const mk = async (name: string) => (await tx.insert(users).values({ branchId: a.id, name, email: `${name}@n.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [uc, uacc, um] = [await mk('c'), await mk('acc'), await mk('m')]
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const acct: Actor = { userId: uacc.id, orgId: ORG, role: 'accountant', branchId: a.id }
      const mgr: Actor = { userId: um.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await applyTenant(tx, mgr)

      const due = '2026-11-10'
      const mkStudent = async (fn: string, phone: string) => {
        const reg = await createRegistration(tx, counselor, { person: { firstName: fn, phone }, departmentId: dept.id, totalFee: 1000000, enrollmentDate: '2026-10-01' }, { quiet: true }) // no registration WhatsApp: only the reminders are counted
        await recordPayment(tx, counselor, { registrationId: reg.id, amount: 400000, modeId: cash.id, nextInstallmentDate: due, nextInstallmentAmount: 600000 })
        return reg
      }
      const s1 = await mkStudent('Ravi', '9200000001')
      const s2 = await mkStudent('Hold', '9200000002')
      await transitionRegistration(tx, mgr, { registrationId: s2.id, to: 'on_hold', note: 'break' })

      const early = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['sms'] }, day(due, -5))
      check('nothing due 5 days before -> nothing queued', early.queued === 0)
      const soon = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['sms'] }, day(due, -2))
      check('2 days before: exactly one reminder (on-hold student skipped)', soon.queued === 1, JSON.stringify(soon))
      const again = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['sms'] }, day(due, -2))
      check('running the job twice queues nothing new (idempotent)', again.queued === 0)
      const late = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['sms'] }, day(due, 7))
      check('7 days overdue queues an overdue reminder', late.queued === 1)
      const other = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['email'] }, day(due, -2))
      check('email channel with no email on file queues nothing', other.queued === 0)

      const q = await tx.select().from(notifications).where(eq(notifications.branchId, a.id))
      check('message text carries name, amount, date, reg no', q.some((n) => /Dear Ravi/.test(n.body) && n.body.includes('6,000') && n.body.includes(s1.regNo) && /10 Nov 2026/.test(n.body)), q[0]?.body)
      check('overdue text says overdue', q.some((n) => /overdue/.test(n.body)))
      check('reminderText: due-today wording', /due today/.test(reminderText(DEFAULTS.reminders.texts.today, { name: 'A B', amount: 100, dueDate: due, regNo: 'R', branch: 'X', institute: 'Sample Institute' })))

      const sentLog: string[] = [], nameLog: (string | null | undefined)[] = []
      const ok: Provider = { name: 'fake-ok', async send(m) { sentLog.push(m.to); nameLog.push(m.name); return { ok: true, ref: 'ref-1' } } }
      const none = await dispatchQueued(tx, async () => null)
      const stillQueued = (await tx.select().from(notifications).where(eq(notifications.branchId, a.id))).filter((n) => n.status === 'queued').length
      check('no provider configured -> messages stay queued', none.sent === 0 && stillQueued === 2 && none.waiting >= 2, JSON.stringify({ none, stillQueued })) // waiting also counts other queued mail in a dev database
      const flaky: Provider = { name: 'flaky', async send() { return { ok: false, error: 'HTTP 503', retryable: true } } }
      for (let i = 0; i < 3; i++) await dispatchQueued(tx, async () => flaky)
      const afterFlaky = await tx.select().from(notifications).where(eq(notifications.branchId, a.id))
      check('retryable failure retried 3 times, then marked failed', afterFlaky.every((n) => n.status === 'failed') && afterFlaky[0].error!.startsWith('[3]'), afterFlaky[0].error ?? '')

      const later = await generateFeeReminders(tx, { ...DEFAULTS.reminders, channels: ['sms'] }, day(due, 15))
      check('15 days overdue is a new stage -> new message', later.queued === 1)
      const done = await dispatchQueued(tx, async () => ok)
      check('successful delivery marks sent', done.sent === 1 && sentLog.length === 1 && sentLog[0] === '9200000001')
      check('the person’s name goes with the message', !!nameLog[0] && nameLog[0].length > 1, String(nameLog[0]))
      const sentRow = (await tx.select().from(notifications).where(eq(notifications.status, 'sent')))[0]
      check('sent row has provider ref and timestamp', sentRow.providerRef === 'ref-1' && !!sentRow.sentAt)

      const log = await listNotifications(tx, mgr)
      check('manager sees the log with counts', log.counts.sent === 1 && log.counts.failed >= 1 && log.rows.length >= 3)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await aisensyChecks()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
/** The AiSensy request, with fetch stubbed: nothing leaves the machine. */
async function aisensyChecks() {
  check('every reminder stage and the test go out as a WhatsApp message', ['fee_due_soon', 'fee_due_today', 'fee_overdue', 'settings_test'].every((t) => waMessageFor(t) === 'fee_reminder') && waMessageFor('birthday') === null)
  check('template parameters are one line and never empty', JSON.stringify(waParams('fee_reminder', { text: 'Due\n\n  soon\t!' })) === JSON.stringify(['Due soon !']))
  const real = globalThis.fetch
  const sent = { url: '', body: {} as Record<string, unknown> }
  let reply = new Response(JSON.stringify({ success: 'true', submitted_message_id: 'as-1' }), { status: 200 })
  globalThis.fetch = (async (url: string, init: RequestInit) => { sent.url = url; sent.body = JSON.parse(String(init.body)); return reply }) as typeof fetch
  try {
    const cfg = { ...DEFAULTS.whatsapp, provider: 'aisensy' as const, campaigns: {} }
    const r = await aisensy(cfg, 'key-1').send({ channel: 'whatsapp', to: '098765 43210', template: 'fee_overdue', body: 'Dear Aman, your ₹5,000 is overdue.', name: 'Aman  Gill' })
    const b = sent.body
    check('AiSensy: campaign from the catalogue, number with country code, name and params', r.ok && (r as { ref?: string }).ref === 'as-1' && sent.url.includes('backend.aisensy.com')
      && b.campaignName === WA_MESSAGES.fee_reminder.campaign && b.destination === '919876543210' && b.userName === 'Aman Gill' && b.apiKey === 'key-1'
      && JSON.stringify(b.templateParams) === JSON.stringify(['Dear Aman, your ₹5,000 is overdue.']), JSON.stringify(b))
    await aisensy({ ...cfg, campaigns: { fee_reminder: 'my_campaign' } }, 'k').send({ channel: 'whatsapp', to: '9876543210', template: 'fee_due_soon', body: 'x' })
    check('AiSensy: a campaign name saved in Settings wins', sent.body.campaignName === 'my_campaign')
    reply = new Response(JSON.stringify({ name: '_PlatformError', message: 'Unauthorized' }), { status: 401 })
    const bad = await aisensy(cfg, 'k').send({ channel: 'whatsapp', to: '9876543210', template: 'fee_due_soon', body: 'x' })
    check('AiSensy: a refused key fails for good with the reason', !bad.ok && !bad.retryable && bad.error.includes('Unauthorized'), bad.ok ? '' : bad.error)
    reply = new Response('oops', { status: 502 })
    const down = await aisensy(cfg, 'k').send({ channel: 'whatsapp', to: '9876543210', template: 'fee_due_soon', body: 'x' })
    check('AiSensy: a server error is retried', !down.ok && down.retryable)
    const none = await aisensy(cfg, 'k').send({ channel: 'whatsapp', to: '9876543210', template: 'birthday', body: 'x' })
    check('AiSensy: a message with no campaign is refused, not sent', !none.ok && !none.retryable)
  } finally { globalThis.fetch = real }
}
main()
