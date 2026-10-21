// Two-step sign-in by e-mail. After the password is right, a 6-digit code is mailed and the sign-in waits for it.
// No table: the pending step is a short-lived signed JWT in an httpOnly cookie. It holds only an HMAC of the code
// (keyed with a key derived from AUTH_SECRET), so the cookie's holder cannot work the code out or try codes offline;
// tries against the server are rate-limited by the callers.
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { jwtVerify, SignJWT } from 'jose'
import type { Session } from '@/lib/auth/session'
import { log } from '@/lib/log'
import { providerFor } from '@/lib/notify/providers'
import { plainText } from '@/lib/notify/layout'
import { orgBrand } from '@/lib/brand'
import { serverSecret } from '@/lib/auth/secret'

export const TWO_FACTOR_COOKIE = 'tc_2fa'
export const CODE_MINUTES = 10
export const twoFactorCookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: CODE_MINUTES * 60 }

/** login = finishing a sign-in (carries the session to start); enable = switching two-step sign-in on; password = changing one's own password. */
export type Purpose = 'login' | 'enable' | 'password'
export type Challenge = { userId: string; email: string; purpose: Purpose; ch: string; session?: Session }

const key = () => {
  const s = serverSecret('AUTH_SECRET')
  // Derived, never the session key itself: a challenge can not be passed off as a session cookie.
  return createHmac('sha256', s).update('two-factor').digest()
}
const codeHash = (userId: string, code: string) => createHmac('sha256', key()).update(`${userId}:${code}`).digest('hex')

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

export const signChallenge = (c: { userId: string; email: string; purpose: Purpose; code: string; session?: Session }) =>
  new SignJWT({ email: c.email, purpose: c.purpose, ch: codeHash(c.userId, c.code), ...(c.session ? { session: c.session } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(c.userId).setIssuedAt().setExpirationTime(`${CODE_MINUTES}m`).sign(key())

export async function readChallenge(token: string | undefined, purpose: Purpose): Promise<Challenge | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || payload.purpose !== purpose || typeof payload.ch !== 'string' || typeof payload.email !== 'string') return null
    return { userId: payload.sub, email: payload.email, purpose, ch: payload.ch, session: payload.session as Session | undefined }
  } catch {
    return null
  }
}

export function codeMatches(c: Challenge, code: string): boolean {
  const given = Buffer.from(codeHash(c.userId, code.replace(/\D/g, '')))
  const want = Buffer.from(c.ch)
  return given.length === want.length && timingSafeEqual(given, want)
}

/** "a•••@gmail.com": enough to recognise the mailbox without printing it on a sign-in page. */
export const maskEmail = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_, a: string, mid: string, dom: string) => a + '•'.repeat(Math.min(mid.length, 6)) + dom)

/** Mails the code. False when it could not be sent (the caller must then stop: nobody could finish the step). */
export async function sendCode(orgId: string, to: { id: string; email: string; name: string }, code: string, purpose: Purpose): Promise<boolean> {
  const provider = await providerFor(orgId, 'email')
  if (!provider) {
    log.warn('two_factor_email_not_configured', { userId: to.id })
    // Local development only: without an email provider the code is printed so the flow can still be used.
    if (process.env.NODE_ENV !== 'production') { console.log(`Verification code for ${to.email}: ${code}`); return true }
    return false
  }
  const { name } = await orgBrand(orgId)
  const why = purpose === 'login' ? `to finish signing in to your ${name} account` : purpose === 'password' ? `to change the password of your ${name} account` : `to turn on two-step sign-in for your ${name} account`
  const body = `Hello ${plainText(to.name)},\n\nYour verification code is:\n\n${code}\n\nEnter it ${why}. The code works for ${CODE_MINUTES} minutes.\n\nIf this was not you, someone knows your password: change it now.\n\n- ${name}`
  const res = await provider.send({ channel: 'email', to: to.email, body, template: 'two_factor', subject: `${name} — your verification code is ${code}` })
  if (!res.ok) log.error('two_factor_email_failed', { userId: to.id, error: res.error })
  return res.ok
}
