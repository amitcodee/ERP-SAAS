// Self sign-up (the public site, PLAN.md 2.2): an institute asks for an account, confirms its e-mail with a 6-digit
// code, and is provisioned on a trial (modules/orgs/provision.ts); its owner lands signed in on its own address.
// Abuse controls: rate limits per connection and per e-mail, no throw-away mailboxes, no look-alike web addresses,
// at most 5 tries and 3 codes per sign-up, codes good for 15 minutes and kept only as an HMAC.
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { hashPassword } from '@/lib/auth/password'
import { serverSecret } from '@/lib/auth/secret'
import { passwordProblem } from '@/lib/auth/validity'
import { withPlatform } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { platformMailer } from '@/lib/notify/providers'
import { PRODUCT } from '@/lib/product'
import { underLimit } from '@/lib/redis'
import { slugProblem } from '@/lib/tenant/host'
import { provisionOrgIn, type Provisioned } from '@/modules/orgs/provision'
import { onboardingRulesIn } from '@/modules/platform/rules'
import { forgetHosts } from '@/lib/tenant/resolve'
import { isDisposable, slugBlocked } from './blocklists'

const CODE_MINUTES = 15
const MAX_TRIES = 5
const MAX_SENDS = 3

/** The code's HMAC (the code itself is never stored). */
export const signupCodeHash = (id: string, code: string) => createHmac('sha256', serverSecret('AUTH_SECRET')).update(`signup:${id}:${code}`).digest('hex')

/** What is wrong with a web address for a new institute, or null when it can be had. */
export async function slugAvailability(raw: string): Promise<string | null> {
  const slug = raw.trim().toLowerCase()
  const bad = slugProblem(slug)
  if (bad) return bad
  if (slugBlocked(slug)) return 'That address is not allowed: pick another'
  const taken = await withPlatform(async (tx) => (await tx.execute(sql`
    select 1 from organisations where slug = ${slug}
    union all select 1 from signups where slug = ${slug} and completed_at is null and expires_at > now()`)).rows.length > 0)
  return taken ? 'That address is taken: pick another' : null
}

/** A web address suggested from the institute's name. */
export const suggestSlug = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')

export const signupInput = z.object({
  name: z.string().trim().min(3, 'Enter your institute’s name').max(120),
  slug: z.string().trim().toLowerCase(),
  ownerName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid e-mail'),
  mobile: z.string().trim().transform((m) => m.replace(/[\s-]/g, '')).pipe(z.string().regex(/^(\+?91)?[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')),
  password: z.string(),
  plan: z.string().default('starter'),
  accept: z.boolean().refine((v) => v, 'Please accept the terms to continue'),
})
export type SignupInput = z.input<typeof signupInput>

export type StartResult = { ok: true; id: string; sent: boolean } | { ok: false; error: string }

/** Step 1: checks everything, keeps the request and e-mails a code. */
export async function startSignup(raw: SignupInput, ip: string): Promise<StartResult> {
  const p = signupInput.safeParse(raw)
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Check the form' }
  const v = p.data
  if (!(await underLimit(`signup:ip:${ip}`, 5, 3600))) return { ok: false, error: 'Too many sign-ups from this connection. Try again in an hour.' }
  if (!(await underLimit(`signup:email:${v.email}`, 3, 3600))) return { ok: false, error: 'Too many sign-ups for this e-mail. Try again in an hour.' }
  if (isDisposable(v.email)) return { ok: false, error: 'Use your institute’s or your own e-mail, not a throw-away one' }
  const why = passwordProblem(v.password, { email: v.email })
  if (why) return { ok: false, error: `Password: ${why}` }
  const slugWhy = await slugAvailability(v.slug)
  if (slugWhy) return { ok: false, error: `Web address: ${slugWhy}` }
  const plan = await withPlatform(async (tx) => (await tx.execute<{ key: string }>(sql`select key from plans where key = ${v.plan} and is_public and is_active`)).rows[0]?.key ?? 'starter')

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const passwordHash = await hashPassword(v.password)
  const id = await withPlatform(async (tx) => {
    const [r] = (await tx.execute<{ id: string }>(sql`
      insert into signups (name, slug, owner_name, email, mobile, plan_key, password_hash, code_hash, expires_at, ip)
      values (${v.name}, ${v.slug}, ${v.ownerName}, ${v.email}, ${v.mobile}, ${plan}, ${passwordHash}, 'pending', now() + make_interval(mins => ${CODE_MINUTES}), ${ip})
      returning id`)).rows
    await tx.execute(sql`update signups set code_hash = ${signupCodeHash(r.id, code)} where id = ${r.id}`)
    return r.id
  })
  return { ok: true, id, sent: await sendCode(v.email, v.ownerName, code) }
}

async function sendCode(email: string, name: string, code: string): Promise<boolean> {
  const mail = platformMailer()
  if (!mail) {
    // no mailer on this server (development, tests): the code goes to the server log only
    if (process.env.NODE_ENV !== 'production') log.info('signup.code', { email, code })
    else log.error('signup.no_mailer', { email })
    return false
  }
  const r = await mail.send({ channel: 'email', to: email, template: 'signup_code', subject: `${code} is your ${PRODUCT.name} code`,
    body: `Hello ${name},\n\nYour code to confirm your e-mail is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you did not sign up for ${PRODUCT.name}, ignore this e-mail.` })
  if (!r.ok) log.warn('signup.mail_failed', { email, error: r.error })
  return r.ok
}

/** A new code for a sign-up that is still waiting (at most 3 in all); the old one stops working. */
export async function resendSignupCode(id: string): Promise<{ ok: boolean; error?: string }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const row = await withPlatform(async (tx) => (await tx.execute<{ email: string; owner_name: string }>(sql`
    update signups set code_hash = ${signupCodeHash(id, code)}, sends = sends + 1, attempts = 0, expires_at = now() + make_interval(mins => ${CODE_MINUTES})
    where id = ${id} and completed_at is null and sends < ${MAX_SENDS} returning email, owner_name`)).rows[0])
  if (!row) return { ok: false, error: 'No more codes can be sent for this sign-up: start again' }
  await sendCode(row.email, row.owner_name, code)
  return { ok: true }
}

export type VerifyResult = { ok: true; org: Provisioned } | { ok: false; error: string; restart?: boolean }

/** Step 2: the code. Right: the institute is made (one transaction with marking the sign-up done). */
export async function verifySignup(id: string, code: string): Promise<VerifyResult> {
  if (!/^\d{6}$/.test(code.trim())) return { ok: false, error: 'Enter the 6-digit code from the e-mail' }
  const out = await withPlatform(async (tx): Promise<VerifyResult> => {
    const [s] = (await tx.execute<{ name: string; slug: string; owner_name: string; email: string; plan_key: string; password_hash: string; code_hash: string; attempts: number; expired: boolean; completed: boolean }>(sql`
      select name, slug, owner_name, email, plan_key, password_hash, code_hash, attempts, expires_at < now() as expired, completed_at is not null as completed
      from signups where id = ${id} for update`)).rows
    if (!s || s.completed) return { ok: false, error: 'This sign-up is finished or unknown: start again', restart: true }
    if (s.expired) return { ok: false, error: 'The code has expired: send a new one' }
    if (s.attempts >= MAX_TRIES) return { ok: false, error: 'Too many wrong codes: send a new one' }
    const want = Buffer.from(s.code_hash), got = Buffer.from(signupCodeHash(id, code.trim()))
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      await tx.execute(sql`update signups set attempts = attempts + 1 where id = ${id}`)
      return { ok: false, error: 'That code is not right' }
    }
    // the address may have gone in the meantime (another sign-up confirmed first)
    const [taken] = (await tx.execute(sql`select 1 from organisations where slug = ${s.slug}`)).rows
    if (taken) return { ok: false, error: 'That web address was just taken by someone else: start again with another', restart: true }
    // the platform's rules: a trial of so many days, or (approval on) waiting until the platform approves it
    const rules = await onboardingRulesIn(tx)
    const org = await provisionOrgIn(tx, { name: s.name, slug: s.slug, ownerName: s.owner_name, ownerEmail: s.email, ownerPasswordHash: s.password_hash, status: rules.approval ? 'pending' : 'trial', trialDays: rules.trialDays, planKey: s.plan_key })
    // provisionOrgIn ends inside the new org: back to the platform to close the sign-up
    await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true)`)
    await tx.execute(sql`update signups set completed_at = now(), org_id = ${org.orgId}, password_hash = '', code_hash = '' where id = ${id}`)
    return { ok: true, org }
  })
  if (out.ok) { forgetHosts(); log.info('signup.done', { orgId: out.org.orgId, slug: out.org.slug }) }
  return out
}

// ---- "Find my institute" ----------------------------------------------------------------------------------------------

/** E-mails the addresses of every institute where this e-mail has a login. The answer is the same either way. */
export async function findInstitutes(rawEmail: string, ip: string, origin: (orgId: string) => Promise<string>): Promise<{ ok: boolean; error?: string }> {
  const e = z.string().trim().toLowerCase().email().safeParse(rawEmail)
  if (!e.success) return { ok: false, error: 'Enter a valid e-mail' }
  if (!(await underLimit(`find:ip:${ip}`, 10, 3600)) || !(await underLimit(`find:email:${e.data}`, 3, 3600))) return { ok: false, error: 'Too many requests. Try again in an hour.' }
  const orgs = await withPlatform(async (tx) => (await tx.execute<{ id: string; name: string }>(sql`
    select o.id, o.name from organisations o where o.id in (select org_id from platform_orgs_for_email(${e.data})) order by o.name`)).rows)
  if (!orgs.length) return { ok: true }
  const lines = await Promise.all(orgs.map(async (o) => `${o.name}: ${await origin(o.id)}/login`))
  const mail = platformMailer()
  if (!mail) { if (process.env.NODE_ENV !== 'production') log.info('find.links', { email: e.data, lines }); return { ok: true } }
  const r = await mail.send({ channel: 'email', to: e.data, template: 'find_institute', subject: `Your ${PRODUCT.name} sign-in addresses`,
    body: ['Hello,', '', 'This e-mail has a login at:', '', ...lines, '', 'If you did not ask for this, ignore this e-mail.'].join('\n') })
  if (!r.ok) log.warn('find.mail_failed', { error: r.error })
  return { ok: true }
}

