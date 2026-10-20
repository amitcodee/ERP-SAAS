import { eq } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { primaryRole, type Session } from '@/lib/auth/session'
import { branches, persons, userRoles, users } from '@/lib/db/schema'
import { withOrgSystem } from '@/lib/db/withTenant'
import type { OrgRef } from '@/lib/tenant/host'
import { checkGate, clearFailures, recordAttempt, registerFailure, type AttemptResult, type Ctx } from './guard'

/** twoFactor: the password was right, but the person also asked for a code by e-mail before the session starts. */
export type LoginResult = { ok: true; session: Session; twoFactor: boolean } | { ok: false; error: string }

export const BRANCH_NOT_READY = 'Your branch is still being set up. You can sign in once head office activates it.'
export const ORG_SUSPENDED = 'This institute’s account is suspended. Its owner can contact us to reopen it.'

const GENERIC = 'Invalid email or password'

// An unknown e-mail is checked against this throw-away hash, so it takes as long as a wrong password and the timing
// does not tell whether an account exists.
let dummy: Promise<string> | null = null
const dummyHash = () => (dummy ??= hashPassword('not-a-real-password-' + Math.random()))

/** Signs in to the organisation of the host the form was sent from: the same e-mail may have a login at another institute. */
export async function login(org: OrgRef, emailRaw: string, password: string, ctx: Ctx = { ip: null, userAgent: null }): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase()
  if (org.status === 'suspended' || org.status === 'cancelled') return { ok: false, error: ORG_SUSPENDED }

  const out = await withOrgSystem(org.id, async (tx): Promise<{ error: string } | { session: Session; twoFactor: boolean }> => {
    // blocked IP, or a running lock on this IP / this account: refused before the password is even looked at
    const gate = await checkGate(tx, email, ctx)
    if (gate) return { error: gate }

    const fail = async (result: AttemptResult, userId: string | null, message = GENERIC) => {
      await recordAttempt(tx, { email, userId, result, ...ctx })
      // only a wrong password / unknown account climbs the ladder (an inactive login or a closed branch does not)
      const lock = result === 'wrong_password' || result === 'unknown_email' ? await registerFailure(tx, email, ctx) : null
      return { error: lock ?? message }
    }

    const [u] = await tx.select().from(users).where(eq(users.email, email))
    if (!u) { await verifyPassword(await dummyHash(), password); return fail('unknown_email', null) }
    if (!(await verifyPassword(u.passwordHash, password))) return fail('wrong_password', u.id)
    if (!u.isActive || u.deletedAt) return fail('inactive', u.id)
    const roles = (await tx.select().from(userRoles).where(eq(userRoles.userId, u.id))).map((r) => r.role)
    if (!roles.length) return fail('inactive', u.id)
    let branchName: string | null = null
    if (u.branchId) {
      const [b] = await tx.select().from(branches).where(eq(branches.id, u.branchId))
      branchName = b?.name ?? null
      // Said only AFTER the password is verified, so it reveals nothing to someone guessing.
      if (b && b.status !== 'active') return fail('branch_not_ready', u.id, BRANCH_NOT_READY)
    }
    const role = primaryRole(roles)
    let personId: string | null = null
    if (role === 'student') {
      const [p] = await tx.select({ id: persons.id }).from(persons).where(eq(persons.userId, u.id))
      if (!p) return fail('inactive', u.id) // a student login without a linked student record is unusable
      personId = p.id
    }
    const session: Session = { userId: u.id, org: org.id, orgSlug: org.slug, name: u.name, email: u.email, roles, role, branchId: u.branchId, branchName, personId, pwv: u.passwordChangedAt.getTime() }
    await clearFailures(tx, email, ctx.ip)
    await recordAttempt(tx, { email, userId: u.id, result: u.twoFactorEmail ? 'two_factor_sent' : 'success', ...ctx })
    await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id))
    await audit(tx, { userId: u.id, role: session.role, branchId: u.branchId }, { action: u.twoFactorEmail ? 'login_password_ok' : 'login', entity: 'user', entityId: u.id, ip: ctx.ip ?? undefined })
    return { session, twoFactor: u.twoFactorEmail }
  })

  return 'error' in out ? { ok: false, error: out.error } : { ok: true, ...out }
}
