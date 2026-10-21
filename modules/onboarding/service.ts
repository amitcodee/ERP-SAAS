// Set Up (PLAN.md 2.3): the steps a new institute goes through after sign-up. Each step is done when the institute
// has really done it (read from its data, so work done elsewhere counts), or when head office marks it done or skips
// it. The checklist stays on the dashboard until every step is settled or head office puts it away.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { catalogue } from '@/lib/catalogues'
import type { Actor, Tx } from '@/lib/db/withTenant'

export const STEPS = [
  { key: 'branding', label: 'Your institute', about: 'Name as printed, tagline, colour and logo.' },
  { key: 'branch', label: 'First branch', about: 'Its details, branch admin, counselor and accountant; then open it.' },
  { key: 'courses', label: 'Courses', about: 'Start from a ready-made list, or add your own under Courses.' },
  { key: 'fees', label: 'Fees', about: 'How you take payments, and the GST you usually charge.' },
  { key: 'staff', label: 'Staff', about: 'Add the people who will use it, each with their role.' },
  { key: 'email', label: 'E-mail', about: 'Send receipts, reminders and logins from your own mailbox.' },
  { key: 'import', label: 'Existing students', about: 'Bring over enquiries and registrations from a spreadsheet.' },
] as const
export type StepKey = (typeof STEPS)[number]['key']

export type StepState = { key: StepKey; label: string; about: string; done: boolean; skipped: boolean }
export type Onboarding = { steps: StepState[]; complete: boolean; dismissed: boolean; settled: number }

const assertHead = (actor: Actor) => { if (actor.role !== 'super_admin') throw new Error('Only head office sets up the institute') }

/** Where the institute is in setting up (read in its own context). */
export async function onboardingState(tx: Tx): Promise<Onboarding> {
  const [f] = (await tx.execute<{ ob: { done?: string[]; skipped?: string[]; dismissed?: boolean }; branding: boolean; branch: boolean; courses: boolean; modes: boolean; staff: boolean; email: boolean; students: boolean }>(sql`
    select o.onboarding as ob,
      (o.legal_name is not null or coalesce(o.branding ->> 'logo', '') <> '') as branding,
      exists (select 1 from branches b where b.status = 'active') as branch,
      exists (select 1 from courses c where c.is_active) as courses,
      exists (select 1 from settings s where s.key = 'fees.default_gst_pct') as modes,
      (select count(*) from users u where u.is_active and u.deleted_at is null) > 1 as staff,
      exists (select 1 from app_config c where c.key = 'email' and (c.config ->> 'enabled')::boolean) as email,
      exists (select 1 from registrations) as students
    from organisations o where o.id = app_org()`)).rows
  const ob = f?.ob ?? {}
  const auto: Record<StepKey, boolean> = { branding: !!f?.branding, branch: !!f?.branch, courses: !!f?.courses, fees: !!f?.modes, staff: !!f?.staff, email: !!f?.email, import: !!f?.students }
  const steps = STEPS.map((s) => ({ ...s, done: auto[s.key] || !!ob.done?.includes(s.key), skipped: !auto[s.key] && !!ob.skipped?.includes(s.key) }))
  const settled = steps.filter((s) => s.done || s.skipped).length
  return { steps, complete: settled === steps.length, dismissed: !!ob.dismissed, settled }
}

/** Marks a step done or skipped, or puts the whole checklist away. */
export async function markStep(tx: Tx, actor: Actor, step: StepKey | 'dismiss', how: 'done' | 'skip' | 'undo' = 'done') {
  assertHead(actor)
  const [o] = (await tx.execute<{ ob: { done?: string[]; skipped?: string[]; dismissed?: boolean } }>(sql`select onboarding as ob from organisations where id = app_org()`)).rows
  const ob = { done: [] as string[], skipped: [] as string[], ...(o?.ob ?? {}) }
  if (step === 'dismiss') ob.dismissed = how !== 'undo'
  else {
    if (!STEPS.some((s) => s.key === step)) throw new Error('Unknown step')
    ob.done = ob.done.filter((k) => k !== step); ob.skipped = ob.skipped.filter((k) => k !== step)
    if (how === 'done') ob.done.push(step)
    if (how === 'skip') ob.skipped.push(step)
  }
  await tx.execute(sql`update organisations set onboarding = ${JSON.stringify(ob)}::jsonb where id = app_org()`)
}

// ---- the steps that are filled in here ----------------------------------------------------------------------------

const image = (what: string) => z.string().max(450_000).regex(/^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/, `Use a PNG or JPEG ${what}`).optional().default('')

export const brandingInput = z.object({
  legalName: z.string().trim().min(2, 'Enter the name as it should be printed').max(160),
  tagline: z.string().trim().max(120).optional().default(''),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour').default('#10186a'),
  // a small logo as a PNG / JPEG data URL (the page turns a WebP or SVG into PNG first: certificates and receipts can
  // only print those); empty keeps the one there is
  logo: image('logo'),
  // an image of the institute's affiliations / accreditations for the course certificate (optional); empty keeps it
  accreditations: image('accreditations image'),
  removeAccreditations: z.boolean().optional().default(false),
  // printed on the student ID card; each may be left empty
  contact: z.object({
    address: z.string().trim().max(200).default(''),
    phone: z.string().trim().max(40).default(''),
    website: z.string().trim().max(120).default(''),
    social: z.string().trim().max(200).refine((s) => !s || /^https?:\/\/\S+$/i.test(s), 'The social page must be a link (https://…)').default(''),
  }).optional(),
})

/** The institute as it is printed and shown: legal name, tagline, colour, logo, contacts (organisations.branding). */
export async function saveBranding(tx: Tx, actor: Actor, raw: z.input<typeof brandingInput>) {
  assertHead(actor)
  const v = brandingInput.parse(raw)
  const [o] = (await tx.execute<{ branding: Record<string, unknown> }>(sql`select branding from organisations where id = app_org()`)).rows
  const branding: Record<string, unknown> = { ...(o?.branding ?? {}), tagline: v.tagline, color: v.color, ...(v.logo ? { logo: v.logo } : {}), ...(v.accreditations ? { accreditations: v.accreditations } : {}), ...(v.contact ? { contact: v.contact } : {}) }
  if (v.removeAccreditations) delete branding.accreditations
  await tx.execute(sql`update organisations set legal_name = ${v.legalName}, branding = ${JSON.stringify(branding)}::jsonb where id = app_org()`)
  await audit(tx, actor, { action: 'update', entity: 'organisation', entityId: 'branding', after: { legalName: v.legalName, tagline: v.tagline, color: v.color, logo: !!v.logo, accreditations: v.removeAccreditations ? null : !!v.accreditations } })
}

/** Adds a ready-made catalogue's departments and courses (what is there already is left as it is). */
export async function applyCatalogue(tx: Tx, actor: Actor, key: string): Promise<{ departments: number; courses: number }> {
  assertHead(actor)
  const c = catalogue(key)
  if (!c) throw new Error('Unknown course list')
  let departments = 0, courses = 0
  for (const d of c.departments) {
    const [dept] = (await tx.execute<{ id: string; made: boolean }>(sql`
      with ins as (insert into departments (name) values (${d.name}) on conflict do nothing returning id)
      select id, true as made from ins union all select id, false from departments where name = ${d.name} limit 1`)).rows
    if (dept.made) departments++
    for (const course of d.courses) {
      const r = await tx.execute(sql`
        insert into courses (department_id, title, base_fee, duration_weeks, skills, status)
        select ${dept.id}, ${course.title}, ${course.fee * 100}, ${course.weeks}, ${course.skills ?? null}, 'approved'
        where not exists (select 1 from courses where department_id = ${dept.id} and lower(title) = lower(${course.title}))`)
      courses += r.rowCount ?? 0
    }
  }
  await audit(tx, actor, { action: 'apply_catalogue', entity: 'catalog', entityId: key, after: { departments, courses } })
  return { departments, courses }
}

export const feesInput = z.object({
  gstPct: z.number().int().min(0).max(28),
  paymentModes: z.array(z.string().trim().min(2).max(40)).max(12).default([]), // ways to pay to add (e.g. UPI)
})

/** The GST the institute's fees usually carry, and any ways of paying to add to its list. */
export async function saveFees(tx: Tx, actor: Actor, raw: z.input<typeof feesInput>) {
  assertHead(actor)
  const v = feesInput.parse(raw)
  await tx.execute(sql`insert into settings (key, value) values ('fees.default_gst_pct', ${JSON.stringify(v.gstPct)}::jsonb)
    on conflict (org_id, branch_id, key) do update set value = excluded.value`)
  // list entries are only ever added (the app cannot change or remove them: their history stays readable)
  const keep = [...new Set(v.paymentModes)]
  for (const [i, m] of keep.entries()) {
    await tx.execute(sql`insert into lookups (kind, value, sort_order) select 'payment_mode', ${m}, ${i}
      where not exists (select 1 from lookups where kind = 'payment_mode' and lower(value) = lower(${m}))`)
  }
  await audit(tx, actor, { action: 'update', entity: 'settings', entityId: 'fees', after: v })
}

/** The GST % the registration form starts with (Set Up → Fees). */
export async function defaultGstPct(tx: Tx): Promise<number> {
  const [r] = (await tx.execute<{ v: unknown }>(sql`select value as v from settings where key = 'fees.default_gst_pct' and branch_id is null`)).rows
  const n = Number(r?.v)
  return Number.isInteger(n) && n >= 0 && n <= 28 ? n : 0
}
