// Internship letters: interns, their selection letter and their completion certificate, made from templates.
//   add intern (= selection letter requested) -> manager issues the selection letter (text frozen)
//   -> completion requested (with what they did) -> manager issues the completion certificate (text frozen)
// Who may do what follows the certificate permissions: create = request, approve = issue. Templates: head office.
import { emitInternshipLetter } from '@/modules/integrations/webhooks'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { assertCan } from '@/lib/auth/permissions'
import { branches, courses, internships, letterCompanies, letterTemplates, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { durationWords, fill, longDate, monthYear } from '@/lib/letters/render'
import { plainLetterhead } from '@/lib/letters/letterhead'
import { STANDARD, type LetterKind } from '@/lib/letters/standard'
import { todayIST, yearIST } from '@/lib/ist'

/** What letters say when a company has no contact of its own (techcadd's HR). */
export const HR_PHONE = '98881-22291'
export const HR_EMAIL = 'hrmtechcadd@gmail.com'

const KINDS = ['internship_offer', 'internship_completion'] as const
const kindOf = (k: string): LetterKind => { if (!KINDS.includes(k as LetterKind)) throw new Error('Unknown letter'); return k as LetterKind }

// ---- companies
// The companies interns are taken on by (techcadd, Syntax Developer, Zabi Technologies…). Each has its own letter
// templates, letterhead and stamp; head office keeps them (Letter Templates → Companies).

export type LetterCompany = {
  id: string; name: string; legalName: string; contactPhone: string | null; contactEmail: string | null
  isDefault: boolean; isActive: boolean; hasLetterhead: boolean; hasStamp: boolean
}
const companyCols = {
  id: letterCompanies.id, name: letterCompanies.name, legalName: letterCompanies.legalName, contactPhone: letterCompanies.contactPhone, contactEmail: letterCompanies.contactEmail,
  isDefault: letterCompanies.isDefault, isActive: letterCompanies.isActive,
  hasLetterhead: sql<boolean>`${letterCompanies.letterhead} is not null`, hasStamp: sql<boolean>`${letterCompanies.stamp} is not null`,
}

/** Every company (techcadd first), or only the active ones (for the intern form). */
export async function listCompanies(tx: Tx, opts: { active?: boolean } = {}): Promise<LetterCompany[]> {
  const rows = await tx.select(companyCols).from(letterCompanies).where(opts.active ? eq(letterCompanies.isActive, true) : undefined)
    .orderBy(sql`${letterCompanies.isDefault} desc`, letterCompanies.sortOrder, letterCompanies.name)
  return rows.map((r) => ({ ...r, hasLetterhead: !!r.hasLetterhead, hasStamp: !!r.hasStamp }))
}

/** techcadd: what an intern or template without a company belongs to. */
export async function defaultCompanyId(tx: Tx): Promise<string> {
  const [c] = await tx.select({ id: letterCompanies.id }).from(letterCompanies).where(eq(letterCompanies.isDefault, true))
  if (!c) throw new Error('No default letter company')
  return c.id
}
const companyOr = async (tx: Tx, id: string | null | undefined) => id || defaultCompanyId(tx)

export const companyInput = z.object({
  name: z.preprocess((v) => String(v ?? '').trim().replace(/\s+/g, ' '), z.string().min(2, 'Give the company name').max(80)),
  legalName: z.preprocess((v) => String(v ?? '').trim().replace(/\s+/g, ' '), z.string().max(160)),
  contactPhone: z.preprocess((v) => String(v ?? '').trim() || null, z.string().max(40).nullable()),
  contactEmail: z.preprocess((v) => String(v ?? '').trim() || null, z.string().email('The contact e-mail is not valid').max(200).nullable()),
  isActive: z.boolean(),
})
export type CompanyInput = z.input<typeof companyInput>

/** Adds (id null) or changes a company. Head office. The default company (techcadd) cannot be switched off. */
export async function saveCompany(tx: Tx, actor: Actor, id: string | null, raw: CompanyInput) {
  assertCan(actor, 'update', 'setting')
  const v = companyInput.parse(raw)
  const legalName = v.legalName || v.name
  const [dup] = await tx.select({ id: letterCompanies.id }).from(letterCompanies).where(sql`lower(${letterCompanies.name}) = lower(${v.name})`)
  if (dup && dup.id !== id) throw new Error('A company with this name already exists')
  if (id) {
    const [cur] = await tx.select({ isDefault: letterCompanies.isDefault }).from(letterCompanies).where(eq(letterCompanies.id, id))
    if (!cur) throw new Error('Company not found')
    if (cur.isDefault && !v.isActive) throw new Error('techcadd is the main company and stays on')
    await tx.update(letterCompanies).set({ ...v, legalName, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(letterCompanies.id, id))
    await audit(tx, actor, { action: 'update', entity: 'letter_company', entityId: id, after: { name: v.name } })
    return id
  }
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select coalesce(max(sort_order), 0)::int + 1 as n from letter_companies`)).rows
  const [row] = await tx.insert(letterCompanies).values({ ...v, legalName, sortOrder: n, updatedBy: actor.userId }).returning({ id: letterCompanies.id })
  await audit(tx, actor, { action: 'create', entity: 'letter_company', entityId: row.id, after: { name: v.name } })
  return row.id
}

export const MAX_LETTER_IMAGE_BYTES = 5 * 1024 * 1024
/** A company's letterhead (a full A4 page image) or stamp / signature; null removes it. PNG or JPEG. */
export async function setCompanyImage(tx: Tx, actor: Actor, id: string, which: 'letterhead' | 'stamp', bytes: Buffer | null) {
  assertCan(actor, 'update', 'setting')
  let mime: string | null = null
  if (bytes) {
    if (bytes.length > MAX_LETTER_IMAGE_BYTES) throw new Error('The image must be 5 MB or smaller')
    mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : null
    if (!mime) throw new Error('Upload a PNG or JPG image')
  }
  const set = which === 'letterhead' ? { letterhead: bytes, letterheadMime: mime } : { stamp: bytes, stampMime: mime }
  const [r] = await tx.update(letterCompanies).set({ ...set, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(letterCompanies.id, id)).returning({ id: letterCompanies.id })
  if (!r) throw new Error('Company not found')
  await audit(tx, actor, { action: bytes ? 'upload' : 'remove', entity: `letter_company_${which}`, entityId: id })
}

/** What a company's letters print on and are signed with: its uploaded images, else techcadd's own (for techcadd),
 *  else a plain letterhead with the name and no stamp. */
export async function companyArt(tx: Tx, id: string): Promise<{ letterhead: string; stamp: string | null; name: string }> {
  const [c] = await tx.select().from(letterCompanies).where(eq(letterCompanies.id, id))
  if (!c) throw new Error('Company not found')
  const data = (mime: string | null, b: Buffer | null) => (mime && b ? `data:${mime};base64,${Buffer.from(b).toString('base64')}` : null)
  return {
    name: c.name,
    letterhead: data(c.letterheadMime, c.letterhead) ?? (c.isDefault ? '/letterhead.jpg' : plainLetterhead(c)),
    stamp: data(c.stampMime, c.stamp) ?? (c.isDefault ? '/letters/stamp-signature.png' : null),
  }
}

// ---- templates
// Several per letter and company, by name ("Web Development Intern", "App Development Intern"…). "Standard" is the
// built-in wording (lib/letters/standard.ts); a row named Standard is head office's edited Standard of that company.
// id null = the company's Standard.

export type TemplateRef = { id: string | null; kind: LetterKind; name: string; edited: boolean; updatedAt: string | null; companyId: string; companyName: string }
const isStandardName = (n: string) => n.trim().toLowerCase() === 'standard'

/** Every template, Standard first, per company (one company, or every active one) for the editor and the dropdowns. */
export async function listTemplates(tx: Tx, kind?: LetterKind, companyId?: string): Promise<TemplateRef[]> {
  const companies = (await listCompanies(tx)).filter((c) => (companyId ? c.id === companyId : c.isActive))
  const rows = await tx.select({ id: letterTemplates.id, kind: letterTemplates.kind, name: letterTemplates.name, updatedAt: letterTemplates.updatedAt, companyId: letterTemplates.companyId }).from(letterTemplates)
  const out: TemplateRef[] = []
  for (const c of companies) {
    for (const k of kind ? [kind] : KINDS) {
      const mine = rows.filter((r) => r.kind === k && r.companyId === c.id)
      const std = mine.find((r) => isStandardName(r.name))
      out.push({ id: null, kind: k, name: 'Standard', edited: !!std, updatedAt: std?.updatedAt.toISOString() ?? null, companyId: c.id, companyName: c.name })
      for (const r of mine.filter((x) => !isStandardName(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        out.push({ id: r.id, kind: k, name: r.name, edited: true, updatedAt: r.updatedAt.toISOString(), companyId: c.id, companyName: c.name })
      }
    }
  }
  return out
}

/** One template's text: the named one, else the company's (edited) Standard, else the built-in Standard. */
export async function templateBody(tx: Tx, kind: LetterKind, id: string | null | undefined, companyId?: string | null): Promise<string> {
  if (id) {
    const [r] = await tx.select({ body: letterTemplates.body }).from(letterTemplates).where(and(eq(letterTemplates.id, id), eq(letterTemplates.kind, kind)))
    if (r) return r.body
  }
  const company = await companyOr(tx, companyId)
  const [std] = await tx.select({ body: letterTemplates.body }).from(letterTemplates).where(and(eq(letterTemplates.companyId, company), eq(letterTemplates.kind, kind), sql`lower(${letterTemplates.name}) = 'standard'`))
  return std?.body ?? STANDARD[kind]
}

export async function getTemplate(tx: Tx, kind: LetterKind, id: string | null, companyId: string) {
  const list = await listTemplates(tx, kind, companyId)
  const ref = list.find((t) => t.id === id) ?? list[0]
  return { ...ref, body: await templateBody(tx, kind, ref.id, companyId) }
}

function checkBody(body: string) {
  const text = body.replace(/\r\n?/g, '\n').trim()
  if (text.length < 20) throw new Error('The letter is too short')
  if (text.length > 30000) throw new Error('The letter is too long')
  const unknown = [...text.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !VAR_KEYS.has(k))
  if (unknown.length) throw new Error(`Unknown variable${unknown.length > 1 ? 's' : ''}: ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(', ')}`)
  return text
}
const cleanName = (n: string) => { const v = n.trim().replace(/\s+/g, ' '); if (v.length < 2 || v.length > 80) throw new Error('Give the template a name (2 to 80 characters)'); return v }

/** Saves a template's wording (and name). id null saves the company's Standard. */
export async function saveTemplate(tx: Tx, actor: Actor, rawKind: string, id: string | null, body: string, name?: string, companyId?: string | null) {
  assertCan(actor, 'update', 'setting')
  const kind = kindOf(rawKind)
  const text = checkBody(body)
  if (!id) {
    const company = await companyOr(tx, companyId)
    const [std] = await tx.select({ id: letterTemplates.id }).from(letterTemplates).where(and(eq(letterTemplates.companyId, company), eq(letterTemplates.kind, kind), sql`lower(${letterTemplates.name}) = 'standard'`))
    if (std) await tx.update(letterTemplates).set({ body: text, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(letterTemplates.id, std.id))
    else await tx.insert(letterTemplates).values({ companyId: company, kind, name: 'Standard', body: text, updatedBy: actor.userId })
  } else {
    const n = name != null ? cleanName(name) : undefined
    if (n && isStandardName(n)) throw new Error('“Standard” is the built-in template; choose another name')
    const [r] = await tx.update(letterTemplates).set({ body: text, ...(n ? { name: n } : {}), updatedBy: actor.userId, updatedAt: new Date() }).where(and(eq(letterTemplates.id, id), eq(letterTemplates.kind, kind))).returning({ id: letterTemplates.id })
    if (!r) throw new Error('Template not found')
  }
  await audit(tx, actor, { action: 'update', entity: 'letter_template', entityId: id ?? `${kind}:standard` })
}

/** A new named template of a company, starting from that company's Standard wording. */
export async function createTemplate(tx: Tx, actor: Actor, rawKind: string, name: string, companyId?: string | null) {
  assertCan(actor, 'update', 'setting')
  const kind = kindOf(rawKind)
  const n = cleanName(name)
  const company = await companyOr(tx, companyId)
  if (isStandardName(n)) throw new Error('“Standard” is the built-in template; choose another name')
  const [dup] = await tx.select({ id: letterTemplates.id }).from(letterTemplates).where(and(eq(letterTemplates.companyId, company), eq(letterTemplates.kind, kind), sql`lower(${letterTemplates.name}) = lower(${n})`))
  if (dup) throw new Error('This company already has a template with this name')
  const [row] = await tx.insert(letterTemplates).values({ companyId: company, kind, name: n, body: await templateBody(tx, kind, null, company), updatedBy: actor.userId }).returning({ id: letterTemplates.id })
  await audit(tx, actor, { action: 'create', entity: 'letter_template', entityId: row.id, after: { kind, name: n, companyId: company } })
  return row.id
}

/** Deletes a named template; students who used it fall back to Standard (issued letters keep their text). */
export async function deleteTemplate(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'update', 'setting')
  const [r] = await tx.delete(letterTemplates).where(and(eq(letterTemplates.id, id), sql`lower(${letterTemplates.name}) <> 'standard'`)).returning({ id: letterTemplates.id })
  if (!r) throw new Error('Template not found')
  await audit(tx, actor, { action: 'delete', entity: 'letter_template', entityId: id })
}

/** Puts a company's Standard back to the built-in wording. */
export async function resetTemplate(tx: Tx, actor: Actor, rawKind: string, companyId?: string | null) {
  assertCan(actor, 'update', 'setting')
  const kind = kindOf(rawKind)
  const company = await companyOr(tx, companyId)
  await tx.delete(letterTemplates).where(and(eq(letterTemplates.companyId, company), eq(letterTemplates.kind, kind), sql`lower(${letterTemplates.name}) = 'standard'`))
  await audit(tx, actor, { action: 'reset', entity: 'letter_template', entityId: `${company}:${kind}` })
}

/** A template chosen for an intern must be one of the intern's company. */
async function checkTemplates(tx: Tx, companyId: string, ids: (string | null | undefined)[]) {
  for (const id of ids.filter(Boolean) as string[]) {
    const [t] = await tx.select({ companyId: letterTemplates.companyId }).from(letterTemplates).where(eq(letterTemplates.id, id))
    if (!t) throw new Error('Letter template not found')
    if (t.companyId !== companyId) throw new Error('Pick the letter templates of the chosen company')
  }
}

// ---- interns

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const optDate = z.preprocess((v) => (v === '' ? null : v), date.nullable().optional())
const optText = (max: number) => z.preprocess((v) => (v == null ? null : String(v).trim() || null), z.string().max(max).nullable()).optional()
export const internInput = z.object({
  name: z.preprocess((v) => String(v ?? '').trim(), z.string().min(2, 'Name is required').max(120)),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  phone: optText(30), email: optText(200), address: optText(400),
  designation: z.preprocess((v) => String(v ?? '').trim(), z.string().min(2, 'Designation is required').max(120)),
  domain: optText(300),
  trainingFrom: optDate, trainingTo: optDate, trainingLocation: optText(120),
  fromDate: date, toDate: date,
  stipend: z.number().int().min(0).max(100000000).nullable().optional(), // paise a month
  workLocation: optText(160), workingHours: optText(80), workMode: optText(300),
  responsibilities: optText(8000), skills: optText(600), project: optText(3000),
  registrationId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  offerTemplateId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  completionTemplateId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  companyId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()), // null: techcadd
  wantsOffer: z.boolean().optional(), // false: only the completion certificate
}).refine((v) => v.toDate >= v.fromDate, { message: 'The internship cannot end before it starts' })
  .refine((v) => !v.trainingFrom || !v.trainingTo || v.trainingTo >= v.trainingFrom, { message: 'The training cannot end before it starts' })
/** An intern's details as the form sends them (empty strings are fine; they are cleaned on save). */
export type InternInput = {
  name: string; gender?: 'male' | 'female' | 'other' | null; phone?: string | null; email?: string | null; address?: string | null
  designation: string; domain?: string | null; trainingFrom?: string | null; trainingTo?: string | null; trainingLocation?: string | null
  fromDate: string; toDate: string; stipend?: number | null; workLocation?: string | null; workingHours?: string | null; workMode?: string | null
  responsibilities?: string | null; skills?: string | null; project?: string | null; registrationId?: string | null
  offerTemplateId?: string | null; completionTemplateId?: string | null; companyId?: string | null; wantsOffer?: boolean
}

const pronouns = (g: string | null) => (g === 'male' ? ['he', 'his', 'him'] : g === 'female' ? ['she', 'her', 'her'] : ['they', 'their', 'them'])
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const rupees = (paise: number | null) => (paise == null || paise === 0 ? 'Nil (unpaid)' : '₹' + (paise / 100).toLocaleString('en-IN'))

type InternRow = typeof internships.$inferSelect
/** The values every {{variable}} takes for one intern. */
/** "A, B, C" -> "A, B and C" for the letter text (left alone when it already ends with an "and" or is one item). */
const listText = (s: string) => {
  const p = s.split(',').map((x) => x.trim()).filter(Boolean)
  return p.length < 2 || / and /.test(p[p.length - 1]) ? s : `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`
}

type CompanyVars = { name: string; legalName: string; contactPhone: string | null; contactEmail: string | null }
export function variablesFor(i: InternRow, branchName: string, letterDate: string, course?: { title: string | null; skills: string | null }, company?: CompanyVars): Record<string, string> {
  const [he, his, him] = pronouns(i.gender)
  return {
    name: i.name, first_name: i.name.split(/\s+/)[0], salutation: i.gender === 'male' ? 'Mr.' : i.gender === 'female' ? 'Ms.' : '',
    address: i.address ?? '', phone: i.phone ?? '', email: i.email ?? '', designation: i.designation, domain: i.domain ?? '',
    training_from: longDate(i.trainingFrom), training_to: longDate(i.trainingTo), training_location: i.trainingLocation ?? '',
    from_date: longDate(i.fromDate), to_date: longDate(i.toDate), from_month: monthYear(i.fromDate), to_month: monthYear(i.toDate),
    duration: durationWords(i.fromDate, i.toDate), Duration: cap(durationWords(i.fromDate, i.toDate)), stipend: rupees(i.stipend), work_location: i.workLocation ?? '', working_hours: i.workingHours ?? '',
    work_mode: i.workMode ?? '', responsibilities: i.responsibilities ?? '', skills: listText(i.skills || course?.skills || ''), project: i.project ?? '', course: course?.title ?? '',
    company: company?.legalName ?? 'techcadd Computer Education (OPC) Private Ltd.', company_name: company?.name ?? 'techcadd', branch: branchName,
    contact_phone: company?.contactPhone || HR_PHONE, contact_email: company?.contactEmail || HR_EMAIL, ref_no: i.refNo, date: longDate(letterDate),
    he, He: cap(he), his, His: cap(his), him,
  }
}
export const VAR_KEYS = new Set(['name', 'first_name', 'salutation', 'address', 'phone', 'email', 'designation', 'domain', 'training_from', 'training_to', 'training_location', 'from_date', 'to_date', 'from_month', 'to_month', 'duration', 'Duration', 'stipend', 'work_location', 'working_hours', 'work_mode', 'responsibilities', 'skills', 'project', 'course', 'company', 'branch', 'contact_phone', 'contact_email', 'ref_no', 'date', 'he', 'He', 'his', 'His', 'him', 'company_name'])

async function nextRef(tx: Tx, branchId: string) {
  // one numbering at a time per branch. A lock on the branch row (select … for update) needs the right to change the
  // branch, which only head office has: a branch manager adding an intern got "Branch not found"
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'internship-ref:' + branchId}))`)
  const [b] = await tx.select({ code: branches.code }).from(branches).where(eq(branches.id, branchId))
  if (!b) throw new Error('Branch not found')
  const yy = String(yearIST()).slice(2)
  const prefix = `INT-${b.code}-${yy}-`
  const [r] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from internships where ref_no like ${prefix + '%'}`)).rows
  return `${prefix}${String(Number(r?.n ?? 0) + 1).padStart(4, '0')}`
}

/** A new intern; their selection letter is then waiting to be issued. */
export async function createInternship(tx: Tx, actor: Actor, raw: InternInput) {
  assertCan(actor, 'create', 'internship')
  const v = internInput.parse(raw)
  // set up from a registration: the intern belongs to the student's branch, and only once
  let branchId = actor.branchId
  if (v.registrationId) {
    const [r] = await tx.select({ branchId: registrations.branchId }).from(registrations).where(eq(registrations.id, v.registrationId))
    if (!r) throw new Error('Registration not found')
    const [taken] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from internships where registration_id = ${v.registrationId} and status <> 'cancelled'`)).rows
    if (Number(taken?.n ?? 0)) throw new Error('This student\'s letters are already set up')
    branchId = r.branchId
  }
  if (!branchId) throw new Error('Pick the branch (top left) the intern belongs to')
  const companyId = await companyOr(tx, v.companyId)
  await checkTemplates(tx, companyId, [v.offerTemplateId, v.completionTemplateId])
  const wantsOffer = v.wantsOffer ?? true
  const [row] = await tx.insert(internships).values({
    ...v, companyId, gender: v.gender ?? null, wantsOffer, status: wantsOffer ? 'offer_requested' : 'offer_issued',
    branchId, refNo: await nextRef(tx, branchId), createdBy: actor.userId,
  }).returning()
  await audit(tx, actor, { action: 'create', entity: 'internship', entityId: row.id, after: { name: row.name, refNo: row.refNo } })
  return row
}

/** Corrects an intern's details; an issued letter keeps its frozen text. */
export async function updateInternship(tx: Tx, actor: Actor, id: string, raw: InternInput) {
  assertCan(actor, 'create', 'internship')
  const v = internInput.parse(raw)
  const [cur] = await tx.select().from(internships).where(eq(internships.id, id)).for('update')
  if (!cur) throw new Error('Intern not found')
  if (cur.status === 'completed' || cur.status === 'cancelled') throw new Error(`This internship is ${cur.status}`)
  const { wantsOffer: _w, registrationId: _r, ...rest } = v
  const companyId = await companyOr(tx, v.companyId)
  await checkTemplates(tx, companyId, [v.offerTemplateId, v.completionTemplateId])
  await tx.update(internships).set({ ...rest, companyId, gender: v.gender ?? null }).where(eq(internships.id, id))
  await audit(tx, actor, { action: 'update', entity: 'internship', entityId: id })
}

async function render(tx: Tx, i: InternRow, kind: LetterKind) {
  const [b] = await tx.select({ name: branches.name, address: branches.address, city: branches.city }).from(branches).where(eq(branches.id, i.branchId))
  const body = await templateBody(tx, kind, kind === 'internship_offer' ? i.offerTemplateId : i.completionTemplateId, i.companyId)
  const [co] = await tx.select({ name: letterCompanies.name, legalName: letterCompanies.legalName, contactPhone: letterCompanies.contactPhone, contactEmail: letterCompanies.contactEmail }).from(letterCompanies).where(eq(letterCompanies.id, i.companyId))
  const [c] = i.registrationId ? await tx.select({ title: courses.title, skills: courses.skills, joining: registrations.joiningDate, enrolled: registrations.enrollmentDate, end: registrations.expectedEndDate }).from(registrations).leftJoin(courses, eq(courses.id, registrations.courseId)).where(eq(registrations.id, i.registrationId)) : []
  // training dates not set on the intern follow the registration (joining or enrollment date to expected end)
  const dated = c ? { ...i, trainingFrom: i.trainingFrom ?? (c.joining ?? c.enrolled ?? null), trainingTo: i.trainingTo ?? c.end ?? null } : i
  // training and working location not set on the intern follow the branch
  const place = b ? branchPlace(b) : null
  const withDates = place ? { ...dated, trainingLocation: dated.trainingLocation || place.training || null, workLocation: dated.workLocation || place.work || null } : dated
  return fill(body, variablesFor(withDates as InternRow, `techcadd ${(b?.name ?? '').replace(/^techcadd\s*/i, '')}`.trim(), todayIST(), c, co))
}

const lock = async (tx: Tx, id: string) => {
  const [i] = await tx.select().from(internships).where(eq(internships.id, id)).for('update')
  if (!i) throw new Error('Intern not found')
  return i
}

/** Issues the selection letter: its text is made from the template now and kept as it is. */
export async function issueOffer(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'approve', 'internship')
  const i = await lock(tx, id)
  if (i.status !== 'offer_requested') throw new Error('The selection letter is already issued')
  const text = await render(tx, i, 'internship_offer')
  if (text.includes('⟦')) throw new Error(`Fill in the missing details first: ${[...new Set([...text.matchAll(/⟦([A-Za-z_]+)⟧/g)].map((m) => m[1]))].join(', ')}`)
  await tx.update(internships).set({ status: 'offer_issued', offerIssuedBy: actor.userId, offerIssuedAt: new Date(), offerText: text }).where(eq(internships.id, id))
  await audit(tx, actor, { action: 'issue_offer', entity: 'internship', entityId: id })
  await emitInternshipLetter(tx, id, 'selection')
}

/** Asks for the completion certificate, with what the intern worked on and achieved. */
export async function requestCompletion(tx: Tx, actor: Actor, id: string, work: { domain?: string | null; skills?: string | null; project?: string | null }) {
  assertCan(actor, 'create', 'internship')
  const i = await lock(tx, id)
  if (i.status !== 'offer_issued') throw new Error(i.status === 'offer_requested' ? 'Issue the selection letter first' : 'The completion certificate is already requested')
  const w = z.object({ domain: optText(300), skills: optText(600), project: optText(3000) }).parse(work)
  await tx.update(internships).set({ ...w, status: 'completion_requested', completionRequestedBy: actor.userId, completionRequestedAt: new Date() }).where(eq(internships.id, id))
  await audit(tx, actor, { action: 'request_completion', entity: 'internship', entityId: id })
}

/** Issues the completion certificate (text frozen). */
export async function issueCompletion(tx: Tx, actor: Actor, id: string) {
  assertCan(actor, 'approve', 'internship')
  const i = await lock(tx, id)
  if (i.status !== 'completion_requested') throw new Error(i.status === 'completed' ? 'Already issued' : 'Request the completion certificate first')
  const text = await render(tx, i, 'internship_completion')
  if (text.includes('⟦')) throw new Error(`Fill in the missing details first: ${[...new Set([...text.matchAll(/⟦([A-Za-z_]+)⟧/g)].map((m) => m[1]))].join(', ')}`)
  await tx.update(internships).set({ status: 'completed', completedBy: actor.userId, completedAt: new Date(), completionText: text }).where(eq(internships.id, id))
  await audit(tx, actor, { action: 'issue_completion', entity: 'internship', entityId: id })
  await emitInternshipLetter(tx, id, 'completion')
}

export async function cancelInternship(tx: Tx, actor: Actor, id: string, reason: string) {
  assertCan(actor, 'approve', 'internship')
  if (!reason.trim()) throw new Error('A reason is required')
  const i = await lock(tx, id)
  if (i.status === 'completed') throw new Error('A completed internship cannot be cancelled')
  await tx.update(internships).set({ status: 'cancelled', cancelReason: reason.trim() }).where(eq(internships.id, id))
  await audit(tx, actor, { action: 'cancel', entity: 'internship', entityId: id, after: { reason } })
}

// ---- lists and letters

export type InternListRow = {
  id: string; refNo: string; name: string; phone: string | null; designation: string; branch: string; company: string
  fromDate: string; toDate: string; daysLeft: number; status: string; stipend: number | null
  offerIssuedAt: string | null; completionRequestedAt: string | null; completedAt: string | null; cancelReason: string | null
  input: InternInput // to edit the details
}

export async function listInternships(tx: Tx, actor: Actor, q: { tab: string; q?: string; today: string; branchId: string | null }) {
  assertCan(actor, 'read', 'internship')
  const conds = [sql`(${q.branchId}::uuid is null or i.branch_id = ${q.branchId}::uuid)`]
  const term = q.q?.trim()
  if (term) { const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`; conds.push(sql`(i.name ilike ${like} or i.phone ilike ${like} or i.ref_no ilike ${like} or i.designation ilike ${like})`) }
  const where = sql.join(conds, sql` and `)
  const tabSql: Record<string, ReturnType<typeof sql>> = {
    offer: sql`i.status = 'offer_requested'`,
    active: sql`i.status = 'offer_issued'`,
    ending: sql`i.status = 'offer_issued' and i.to_date < (date_trunc('month', ${q.today}::date) + interval '2 months')`,
    requested: sql`i.status = 'completion_requested'`,
    completed: sql`i.status = 'completed'`,
    cancelled: sql`i.status = 'cancelled'`,
    all: sql`true`,
  }
  const tab = tabSql[q.tab] ? q.tab : 'all'
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select i.*, lc.name as company_name, b.name as branch_name, b.address as branch_address, b.city as branch_city, (i.to_date - ${q.today}::date) as days_left,
      coalesce(i.training_from, coalesce(rg.joining_date, rg.enrollment_date)) as training_from, coalesce(i.training_to, rg.expected_end_date) as training_to
    from internships i join branches b on b.id = i.branch_id join letter_companies lc on lc.id = i.company_id left join registrations rg on rg.id = i.registration_id where ${where} and ${tabSql[tab]}
    order by i.created_at desc
    limit 300`)).rows
  const [c] = (await tx.execute<Record<string, number>>(sql`
    select ${sql.join(Object.entries(tabSql).map(([k, s]) => sql`count(*) filter (where ${s})::int as ${sql.raw(k)}`), sql`, `)}
    from internships i where ${where}`)).rows
  const d = (v: unknown) => (v == null ? null : String(v).slice(0, 10))
  const ts = (v: unknown) => (v == null ? null : new Date(v as string).toISOString())
  return {
    tab,
    counts: Object.fromEntries(Object.keys(tabSql).map((k) => [k, Number(c?.[k] ?? 0)])) as Record<string, number>,
    rows: rows.map((r): InternListRow => ({
      id: String(r.id), refNo: String(r.ref_no), name: String(r.name), phone: (r.phone as string) ?? null, designation: String(r.designation), branch: String(r.branch_name), company: String(r.company_name),
      fromDate: d(r.from_date)!, toDate: d(r.to_date)!, daysLeft: Number(r.days_left), status: String(r.status), stipend: r.stipend == null ? null : Number(r.stipend),
      offerIssuedAt: ts(r.offer_issued_at), completionRequestedAt: ts(r.completion_requested_at), completedAt: ts(r.completed_at), cancelReason: (r.cancel_reason as string) ?? null,
      input: {
        name: String(r.name), gender: (r.gender as 'male' | 'female' | 'other') ?? null, phone: r.phone as string, email: r.email as string, address: r.address as string,
        designation: String(r.designation), domain: r.domain as string, trainingFrom: d(r.training_from), trainingTo: d(r.training_to), trainingLocation: (r.training_location as string) || branchPlace({ name: r.branch_name as string, address: r.branch_address as string, city: r.branch_city as string }).training,
        fromDate: d(r.from_date)!, toDate: d(r.to_date)!, stipend: r.stipend == null ? null : Number(r.stipend), workLocation: (r.work_location as string) || branchPlace({ name: r.branch_name as string, address: r.branch_address as string, city: r.branch_city as string }).work, workingHours: r.working_hours as string,
        workMode: r.work_mode as string, responsibilities: r.responsibilities as string, skills: r.skills as string, project: r.project as string,
        offerTemplateId: (r.offer_template_id as string) ?? null, completionTemplateId: (r.completion_template_id as string) ?? null, companyId: String(r.company_id), wantsOffer: !!r.wants_offer, registrationId: (r.registration_id as string) ?? null,
      },
    })),
  }
}

/** One letter to print: the issued (frozen) text, or a draft from the template while it is not issued yet. */
export async function letterFor(tx: Tx, actor: Actor, id: string, rawKind: string) {
  assertCan(actor, 'read', 'internship')
  const kind = kindOf(rawKind)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [i] = await tx.select().from(internships).where(eq(internships.id, id))
  if (!i) return null
  const issued = kind === 'internship_offer' ? i.offerText : i.completionText
  const issuedAt = kind === 'internship_offer' ? i.offerIssuedAt : i.completedAt
  return { kind, refNo: i.refNo, name: i.name, text: issued ?? (await render(tx, i, kind)), draft: !issued, issuedAt: issuedAt?.toISOString() ?? null, cancelled: i.status === 'cancelled', art: await companyArt(tx, i.companyId) }
}

// ---- from registrations: students registered with internship letters, not set up yet

export type RegistrationLetterRow = {
  registrationId: string; regNo: string; name: string; phone: string; course: string | null; branch: string
  offer: boolean; completion: boolean; offerTemplateId: string | null; completionTemplateId: string | null
  prefill: InternInput // what the registration already knows; the rest is asked when setting up
}

/** Where a branch is, for the letters: the training location is the branch, the working location its address. */
export const branchPlace = (b: { name: string | null; address: string | null; city: string | null }) => ({
  training: b.name ?? '',
  work: [b.address, b.city && !(b.address ?? '').toLowerCase().includes(b.city.toLowerCase()) ? b.city : null].filter(Boolean).join(', ') || (b.city ?? ''),
})

export async function lettersFromRegistrations(tx: Tx, actor: Actor, q: { q?: string; branchId: string | null }): Promise<RegistrationLetterRow[]> {
  assertCan(actor, 'read', 'internship')
  const term = q.q?.trim()
  const like = term ? `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null
  const rows = (await tx.execute<Record<string, unknown>>(sql`
    select r.id, r.reg_no, r.internship_offer, r.internship_completion, r.offer_template_id, r.completion_template_id,
      coalesce(r.letter_company_id, (select t.company_id from letter_templates t where t.id = coalesce(r.offer_template_id, r.completion_template_id))) as company_id,
      coalesce(r.joining_date, r.enrollment_date)::text as from_date, coalesce(r.expected_end_date, coalesce(r.joining_date, r.enrollment_date))::text as to_date, r.expected_end_date::text as end_date,
      trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.gender, p.phone, p.email, p.address, co.title as course, co.skills, br.name as branch, br.address as branch_address, br.city as branch_city
    from registrations r join persons p on p.id = r.person_id join branches br on br.id = r.branch_id left join courses co on co.id = r.course_id
    where (r.internship_offer or r.internship_completion) and r.status <> 'discontinued'
      and not exists (select 1 from internships i where i.registration_id = r.id and i.status <> 'cancelled')
      and (${q.branchId}::uuid is null or r.branch_id = ${q.branchId}::uuid)
      ${like ? sql`and (p.first_name || ' ' || coalesce(p.last_name, '') ilike ${like} or p.phone ilike ${like} or r.reg_no ilike ${like})` : sql``}
    order by r.enrollment_date desc limit 300`)).rows
  return rows.map((r) => ({
    registrationId: String(r.id), regNo: String(r.reg_no), name: String(r.name), phone: String(r.phone ?? ''), course: (r.course as string) ?? null, branch: String(r.branch),
    offer: !!r.internship_offer, completion: !!r.internship_completion, offerTemplateId: (r.offer_template_id as string) ?? null, completionTemplateId: (r.completion_template_id as string) ?? null,
    prefill: {
      name: String(r.name), gender: (['male', 'female', 'other'].includes(String(r.gender)) ? r.gender : null) as InternInput['gender'], phone: (r.phone as string) ?? null, email: (r.email as string) ?? null, address: (r.address as string) ?? null,
      designation: r.course ? `${r.course} Intern` : '', domain: (r.course as string) ?? null, fromDate: String(r.from_date), toDate: String(r.to_date), skills: (r.skills as string) ?? null,
      trainingFrom: String(r.from_date), trainingTo: r.end_date ? String(r.end_date) : null,
      trainingLocation: branchPlace({ name: r.branch as string, address: r.branch_address as string, city: r.branch_city as string }).training,
      workLocation: branchPlace({ name: r.branch as string, address: r.branch_address as string, city: r.branch_city as string }).work,
      registrationId: String(r.id), offerTemplateId: (r.offer_template_id as string) ?? null, completionTemplateId: (r.completion_template_id as string) ?? null, companyId: (r.company_id as string) ?? null, wantsOffer: !!r.internship_offer,
    },
  }))
}

/** A registration's internship letters (which, and from which template); changeable later. Unissued letters follow. */
export async function setRegistrationLetters(tx: Tx, actor: Actor, registrationId: string, v: { offer: boolean; completion: boolean; offerTemplateId: string | null; completionTemplateId: string | null; companyId?: string | null }) {
  assertCan(actor, 'update', 'registration')
  const companyId = await companyOr(tx, v.companyId)
  await checkTemplates(tx, companyId, [v.offer ? v.offerTemplateId : null, v.completion ? v.completionTemplateId : null])
  const [r] = await tx.update(registrations).set({
    internshipOffer: v.offer, internshipCompletion: v.completion, letterCompanyId: v.offer || v.completion ? companyId : null,
    offerTemplateId: v.offer ? v.offerTemplateId || null : null, completionTemplateId: v.completion ? v.completionTemplateId || null : null,
  }).where(eq(registrations.id, registrationId)).returning({ id: registrations.id })
  if (!r) throw new Error('Registration not found')
  // an intern already set up for this registration takes the new company (while no letter is issued) and templates
  // for the letters not issued yet
  await tx.execute(sql`update internships set company_id = ${companyId}::uuid where registration_id = ${registrationId} and status <> 'cancelled' and offer_text is null and completion_text is null`)
  await tx.execute(sql`update internships set
      offer_template_id = case when offer_text is null then ${v.offerTemplateId || null}::uuid else offer_template_id end,
      completion_template_id = case when completion_text is null then ${v.completionTemplateId || null}::uuid else completion_template_id end
    where registration_id = ${registrationId} and status <> 'cancelled'`)
  await audit(tx, actor, { action: 'update', entity: 'registration_letters', entityId: registrationId, after: v })
}

export async function registrationLetters(tx: Tx, registrationId: string) {
  const [r] = await tx.select({ offer: registrations.internshipOffer, completion: registrations.internshipCompletion, offerTemplateId: registrations.offerTemplateId, completionTemplateId: registrations.completionTemplateId, companyId: registrations.letterCompanyId }).from(registrations).where(eq(registrations.id, registrationId))
  return r ?? null
}
