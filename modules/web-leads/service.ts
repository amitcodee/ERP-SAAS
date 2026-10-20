// Website leads: the forms sent on the institute websites (one per city, e.g. techcadd-<city>).
// Each one is kept here as it arrived (web_leads), then placed in a branch as a Lead:
//   1. by the website's address, when a branch has that website set (Branches > website), else
//   2. by place, when the site's address or the lead's location names exactly one branch's city, else
//   3. it waits, shown under its website, until head office sends it to a branch (weblead:assign).
// Branch staff with weblead:read see their own branch's website leads; head office sees every website (RLS).
import { and, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { assertCan } from '@/lib/auth/permissions'
import { auditLogs, branches, webLeads } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { placeWebEnquiry } from '../enquiries/service'
import { log } from '@/lib/log'
import { isMobile, normalizePhone } from '../people/phone'

/** 'https://www.TechcaddLudhiana.com/contact?x=1' -> 'techcaddludhiana.com'. Null when it is not a web address. */
export function siteHostOf(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? host : null
  } catch {
    return null
  }
}

const text = (max: number) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable()).optional()

/** What a website sends. `site` (or `sourceUrl`) says which website; the rest is the form. Extra fields are kept as sent. */
export const webLeadInput = z.object({
  site: text(500),
  sourceUrl: text(2000),
  externalId: text(200),
  name: z.preprocess((v) => (v == null ? '' : String(v).trim()), z.string().min(1, 'name is required').max(200)),
  phone: text(40),
  email: text(200),
  course: text(200),
  location: text(200),
  message: text(4000),
  submittedAt: z.preprocess((v) => (v == null || v === '' ? undefined : v), z.coerce.date().optional()),
}).passthrough()
export type WebLeadInput = z.input<typeof webLeadInput>

type LeadRow = typeof webLeads.$inferSelect

/** The branch a website lead belongs to, and how that was decided; null when no branch can be told. */
export async function matchBranch(tx: Tx, host: string, location: string | null): Promise<{ branchId: string; by: 'website' | 'location' } | null> {
  const [own] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.websiteHost, host), eq(branches.isActive, true)))
  if (own) return { branchId: own.id, by: 'website' }
  // By place: exactly one branch's city IS the site's name (techcaddludhiana.com, techcadd-ludhiana.in, ludhiana.techcadd.com)
  // or is a whole word of the lead's location ("Model Town, Ludhiana"). Whole words only: "Zirakpur" is not "Zira".
  const all = await tx.select({ id: branches.id, city: branches.city }).from(branches).where(eq(branches.isActive, true))
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const labels = host.split('.').slice(0, -1) // without the top-level part (.com, .in)
  const siteNames = new Set(labels.flatMap((l) => [l.replace(/^techcadd-?/, ''), ...l.split('-')]).filter((x) => x && x !== 'techcadd' && x !== 'www'))
  const place = ` ${words(location ?? '').join(' ')} `
  const hits = all.filter((b) => {
    const city = words(b.city ?? '')
    if (city.join('').length < 3) return false
    return siteNames.has(city.join('')) || siteNames.has(city.join('-')) || place.includes(` ${city.join(' ')} `)
  })
  return hits.length === 1 ? { branchId: hits[0].id, by: 'location' } : null
}

export const NO_MOBILE = 'No valid mobile number, so it could not be made a lead. Call or e-mail them from the details here.'

/**
 * Makes the stored website lead a Lead of `branchId`, or records why it cannot be one. Making the lead runs in its own
 * savepoint: if it fails, the website lead is still kept (with the reason) and head office can send it again.
 */
async function placeIn(tx: Tx, lead: LeadRow, branchId: string, by: 'website' | 'location' | 'manual', byUser: string | null) {
  let placed: Awaited<ReturnType<typeof placeWebEnquiry>> | null = null
  let problem: string | null = isMobile(lead.phone) ? null : NO_MOBILE
  if (!problem) {
    try {
      placed = await tx.transaction((sp) => placeWebEnquiry(sp as Tx, branchId, { name: lead.name, phone: lead.phone!, email: lead.email, course: lead.course, location: lead.location, message: lead.message, sourceUrl: lead.sourceUrl, siteHost: lead.siteHost, submittedAt: lead.submittedAt }, byUser))
    } catch (e) {
      log.error('weblead.place_failed', { id: lead.id, error: e })
      problem = 'It could not be made a lead (a server error). Head office can send it again.'
    }
  }
  await tx.update(webLeads).set({ branchId, matchedBy: by, enquiryId: placed?.enquiryId ?? null, placedBy: byUser, placedAt: new Date(), problem }).where(eq(webLeads.id, lead.id))
  return { placed, problem }
}

/**
 * One website lead arriving (webhook or import). Runs as the org's system (withOrgSystem). Safe to send twice: with the
 * website's own id (externalId) the second copy is ignored.
 */
export async function ingestWebLead(tx: Tx, raw: WebLeadInput) {
  const input = webLeadInput.parse(raw)
  const host = siteHostOf(input.site) ?? siteHostOf(input.sourceUrl)
  if (!host) throw new Error('site (the website address) or sourceUrl is required')
  const { site: _s, sourceUrl, externalId, name, phone, email, course, location, message, submittedAt, ...extra } = input
  // Other fields the form had are kept as sent, up to 8 KB. The page link is kept only when it is a web address.
  const extraJson = Object.keys(extra).length ? JSON.stringify(extra) : ''
  const [lead] = await tx.insert(webLeads).values({
    siteHost: host, sourceUrl: sourceUrl && /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null, externalId: externalId ?? null, name, phone: phone ?? null,
    phoneNorm: phone ? normalizePhone(phone) : null, email: email?.toLowerCase() ?? null, course: course ?? null, location: location ?? null,
    message: message ?? null, payload: !extraJson ? null : extraJson.length <= 8192 ? extra : { note: 'other form fields left out (over 8 KB)' },
    ...(submittedAt && !Number.isNaN(submittedAt.getTime()) ? { submittedAt } : {}),
  }).onConflictDoNothing().returning()
  if (!lead) return { status: 'duplicate' as const, site: host }
  const match = await matchBranch(tx, host, lead.location)
  if (!match) return { status: 'waiting' as const, id: lead.id, site: host }
  const { placed, problem } = await placeIn(tx, lead, match.branchId, match.by, null)
  const status = placed ? (placed.existing ? 'added_to_existing' as const : 'placed' as const) : problem === NO_MOBILE ? 'invalid_phone' as const : 'not_placed' as const
  return { status, id: lead.id, site: host, branchId: match.branchId, matchedBy: match.by }
}

/** Once a branch's website is set: its leads that were still waiting go to it. Returns how many. */
export async function claimSiteLeads(tx: Tx, branchId: string, host: string, byUser: string | null) {
  const waiting = await tx.select().from(webLeads).where(and(eq(webLeads.siteHost, host), isNull(webLeads.branchId))).orderBy(webLeads.submittedAt)
  for (const lead of waiting) await placeIn(tx, lead, branchId, 'website', byUser)
  return waiting.length
}

export type WebLeadRow = {
  id: string; siteHost: string; sourceUrl: string | null; name: string; phone: string | null; email: string | null; course: string | null
  location: string | null; message: string | null; submittedAt: string; branchId: string | null; branchName: string | null
  matchedBy: string | null; enquiryId: string | null; enquiryNo: string | null; problem: string | null
}
export type WebSite = { host: string; total: number; waiting: number; branchName: string | null }

/**
 * Website leads, newest first. Filters: site (host), state (waiting | placed | problem), q (name / phone / email).
 * Head office sees every website; a branch sees what was given to it (RLS).
 */
/** max: the most rows at once (the screen pages by 200 at most; a download takes them all). */
export async function listWebLeads(tx: Tx, actor: Actor, opts: { site?: string; state?: string; q?: string; limit?: number; offset?: number; max?: number } = {}) {
  assertCan(actor, 'read', 'weblead')
  const parts = [sql`true`]
  if (opts.site) parts.push(eq(webLeads.siteHost, opts.site))
  if (opts.state === 'waiting') parts.push(isNull(webLeads.branchId))
  if (opts.state === 'placed') parts.push(isNotNull(webLeads.enquiryId))
  if (opts.state === 'problem') parts.push(isNotNull(webLeads.problem))
  const q = opts.q?.trim()
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    parts.push(or(ilike(webLeads.name, like), ilike(webLeads.email, like), ...(q.replace(/\D/g, '').length >= 4 ? [ilike(webLeads.phoneNorm, `%${q.replace(/\D/g, '')}%`)] : []))!)
  }
  const where = and(...parts)
  const rows = await tx.execute<Record<string, never>>(sql`
    select web_leads.id, web_leads.site_host, web_leads.source_url, web_leads.name, web_leads.phone, web_leads.email, web_leads.course, web_leads.location,
      web_leads.message, web_leads.submitted_at, web_leads.branch_id, b.name as branch_name, web_leads.matched_by, web_leads.enquiry_id, e.enquiry_no, web_leads.problem
    from web_leads left join branches b on b.id = web_leads.branch_id left join enquiries e on e.id = web_leads.enquiry_id
    where ${where}
    order by web_leads.submitted_at desc, web_leads.created_at desc
    limit ${Math.min(opts.limit ?? 50, opts.max ?? 200)} offset ${opts.offset ?? 0}`)
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from web_leads where ${where}`)).rows
  // Every website seen so far, with the branch it belongs to (when one has it set).
  const sites = await tx.execute<{ host: string; total: number; waiting: number; branch_name: string | null }>(sql`
    select w.site_host as host, count(*)::int as total, count(*) filter (where w.branch_id is null)::int as waiting, min(b.name) as branch_name
    from web_leads w left join branches b on b.website_host = w.site_host group by w.site_host order by w.site_host`)
  return {
    total: n,
    rows: rows.rows.map((r): WebLeadRow => ({
      id: r.id, siteHost: r.site_host, sourceUrl: r.source_url, name: r.name, phone: r.phone, email: r.email, course: r.course, location: r.location,
      message: r.message, submittedAt: new Date(r.submitted_at).toISOString(), branchId: r.branch_id, branchName: r.branch_name, matchedBy: r.matched_by,
      enquiryId: r.enquiry_id, enquiryNo: r.enquiry_no, problem: r.problem,
    })),
    sites: sites.rows.map((s): WebSite => ({ host: s.host, total: s.total, waiting: s.waiting, branchName: s.branch_name })),
  }
}

/** Head office sends a website lead that has no branch yet to a branch, where it becomes a Lead. */
export async function assignWebLead(tx: Tx, actor: Actor, raw: { id: string; branchId: string }) {
  assertCan(actor, 'assign', 'weblead')
  const { id, branchId } = z.object({ id: z.string().uuid(), branchId: z.string().uuid('Choose a branch') }).parse(raw)
  const [lead] = await tx.select().from(webLeads).where(eq(webLeads.id, id)).for('update')
  if (!lead) throw new Error('Website lead not found')
  if (lead.enquiryId) throw new Error('This website lead is already a lead in a branch')
  const [branch] = await tx.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.isActive, true)))
  if (!branch) throw new Error('Branch not found')
  if (!isMobile(lead.phone)) throw new Error('This lead has no valid mobile number, so it cannot be made a lead. Contact them from the details shown.')
  const { placed, problem } = await placeIn(tx, lead, branchId, 'manual', actor.userId)
  await tx.insert(auditLogs).values({ userId: actor.userId, branchId, action: 'assign', entity: 'web_lead', entityId: id, after: { site: lead.siteHost, branchId, enquiryId: placed?.enquiryId ?? null, problem } as never })
  return { placed: !!placed, existing: !!placed?.existing, problem }
}


const editInput = z.object({
  id: z.string().uuid(),
  name: z.preprocess((v) => String(v ?? '').trim(), z.string().min(1, 'Name is required').max(200)),
  phone: text(40), email: text(200), course: text(200), location: text(200), message: text(4000),
})

/**
 * Head office corrects a website lead as it arrived (a typo in the name or number, a missing course). When it is
 * already a lead, the lead is not touched: edit it there.
 */
export async function editWebLead(tx: Tx, actor: Actor, raw: z.input<typeof editInput>) {
  assertCan(actor, 'assign', 'weblead')
  const v = editInput.parse(raw)
  const [lead] = await tx.select().from(webLeads).where(eq(webLeads.id, v.id)).for('update')
  if (!lead) throw new Error('Website lead not found')
  const after = { name: v.name, phone: v.phone ?? null, phoneNorm: v.phone ? normalizePhone(v.phone) : null, email: v.email?.toLowerCase() ?? null, course: v.course ?? null, location: v.location ?? null } // the message stays as the website sent it
  await tx.update(webLeads).set({ ...after, problem: lead.problem === NO_MOBILE && isMobile(after.phone) ? null : lead.problem }).where(eq(webLeads.id, v.id))
  await tx.insert(auditLogs).values({ userId: actor.userId, branchId: lead.branchId, action: 'update', entity: 'web_lead', entityId: v.id, before: { name: lead.name, phone: lead.phone, email: lead.email, course: lead.course, location: lead.location } as never, after: after as never })
  return { isLead: !!lead.enquiryId }
}

/** Head office removes a website lead that is spam or a duplicate. Only while it is not a lead yet. */
export async function deleteWebLead(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'assign', 'weblead')
  if (!z.string().uuid().safeParse(id).success) throw new Error('Website lead not found')
  const [lead] = await tx.select().from(webLeads).where(eq(webLeads.id, id)).for('update')
  if (!lead) throw new Error('Website lead not found')
  if (lead.enquiryId) throw new Error('It is already a lead in a branch. Close or delete the lead there instead.')
  await tx.delete(webLeads).where(eq(webLeads.id, id))
  await tx.insert(auditLogs).values({ userId: actor.userId, branchId: lead.branchId, action: 'delete', entity: 'web_lead', entityId: id, before: { site: lead.siteHost, name: lead.name, phone: lead.phone } as never })
}
