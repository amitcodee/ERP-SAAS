// Password-reset link token: a short-lived signed JWT, so no table is needed.
// It carries the user's password version (`pwv`), so it stops working the moment the password changes - which makes
// it single-use, and the organisation, so it only works on that org's own host. Signed with a key derived from AUTH_SECRET, never the session key itself, so a reset token can
// not be passed off as a session cookie (or the other way round).
import { createHmac } from 'crypto'
import { jwtVerify, SignJWT } from 'jose'
import { serverSecret } from './secret'

export const RESET_MINUTES = 30

const key = () => {
  return createHmac('sha256', serverSecret('AUTH_SECRET')).update('password-reset').digest()
}

export const signResetToken = (orgId: string, userId: string, pwv: number) =>
  new SignJWT({ pwv, org: orgId }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(`${RESET_MINUTES}m`).sign(key())

export async function readResetToken(token: string): Promise<{ orgId: string; userId: string; pwv: number } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    return typeof payload.sub === 'string' && typeof payload.pwv === 'number' && typeof payload.org === 'string' ? { orgId: payload.org, userId: payload.sub, pwv: payload.pwv } : null
  } catch {
    return null
  }
}
