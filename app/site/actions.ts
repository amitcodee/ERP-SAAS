'use server'
import { createHmac, timingSafeEqual } from 'crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { appOrigin } from '@/lib/app-url'
import { httpsRequest } from '@/lib/auth/https-request'
import { serverSecret } from '@/lib/auth/secret'
import { signWelcomeLink } from '@/lib/auth/session'
import { clientIpFrom } from '@/lib/client-ip'
import { underLimit } from '@/lib/redis'
import { requestHost } from '@/lib/tenant/request'
import { findInstitutes, resendSignupCode, slugAvailability, startSignup, verifySignup } from '@/modules/signup/service'

// The public site's actions (apex domain only). A server action's redirect renders without the proxy's rewrite, so
// redirects name the /site/* route itself.
const SIGNUP_COOKIE = 'tc_signup'
const tag = (id: string) => createHmac('sha256', serverSecret('AUTH_SECRET')).update(`signup-cookie:${id}`).digest('base64url').slice(0, 22)

/** Only on the platform's own public site. */
async function siteOnly() {
  if ((await requestHost()).kind !== 'apex') throw new Error('Not found')
  return clientIpFrom(await headers()) ?? 'unknown'
}
async function signupId(): Promise<string | null> {
  const [id, t] = ((await cookies()).get(SIGNUP_COOKIE)?.value ?? '').split('.')
  if (!id || !t) return null
  const a = Buffer.from(t), b = Buffer.from(tag(id))
  return a.length === b.length && timingSafeEqual(a, b) ? id : null
}

/** Whether a web address can be had (asked as the visitor types). */
export async function checkSlugAction(slug: string): Promise<string | null> {
  const ip = await siteOnly()
  if (!(await underLimit(`slug-check:${ip}`, 120, 600))) return 'Too many checks: wait a minute'
  return slugAvailability(String(slug).slice(0, 60))
}

export type SignupState = { error?: string } | undefined

export async function signupAction(_: SignupState, form: FormData): Promise<SignupState> {
  const ip = await siteOnly()
  const r = await startSignup({
    name: String(form.get('name') ?? ''), slug: String(form.get('slug') ?? ''), ownerName: String(form.get('ownerName') ?? ''), email: String(form.get('email') ?? ''),
    mobile: String(form.get('mobile') ?? ''), password: String(form.get('password') ?? ''), plan: String(form.get('plan') ?? 'starter'), accept: form.get('accept') === 'on',
  }, ip)
  if (!r.ok) return { error: r.error }
  ;(await cookies()).set(SIGNUP_COOKIE, `${r.id}.${tag(r.id)}`, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600, secure: await httpsRequest() })
  redirect('/site/signup/verify')
}

export type VerifyState = { error?: string; sent?: boolean } | undefined

export async function verifySignupAction(_: VerifyState, form: FormData): Promise<VerifyState> {
  await siteOnly()
  const id = await signupId()
  if (!id) return { error: 'This sign-up has run out: start again' }
  if (form.get('resend')) {
    const r = await resendSignupCode(id)
    return r.ok ? { sent: true } : { error: r.error }
  }
  const r = await verifySignup(id, String(form.get('code') ?? ''))
  if (!r.ok) {
    if (r.restart) (await cookies()).delete(SIGNUP_COOKIE)
    return { error: r.error }
  }
  ;(await cookies()).delete(SIGNUP_COOKIE)
  // signed in on the institute's own address (a one-time link, 10 minutes)
  redirect(`${await appOrigin(r.org.orgId)}/login/welcome?t=${encodeURIComponent(await signWelcomeLink({ org: r.org.orgId, user: r.org.ownerUserId }))}`)
}

export type FindState = { error?: string; sent?: boolean } | undefined

export async function findInstituteAction(_: FindState, form: FormData): Promise<FindState> {
  const ip = await siteOnly()
  const r = await findInstitutes(String(form.get('email') ?? ''), ip, appOrigin)
  return r.ok ? { sent: true } : { error: r.error }
}
