// Bulk WhatsApp: head office lists the campaigns made in AiSensy (Settings → WhatsApp campaigns) with what fills their
// {{1}}, {{2}}…; staff with broadcast:create send one to the students or leads they pick (Bulk WhatsApp page). Every
// message goes through the outbox like the panel's other messages (one per phone number per send) and is delivered
// within minutes by the scheduler. A branch sends to its own people only; head office to every branch or one.
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/permissions'
import { audit } from '@/lib/audit'
import { notifications, waBroadcasts, waCampaigns } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { branchWord, campaignText, WA_AUDIENCES, WA_FIELD_KEYS, WA_FIELDS, type WaCampaignParam } from '@/lib/notify/whatsapp'
import { assertWithinLimit } from '@/lib/plan/limits'

/** The most a single send may go to (a bigger list: split it by branch, course or category). */
export const MAX_RECIPIENTS = 5000

// ---- Campaigns (head office) -------------------------------------------------------------------------------------

export type CampaignRow = {
  id: string; label: string; campaign: string; params: WaCampaignParam[]; body: string | null
  mediaUrl: string | null; mediaName: string | null; audience: keyof typeof WA_AUDIENCES; isActive: boolean; updatedAt: string
}

export const campaignInput = z.object({
  label: z.string().trim().min(2, 'Give it a name staff will recognise').max(80),
  campaign: z.string().trim().min(2, 'Enter the AiSensy campaign name').max(120).regex(/^[^\s].*$/, 'Enter the AiSensy campaign name'),
  params: z.array(z.object({ field: z.enum(WA_FIELD_KEYS as [keyof typeof WA_FIELDS, ...(keyof typeof WA_FIELDS)[]]), label: z.string().trim().max(60).optional() })).max(10)
    .refine((ps) => ps.every((p) => p.field !== 'text' || (p.label ?? '').length >= 2), 'Say what to type for each “Typed when sending” parameter'),
  body: z.string().trim().max(1024).optional().transform((v) => v || null),
  mediaUrl: z.union([z.literal(''), z.string().trim().url('The media link must be a full https:// link').startsWith('https://', 'The media link must be https://')]).optional().transform((v) => v || null),
  mediaName: z.string().trim().max(120).optional().transform((v) => v || null),
  audience: z.enum(['any', 'students', 'leads']),
  isActive: z.boolean(),
}).refine((c) => !c.body || [...c.body.matchAll(/\{\{(\d+)\}\}/g)].every((m) => Number(m[1]) >= 1 && Number(m[1]) <= c.params.length),
  { message: 'The template text uses a {{n}} that has no parameter below: add one for each {{n}}', path: ['body'] })
export type CampaignInput = z.input<typeof campaignInput>

const toRow = (c: typeof waCampaigns.$inferSelect): CampaignRow => ({
  id: c.id, label: c.label, campaign: c.campaign, params: c.params, body: c.body, mediaUrl: c.mediaUrl, mediaName: c.mediaName,
  audience: c.audience, isActive: c.isActive, updatedAt: c.updatedAt.toISOString(),
})

export async function listCampaigns(tx: Tx, opts: { activeOnly?: boolean } = {}): Promise<CampaignRow[]> {
  const rows = await tx.select().from(waCampaigns).where(opts.activeOnly ? eq(waCampaigns.isActive, true) : undefined).orderBy(desc(waCampaigns.isActive), waCampaigns.label)
  return rows.map(toRow)
}

/** Adds (no id) or changes a campaign. Head office only (the database also allows only head office). */
export async function saveCampaign(tx: Tx, actor: Actor, id: string | null, input: CampaignInput) {
  if (actor.role !== 'super_admin') throw new Error('Only head office can set up WhatsApp campaigns')
  const v = campaignInput.parse(input)
  const params = v.params.map((p) => (p.field === 'text' ? { field: p.field, label: p.label } : { field: p.field }))
  const values = { ...v, params, updatedAt: new Date() }
  const clash = (await tx.select({ id: waCampaigns.id }).from(waCampaigns).where(sql`lower(${waCampaigns.campaign}) = lower(${v.campaign})`))[0]
  if (clash && clash.id !== id) throw new Error(`The campaign “${v.campaign}” is already listed`)
  const [row] = id
    ? await tx.update(waCampaigns).set(values).where(eq(waCampaigns.id, id)).returning()
    : await tx.insert(waCampaigns).values({ ...values, createdBy: actor.userId }).returning()
  if (!row) throw new Error('That campaign no longer exists')
  await audit(tx, actor, { action: id ? 'update' : 'create', entity: 'wa_campaign', entityId: row.id, after: values })
  return toRow(row)
}

// ---- Who it goes to ----------------------------------------------------------------------------------------------

const uuid = z.string().uuid()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const audienceInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('students'),
    branchId: uuid.nullish(),
    statuses: z.array(z.enum(['active', 'on_hold', 'completed', 'discontinued'])).min(1, 'Pick at least one student status'),
    fee: z.enum(['any', 'due', 'overdue']).default('any'),
    departmentId: uuid.nullish(), courseId: uuid.nullish(),
    from: day.nullish(), to: day.nullish(),
  }),
  z.object({
    kind: z.literal('leads'),
    branchId: uuid.nullish(),
    types: z.array(z.enum(['call', 'lead', 'visited'])).min(1, 'Pick random calls, leads or visited enquiries'),
    categoryIds: z.array(uuid).max(50).default([]),
    interestedOnly: z.boolean().default(false),
    notRegistered: z.boolean().default(true),
    departmentId: uuid.nullish(), courseId: uuid.nullish(),
    from: day.nullish(), to: day.nullish(),
  }),
])
export type AudienceInput = z.input<typeof audienceInput>
type Audience = z.output<typeof audienceInput>

export type Recipient = {
  person_id: string; branch_id: string; registration_id: string | null; phone: string
  first_name: string; last_name: string | null; branch: string; course: string | null; reg_no: string | null; balance: number | null
}

/** The branch a send is limited to: a branch's own staff always their branch; head office the one picked (or all). */
const branchOf = (actor: Actor, a: Audience) => actor.branchId ?? a.branchId ?? null

/** Everyone the filter picks, one row per phone number (the latest record wins), up to `limit`. */
async function recipients(tx: Tx, actor: Actor, a: Audience, limit: number): Promise<{ rows: Recipient[]; total: number }> {
  const branch = branchOf(actor, a)
  const where = (alias: string, at: string): SQL[] => {
    const col = (c: string) => sql.raw(`${alias}.${c}`)
    return [
      branch ? sql`${col('branch_id')} = ${branch}` : sql`true`,
      a.courseId ? sql`${col('course_id')} = ${a.courseId}` : a.departmentId ? sql`${col('department_id')} = ${a.departmentId}` : sql`true`,
      a.from ? sql`(${sql.raw(at)} at time zone 'Asia/Kolkata')::date >= ${a.from}::date` : sql`true`,
      a.to ? sql`(${sql.raw(at)} at time zone 'Asia/Kolkata')::date <= ${a.to}::date` : sql`true`,
    ]
  }
  let base: SQL
  if (a.kind === 'students') {
    const fee = a.fee === 'due' ? sql`coalesce(fb.balance, 0) > 0`
      : a.fee === 'overdue' ? sql`exists (select 1 from installments i where i.registration_id = r.id and i.status = 'scheduled' and i.due_date < ${todayIST()}::date)`
        : sql`true`
    base = sql`
      select p.id as person_id, r.branch_id, r.id as registration_id, p.phone, p.first_name, p.last_name, b.name as branch,
        coalesce(co.title, r.custom_course_title, d.name) as course, r.reg_no, fb.balance::int as balance, r.created_at as at
      from registrations r join persons p on p.id = r.person_id join branches b on b.id = r.branch_id
        left join courses co on co.id = r.course_id left join departments d on d.id = r.department_id
        left join v_fee_balance fb on fb.registration_id = r.id
      where p.deleted_at is null and r.status::text in (${sql.join(a.statuses.map((s) => sql`${s}`), sql`, `)}) and ${fee}
        and ${sql.join(where('r', 'r.created_at'), sql` and `)}`
  } else {
    const cats = (alias: string) => a.categoryIds.length ? sql`${sql.raw(alias)}.category_id in (${sql.join(a.categoryIds.map((c) => sql`${c}`), sql`, `)})` : sql`true`
    const interested = (alias: string) => a.interestedOnly ? sql`${sql.raw(alias)}.interested is true` : sql`true`
    const parts: SQL[] = []
    if (a.types.includes('call')) parts.push(sql`
      select p.id as person_id, k.branch_id, null::uuid as registration_id, p.phone, p.first_name, p.last_name, b.name as branch,
        coalesce(co.title, d.name) as course, null::text as reg_no, null::int as balance, k.called_at as at
      from calls k join persons p on p.id = k.person_id join branches b on b.id = k.branch_id
        left join courses co on co.id = k.course_id left join departments d on d.id = k.department_id
      where k.enquiry_id is null and ${cats('k')} and ${interested('k')} and ${sql.join(where('k', 'k.called_at'), sql` and `)}`)
    const enq = (['lead', 'visited'] as const).filter((t) => a.types.includes(t))
    if (enq.length) parts.push(sql`
      select p.id, e.branch_id, null::uuid, p.phone, p.first_name, p.last_name, b.name, coalesce(co.title, d.name), null::text, null::int, e.created_at
      from enquiries e join persons p on p.id = e.person_id join branches b on b.id = e.branch_id
        left join courses co on co.id = e.course_id left join departments d on d.id = e.department_id
      where ${enq.length === 2 ? sql`true` : enq[0] === 'visited' ? sql`e.visited` : sql`not e.visited`}
        and ${cats('e')} and ${interested('e')} and ${sql.join(where('e', 'e.created_at'), sql` and `)}`)
    base = sql`
      select x.* from (${sql.join(parts, sql` union all `)}) x join persons p on p.id = x.person_id
      where p.deleted_at is null ${a.notRegistered ? sql`and not exists (select 1 from registrations r where r.person_id = x.person_id)` : sql``}`
  }
  const res = await tx.execute<Recipient & { n: number }>(sql`
    with picked as (${base}),
    one as (
      select distinct on (right(regexp_replace(phone, '\\D', '', 'g'), 10)) * from picked
      where length(regexp_replace(coalesce(phone, ''), '\\D', '', 'g')) >= 10
      order by right(regexp_replace(phone, '\\D', '', 'g'), 10), at desc
    )
    select person_id, branch_id, registration_id, phone, first_name, last_name, branch, course, reg_no, balance, count(*) over ()::int as n
    from one order by first_name, last_name limit ${limit}`)
  return { rows: res.rows, total: res.rows[0]?.n ?? 0 }
}

const inr = (paise: number | null) => (paise == null ? '' : '₹' + Math.max(0, Math.round(paise / 100)).toLocaleString('en-IN'))
/** The values of a campaign's parameters for one person, cleaned as WhatsApp takes them (one line, never empty). */
export function paramsFor(c: Pick<CampaignRow, 'params'>, r: Recipient, texts: string[]): string[] {
  let t = 0
  return c.params.map((p) => {
    const v = p.field === 'text' ? texts[t++]
      : p.field === 'first_name' ? r.first_name
        : p.field === 'full_name' ? [r.first_name, r.last_name].filter(Boolean).join(' ')
          : p.field === 'branch' ? branchWord(r.branch)
            : p.field === 'course' ? r.course ?? 'your course'
              : p.field === 'reg_no' ? r.reg_no
                : inr(r.balance)
    return (v ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-'
  })
}

const summaryOf = (a: Audience, names: { branch?: string | null; course?: string | null; categories?: string[] }) => {
  const bits = a.kind === 'students'
    ? [`Students (${a.statuses.map((s) => s.replace('_', ' ')).join(', ')})`, a.fee === 'due' ? 'fee still due' : a.fee === 'overdue' ? 'installment overdue' : null]
    : [a.types.map((t) => ({ call: 'random calls', lead: 'leads', visited: 'visited enquiries' })[t]).join(', ').replace(/^./, (x) => x.toUpperCase()),
      names.categories?.length ? `category ${names.categories.join(', ')}` : null, a.interestedOnly ? 'interested only' : null, a.notRegistered ? 'not registered' : null]
  return [...bits, names.course ? `course ${names.course}` : null, names.branch ?? 'every branch',
    a.from || a.to ? `${a.kind === 'students' ? 'registered' : 'added'} ${a.from ?? '…'} to ${a.to ?? 'today'}` : null].filter(Boolean).join(' · ')
}

async function names(tx: Tx, actor: Actor, a: Audience) {
  const branch = branchOf(actor, a)
  const q = async (s: SQL) => (await tx.execute<{ name: string }>(s)).rows.map((r) => r.name)
  return {
    branch: branch ? (await q(sql`select name from branches where id = ${branch}`))[0] ?? null : null,
    course: a.courseId ? (await q(sql`select title as name from courses where id = ${a.courseId}`))[0] ?? null
      : a.departmentId ? (await q(sql`select name from departments where id = ${a.departmentId}`))[0] ?? null : null,
    categories: a.kind === 'leads' && a.categoryIds.length ? await q(sql`select name from lead_categories where id in (${sql.join(a.categoryIds.map((c) => sql`${c}`), sql`, `)}) order by name`) : [],
  }
}

async function campaignFor(tx: Tx, id: string) {
  const [c] = await tx.select().from(waCampaigns).where(and(eq(waCampaigns.id, uuid.parse(id)), eq(waCampaigns.isActive, true)))
  if (!c) throw new Error('That campaign is not available any more: pick another')
  return toRow(c)
}
const checkTexts = (c: CampaignRow, texts: string[]) => {
  const asks = c.params.filter((p) => p.field === 'text')
  const clean = asks.map((_, i) => (texts[i] ?? '').replace(/\s+/g, ' ').trim())
  const missing = asks.find((_, i) => !clean[i])
  if (missing) throw new Error(`Fill in “${missing.label}”`)
  if (clean.some((t) => t.length > 900)) throw new Error('Each typed value can be at most 900 characters')
  return clean
}

export type AudiencePreview = { total: number; summary: string; sample: { name: string; phone: string; branch: string; course: string | null; text: string }[] }

/** How many the filter picks, in words, and the first few as their message reads. */
export async function previewBroadcast(tx: Tx, actor: Actor, campaignId: string, input: AudienceInput, texts: string[]): Promise<AudiencePreview> {
  assertCan(actor, 'create', 'broadcast')
  const a = audienceInput.parse(input)
  const c = await campaignFor(tx, campaignId)
  const { rows, total } = await recipients(tx, actor, a, 8)
  const filled = c.params.filter((p) => p.field === 'text').map((_, i) => texts[i]?.trim() || '…')
  return {
    total, summary: summaryOf(a, await names(tx, actor, a)),
    sample: rows.map((r) => ({ name: [r.first_name, r.last_name].filter(Boolean).join(' '), phone: r.phone, branch: r.branch, course: r.course, text: campaignText(c.body, paramsFor(c, r, filled), c.campaign) })),
  }
}

/** Queues the campaign for everyone the filter picks. Returns the broadcast and how many were queued. */
export async function sendBroadcast(tx: Tx, actor: Actor, campaignId: string, input: AudienceInput, rawTexts: string[]) {
  assertCan(actor, 'create', 'broadcast')
  const a = audienceInput.parse(input)
  const c = await campaignFor(tx, campaignId)
  if (c.audience !== 'any' && c.audience !== a.kind) throw new Error(`“${c.label}” is meant for ${WA_AUDIENCES[c.audience].toLowerCase()} only`)
  const texts = checkTexts(c, rawTexts)
  const { rows, total } = await recipients(tx, actor, a, MAX_RECIPIENTS + 1)
  if (!total) throw new Error('Nobody matches this filter (or nobody has a mobile number)')
  await assertWithinLimit(tx, 'messagesPerMonth', Math.min(total, MAX_RECIPIENTS + 1))
  if (total > MAX_RECIPIENTS) throw new Error(`This picks ${total.toLocaleString('en-IN')} people; one send can go to at most ${MAX_RECIPIENTS.toLocaleString('en-IN')}. Narrow it by branch, course, category or dates.`)
  const [b] = await tx.insert(waBroadcasts).values({
    campaignId: c.id, branchId: branchOf(actor, a), audience: a, summary: summaryOf(a, await names(tx, actor, a)), texts, total, createdBy: actor.userId,
  }).returning({ id: waBroadcasts.id })
  const media = c.mediaUrl ? { url: c.mediaUrl, filename: c.mediaName || c.mediaUrl.split('/').pop()?.split('?')[0] || 'file' } : null
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(notifications).values(rows.slice(i, i + 500).map((r) => {
      const params = paramsFor(c, r, texts)
      return {
        branchId: r.branch_id, personId: r.person_id, registrationId: r.registration_id, channel: 'whatsapp' as const, template: 'broadcast',
        toAddress: r.phone, body: campaignText(c.body, params, c.campaign), params, campaign: c.campaign, media, broadcastId: b.id,
        dedupeKey: `bc:${b.id}:${r.phone.replace(/\D/g, '').slice(-10)}`,
      }
    })).onConflictDoNothing({ target: notifications.dedupeKey })
  }
  await audit(tx, actor, { action: 'create', entity: 'wa_broadcast', entityId: b.id, after: { campaign: c.campaign, total: rows.length } })
  return { id: b.id, queued: rows.length }
}

// ---- What was sent -----------------------------------------------------------------------------------------------

export type BroadcastRow = {
  id: string; campaign: string; label: string; summary: string; total: number; by: string | null; branch: string | null; at: string
  queued: number; sent: number; failed: number; skipped: number
}

export async function listBroadcasts(tx: Tx, actor: Actor, limit = 30): Promise<BroadcastRow[]> {
  assertCan(actor, 'read', 'broadcast')
  const res = await tx.execute<{ id: string; campaign: string; label: string; summary: string; total: number; by: string | null; branch: string | null; at: string; queued: number; sent: number; failed: number; skipped: number }>(sql`
    select w.id, c.campaign, c.label, w.summary, w.total, u.name as by, b.name as branch, w.created_at::text as at,
      count(n.id) filter (where n.status = 'queued')::int as queued, count(n.id) filter (where n.status = 'sent')::int as sent,
      count(n.id) filter (where n.status = 'failed')::int as failed, count(n.id) filter (where n.status = 'skipped')::int as skipped
    from wa_broadcasts w join wa_campaigns c on c.id = w.campaign_id left join users u on u.id = w.created_by left join branches b on b.id = w.branch_id
      left join notifications n on n.broadcast_id = w.id
    ${actor.branchId ? sql`where w.branch_id = ${actor.branchId}` : sql``}
    group by w.id, c.campaign, c.label, u.name, b.name order by w.created_at desc limit ${limit}`)
  return res.rows
}

/** A send's messages that failed, with why (to fix a number or a campaign). */
export async function broadcastFailures(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'read', 'broadcast')
  return (await tx.select({ to: notifications.toAddress, error: notifications.error }).from(notifications)
    .where(and(eq(notifications.broadcastId, uuid.parse(id)), inArray(notifications.status, ['failed', 'skipped']))).limit(200))
}
