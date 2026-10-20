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
  sup?: string // a platform admin's support session (support_sessions.id): checked open on every request
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
    // a platform session or a support link is signed with the same key: never an institute session
    if (payload.aud !== undefined) return null
    return payload as unknown as Session
  } catch {
    return null
  }
}

// ---- the platform console (admin.<root>): its own cookie, and tokens only it accepts (audience 'platform')
export const PLATFORM_COOKIE = 'tc_platform'
export type PlatformSession = { pid: string; name: string; email: string }

export async function signPlatformSession(s: PlatformSession): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: 'HS256' }).setAudience('platform').setIssuedAt().setExpirationTime('8h').sign(key())
}
export async function readPlatformSession(token: string | undefined): Promise<PlatformSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], audience: 'platform' })
    return typeof payload.pid === 'string' ? (payload as unknown as PlatformSession) : null
  } catch {
    return null
  }
}

/** The one-time link a support session opens the org's workspace with (audience 'support', a few minutes). */
export async function signSupportLink(v: { sup: string; org: string }): Promise<string> {
  return new SignJWT({ ...v }).setProtectedHeader({ alg: 'HS256' }).setAudience('support').setIssuedAt().setExpirationTime('5m').setJti(newSid()).sign(key())
}
export async function readSupportLink(token: string | undefined): Promise<{ sup: string; org: string; jti: string; exp: number } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], audience: 'support' })
    return typeof payload.sup === 'string' && typeof payload.org === 'string' && payload.jti && payload.exp ? { sup: payload.sup, org: payload.org, jti: payload.jti, exp: payload.exp } : null
  } catch {
    return null
  }
}

/** After self sign-up: the one-time link that signs the new owner in on their institute's own address (10 minutes). */
export async function signWelcomeLink(v: { org: string; user: string }): Promise<string> {
  return new SignJWT({ ...v }).setProtectedHeader({ alg: 'HS256' }).setAudience('welcome').setIssuedAt().setExpirationTime('10m').setJti(newSid()).sign(key())
}
export async function readWelcomeLink(token: string | undefined): Promise<{ org: string; user: string; jti: string; exp: number } | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'], audience: 'welcome' })
    return typeof payload.org === 'string' && typeof payload.user === 'string' && payload.jti && payload.exp ? { org: payload.org, user: payload.user, jti: payload.jti, exp: payload.exp } : null
  } catch {
    return null
  }
}

