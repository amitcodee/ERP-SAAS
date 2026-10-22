// The institute's own admission form: a public page on its address (/apply), and the same form inside its website
// (/apply/embed, placed by /apply/embed.js). What a visitor sends arrives as a website lead (ingestWebLead), so it shows
// under Web Leads and becomes a Lead of the branch they chose, with the ad or post that brought them (utm_*).
// Settings → Admission form switches it on and words it (lib/config/store.ts, admission_form).
// No sign-in: each sending is limited per connection and per institute (the action), carries a signed ticket from the
// page (sent too fast or too late is refused) and has a field people never see (filled only by robots).
import { createHmac, timingSafeEqual } from 'crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { serverSecret } from '@/lib/auth/secret'
import { getConfig, type AdmissionFormConfig } from '@/lib/config/store'
import { withOrgSystem, type Tx } from '@/lib/db/withTenant'
import { isMobile } from '../people/phone'
import { ingestWebLead, siteHostOf } from './service'

/** The ad / post fields a page may pass on (kept with the lead as sent). */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>

/** Robots fill a form at once; a person takes a few seconds. A page left open longer than this is reloaded. */
const MIN_MS = 3_000
const MAX_MS = 12 * 3600_000

const sign = (orgId: string, at: number) => createHmac('sha256', serverSecret('AUTH_SECRET')).update(`apply|${orgId}|${at}`).digest('base64url')

/** The ticket the page carries: when it was drawn, signed for this institute. */
export function applyTicket(orgId: string, now = Date.now()) {
  return `${now}.${sign(orgId, now)}`
}

/** Why a ticket is not accepted, or null when it is. */
export function ticketProblem(orgId: string, ticket: string, now = Date.now()): string | null {
  const [at, mac] = String(ticket ?? '').split('.')
  const t = Number(at)
  const want = Number.isFinite(t) ? sign(orgId, t) : ''
  if (!mac || !want || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return 'This form is out of date: please reload the page and send it again.'
  if (now - t < MIN_MS) return 'That was very quick: please check your details and send again.'
  if (now - t > MAX_MS) return 'This form was open a long time: please reload the page and send it again.'
  return null
}

export type ApplyForm = {
  enabled: boolean
  form: AdmissionFormConfig
  branches: { id: string; name: string; code: string; city: string | null }[]
  courses: string[]
  ticket: string
}

/** What the public page needs: the wording, the branches to choose from, the courses on offer. */
export async function applyFormIn(tx: Tx, orgId: string, config: AdmissionFormConfig): Promise<ApplyForm> {
  const branches = (await tx.execute<{ id: string; name: string; code: string; city: string | null }>(sql`
    select id, name, code, city from branches where is_active order by name`)).rows
  const courses = (await tx.execute<{ title: string }>(sql`
    select distinct title from courses where is_active and status = 'approved' order by title limit 400`)).rows.map((c) => c.title)
  return { enabled: config.enabled && branches.length > 0, form: config, branches, courses, ticket: applyTicket(orgId) }
}

export async function applyForm(orgId: string): Promise<ApplyForm> {
  const { config } = await getConfig(orgId, 'admission_form')
  return withOrgSystem(orgId, (tx) => applyFormIn(tx, orgId, config))
}

const field = (max: number) => z.preprocess((v) => (v == null ? '' : String(v).trim()), z.string().max(max))

export const applyInput = z.object({
  name: z.preprocess((v) => String(v ?? '').trim().replace(/\s+/g, ' '), z.string().min(2, 'Please write your full name').max(120)),
  phone: field(20),
  email: field(160).refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), 'Please check the e-mail address'),
  course: field(200),
  branchId: field(40),
  location: field(160),
  message: field(1500),
  /** The page the form is on: /apply itself, or the institute's website page holding /apply/embed. */
  page: field(1500),
  referrer: field(500),
  utm: z.record(z.string(), z.unknown()).optional(),
  ticket: field(200),
  /** Hidden from people: whatever fills it is a robot. */
  website: field(500),
})
/** What the page sends (anything missing counts as empty). */
export type ApplyInput = {
  name: string; phone: string; ticket: string; email?: string; course?: string; branchId?: string; location?: string; message?: string
  page?: string; referrer?: string; utm?: Record<string, unknown>; website?: string
}

export type ApplyResult = { status: 'received'; thanks: string }

/**
 * A visitor sends the form. `ownHost`: this institute's address (a sending from /apply itself is from there).
 * Returns the thank-you; a robot (the hidden field) is thanked too and nothing is kept.
 */
export async function submitApplication(orgId: string, raw: ApplyInput, ownHost: string): Promise<ApplyResult> {
  const { config } = await getConfig(orgId, 'admission_form')
  return withOrgSystem(orgId, (tx) => submitApplicationIn(tx, orgId, config, raw, ownHost))
}

export async function submitApplicationIn(tx: Tx, orgId: string, config: AdmissionFormConfig, raw: ApplyInput, ownHost: string, now = Date.now()): Promise<ApplyResult> {
  const f = await applyFormIn(tx, orgId, config)
  if (!f.enabled) throw new Error('Admissions are not open online right now. Please call the institute.')
  const v = applyInput.parse(raw)
  const thanks = f.form.thanks.trim() || 'Thank you! Our team will call you shortly.'
  if (v.website) return { status: 'received', thanks }
  const why = ticketProblem(orgId, v.ticket, now)
  if (why) throw new Error(why)
  if (!isMobile(v.phone)) throw new Error('Please give a valid 10-digit mobile number')
  const branch = f.branches.length === 1 ? f.branches[0] : f.branches.find((b) => b.id === v.branchId)
  if (!branch) throw new Error('Please choose the centre nearest to you')

  // the website page the form is on (embedded), else this institute's own address
  const pageHost = siteHostOf(v.page)
  const site = pageHost ?? siteHostOf(ownHost) ?? 'admission-form'
  const utm: Utm = {}
  for (const k of UTM_KEYS) {
    const x = v.utm?.[k]
    if (typeof x === 'string' && x.trim()) utm[k] = x.trim().slice(0, 200)
  }
  await ingestWebLead(tx, {
    site, sourceUrl: pageHost ? v.page : null, name: v.name, phone: v.phone,
    email: f.form.askEmail ? v.email || null : null,
    course: v.course || null,
    location: f.form.askLocation ? v.location || null : null,
    message: f.form.askMessage ? v.message || null : null,
    ...utm, ...(v.referrer && /^https?:\/\//i.test(v.referrer) ? { referrer: v.referrer } : {}), form: 'admission',
  }, { branchId: branch.id })
  return { status: 'received', thanks }
}
