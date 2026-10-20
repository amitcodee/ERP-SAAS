// Session = signed JWT in an httpOnly cookie. Edge-safe (jose only) so proxy.ts can verify it.
import { jwtVerify, SignJWT } from 'jose'
import type { Role } from '../db/schema'
import { serverSecret } from './secret'

export const SESSION_COOKIE = 'tc_session'
const MAX_AGE_SECONDS = 60 * 60 * 12

export type Session = {
  userId: string
  org: string // the organisation signed in to: the session is only good on that org's own host
  orgSlug: string
  name: string
  email: string
  roles: Role[]
  role: Role // primary (highest-privilege) role, used for RLS context
  branchId: string | null
  branchName: string | null
  personId?: string | null // students only
  pwv?: number // password version (ms of password_changed_at) this session was issued under
  sid?: string // this sign-in's own id: signing out puts it on the revoked list, so a copied cookie dies with it
}

/** 128 random bits, base64url (Web Crypto: also works in proxy.ts). */
const newSid = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// The primary role only decides the database context: super_admin (all branches), student (portal), else staff.
// What a person may DO comes from the union of all their roles' permissions (see getActor).
const ROLE_PRIORITY: Role[] = ['super_admin', 'student', 'branch_manager', 'academic_manager', 'accountant', 'counselor', 'telecaller', 'trainer', 'helpdesk', 'support', 'front_desk']
export const primaryRole = (roles: Role[]): Role => ROLE_PRIORITY.find((r) => roles.includes(r)) ?? [...roles].sort()[0]

const key = () => {
  return new TextEncoder().encode(serverSecret('AUTH_SECRET'))
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE_SECONDS,
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s, sid: s.sid ?? newSid() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key())
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] })
    return payload as unknown as Session
  } catch {
    return null
  }
}
