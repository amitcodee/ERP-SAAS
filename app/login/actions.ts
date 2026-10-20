'use server'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { appOrigin } from '@/lib/app-url'
import { cookieOptions, readSession, SESSION_COOKIE, signSession, type Session } from '@/lib/auth/session'
import { httpsRequest } from '@/lib/auth/https-request'
import { audit } from '@/lib/audit'
import { clientIpFrom } from '@/lib/client-ip'
import { fillIpGeo } from '@/lib/ip-geo'
import { withOrgSystem } from '@/lib/db/withTenant'
import { requireRequestOrg } from '@/lib/tenant/request'
import { clearLimit, limitReached, underLimit } from '@/lib/redis'
import { logAttempt, type Ctx } from '@/modules/auth/guard'
import { login } from '@/modules/auth/login'
import { revokeSession } from '@/modules/auth/account'
import { CODE_MINUTES, codeMatches, newCode, readChallenge, sendCode, signChallenge, TWO_FACTOR_COOKIE, twoFactorCookieOptions } from '@/modules/auth/two-factor'
import { resetPasswordByLink, resetRequestAllowed, sendResetLink } from '@/modules/auth/reset'

const schema = z.object({ email: z.string().email(), password: z.string().min(1) })

const clientIp = async () => clientIpFrom(await headers()) ?? undefined
/** Who is signing in, for the sign-in log: the real IP (see lib/client-ip) and the browser. */
const requestCtx = async (): Promise<Ctx> => { const h = await headers(); return { ip: clientIpFrom(h), userAgent: h.get('user-agent') } }

export async function loginAction(_: { error?: string } | undefined, form: FormData) {
  const parsed = schema.safeParse({ email: form.get('email'), password: form.get('password') })
  if (!parsed.success) return { error: 'Enter a valid email and password' }
  const org = await requireRequestOrg() // sign-in is to the institute whose address this is
  const ctx = await requestCtx()
  const res = await login(org, parsed.data.email, parsed.data.password, ctx)
  // where the IP is (city, network) is looked up after the answer is sent, for the sign-in log
  after(() => fillIpGeo(ctx.ip))
  if (!res.ok) return { error: res.error }
  const jar = await cookies()
  if (res.twoFactor) {
    // Two-step sign-in: no session yet. The code is mailed and the sign-in waits on /login/verify.
    const s = res.session
    if (!(await underLimit(`2fa:send:${s.userId}`, 5, 15 * 60))) return { error: 'Too many codes requested. Try again in 15 minutes.' }
    const code = newCode()
    if (!(await sendCode(org.id, { id: s.userId, email: s.email, name: s.name }, code, 'login'))) return { error: 'We could not e-mail your verification code. Try again, or ask your administrator.' }
    jar.set(TWO_FACTOR_COOKIE, await signChallenge({ userId: s.userId, email: s.email, purpose: 'login', code, session: s }), { ...twoFactorCookieOptions, secure: await httpsRequest() })
    redirect('/login/verify')
  }
  jar.set(SESSION_COOKIE, await signSession(res.session), { ...cookieOptions, secure: await httpsRequest() })
  redirect('/')
}

export type VerifyState = { error?: string; sent?: boolean } | undefined

const EXPIRED = 'This code has expired. Go back and sign in again.'
const WRONG_CODES_PER_DAY = 20
const TOO_MANY_TODAY = 'Too many wrong codes today. Try again tomorrow, or ask head office.'

/** Second step of a two-step sign-in: the e-mailed code starts the session. */
export async function verifyTwoFactorAction(_: VerifyState, form: FormData): Promise<VerifyState> {
  const jar = await cookies()
  const org = await requireRequestOrg()
  const c = await readChallenge(jar.get(TWO_FACTOR_COOKIE)?.value, 'login')
  if (!c?.session || c.session.org !== org.id) return { error: EXPIRED }
  // beyond the short window, a day's cap on wrong codes: guessing a 6-digit code must never become a matter of patience
  if (await limitReached(`2fa:wrong:${c.userId}`, WRONG_CODES_PER_DAY)) return { error: TOO_MANY_TODAY }
  if (!(await underLimit(`2fa:try:${c.userId}`, 6, CODE_MINUTES * 60))) return { error: 'Too many wrong codes. Sign in again in 10 minutes.' }
  const ctx = await requestCtx()
  if (!codeMatches(c, String(form.get('code') ?? ''))) {
    await logAttempt(org.id, { email: c.email, userId: c.userId, result: 'two_factor_wrong', ...ctx })
    if (!(await underLimit(`2fa:wrong:${c.userId}`, WRONG_CODES_PER_DAY, 24 * 3600))) { jar.delete(TWO_FACTOR_COOKIE); return { error: TOO_MANY_TODAY } }
    return { error: 'That code is not correct' }
  }
  // a code starts one session only: the same cookie and code cannot be replayed for another
  if (!(await underLimit(`2fa:used:${c.ch}`, 1, CODE_MINUTES * 60))) return { error: EXPIRED }
  await clearLimit(`2fa:try:${c.userId}`)
  await logAttempt(org.id, { email: c.email, userId: c.userId, result: 'success', ...ctx })
  await withOrgSystem(org.id, (tx) => audit(tx, { userId: c.userId, role: c.session!.role, branchId: c.session!.branchId }, { action: 'login', entity: 'user', entityId: c.userId, ip: ctx.ip ?? undefined }))
  jar.delete(TWO_FACTOR_COOKIE)
  // getActor checks the account's live state on the very next request, so a user disabled meanwhile is still shut out.
  jar.set(SESSION_COOKIE, await signSession(c.session), { ...cookieOptions, secure: await httpsRequest() })
  redirect('/')
}

export async function resendTwoFactorAction(): Promise<VerifyState> {
  const jar = await cookies()
  const org = await requireRequestOrg()
  const c = await readChallenge(jar.get(TWO_FACTOR_COOKIE)?.value, 'login')
  if (!c?.session || c.session.org !== org.id) return { error: EXPIRED }
  if (!(await underLimit(`2fa:send:${c.userId}`, 5, 15 * 60))) return { error: 'Too many codes requested. Try again in 15 minutes.' }
  const code = newCode()
  if (!(await sendCode(org.id, { id: c.userId, email: c.email, name: c.session.name }, code, 'login'))) return { error: 'We could not e-mail the code. Try again.' }
  jar.set(TWO_FACTOR_COOKIE, await signChallenge({ userId: c.userId, email: c.email, purpose: 'login', code, session: c.session }), { ...twoFactorCookieOptions, secure: await httpsRequest() })
  return { sent: true }
}

export async function logoutAction() {
  const jar = await cookies()
  const s = await readSession(jar.get(SESSION_COOKIE)?.value) as (Session & { exp?: number }) | null
  if (s?.sid && s.exp && s.org) await revokeSession(s.org, s.sid, new Date(s.exp * 1000)).catch(() => {}) // still signs out this browser
  jar.delete(SESSION_COOKIE)
  jar.delete(TWO_FACTOR_COOKIE)
  redirect('/login')
}

export type ForgotState = { sent?: boolean; email?: string; error?: string } | undefined

export async function forgotPasswordAction(_: ForgotState, form: FormData): Promise<ForgotState> {
  const parsed = z.string().trim().toLowerCase().email().safeParse(form.get('email'))
  if (!parsed.success) return { error: 'Enter a valid email' }
  const email = parsed.data
  const org = await requireRequestOrg()
  const ip = await clientIp()
  if (!(await resetRequestAllowed(org.id, email, ip))) return { error: 'Too many requests. Try again in 15 minutes.' }
  const origin = await appOrigin(org.id)
  // Sent after the response, so the answer takes the same time whether or not the account exists.
  after(() => sendResetLink(org.id, email, origin, ip))
  return { sent: true, email }
}

export type ResetState = { done?: boolean; error?: string } | undefined

export async function resetPasswordAction(_: ResetState, form: FormData): Promise<ResetState> {
  const next = String(form.get('next') ?? '')
  if (next !== String(form.get('confirm') ?? '')) return { error: 'The two passwords do not match' }
  const res = await resetPasswordByLink((await requireRequestOrg()).id, String(form.get('token') ?? ''), next, await clientIp())
  return res.ok ? { done: true } : { error: res.error }
}
