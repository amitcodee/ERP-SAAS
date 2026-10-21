// Self-service "forgot password": email a short-lived link, then let the holder of that link choose a new password.
// Works in the organisation of the host (withOrgSystem) because the caller is not signed in.
import { eq } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { hashPassword } from '@/lib/auth/password'
import { readResetToken, RESET_MINUTES, signResetToken } from '@/lib/auth/reset-token'
import { passwordProblem } from '@/lib/auth/validity'
import { users } from '@/lib/db/schema'
import { withOrgSystem, type Tx } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { mailButton, plainText } from '@/lib/notify/layout'
import { providerFor } from '@/lib/notify/providers'
import { orgBrand } from '@/lib/brand'
import { underLimit } from '@/lib/redis'

const INVALID = 'This reset link is no longer valid. Request a new one.'

/** True while the request is allowed. Limits both one address being mailed repeatedly and one client trying many addresses. */
export async function resetRequestAllowed(orgId: string, email: string, ip?: string): Promise<boolean> {
  const perEmail = await underLimit(`pwreset:email:${orgId}:${email}`, 3, 15 * 60)
  const perIp = await underLimit(`pwreset:ip:${ip ?? 'na'}`, 10, 15 * 60)
  return perEmail && perIp
}

/**
 * Emails a reset link if the address belongs to an active account. Says nothing to the caller either way,
 * so the form cannot be used to find out which emails have accounts.
 */
export async function sendResetLink(orgId: string, email: string, origin: string, ip?: string): Promise<void> {
  const u = await withOrgSystem(orgId, async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.email, email))
    if (!row || !row.isActive || row.deletedAt) return null
    await audit(tx, { userId: row.id, role: 'system' as never, branchId: row.branchId }, { action: 'request_password_reset', entity: 'user', entityId: row.id, ip })
    return row
  })
  if (!u) return
  const link = `${origin}/login/reset?token=${await signResetToken(orgId, u.id, u.passwordChangedAt.getTime())}`
  const provider = await providerFor(orgId, 'email')
  if (!provider) {
    log.warn('password_reset_email_not_configured', { userId: u.id })
    // Local development only: without an email provider the link is printed so the flow can still be used.
    if (process.env.NODE_ENV !== 'production') console.log(`Password reset link for ${u.email}: ${link}`)
    return
  }
  const { name } = await orgBrand(orgId)
  const body = `Hello ${plainText(u.name)},\n\nUse the button below to choose a new password for your ${name} account:\n\n${mailButton('Reset password', link)}\n\nThe button works for ${RESET_MINUTES} minutes and only once. If you did not ask for this, ignore this email - your password stays the same.\n\n- ${name}`
  const res = await provider.send({ channel: 'email', to: u.email, body, template: 'password_reset' })
  if (!res.ok) log.error('password_reset_email_failed', { userId: u.id, error: res.error })
}

async function tokenUser(tx: Tx, orgId: string, token: string) {
  const t = await readResetToken(token)
  if (!t || t.orgId !== orgId) return null // a link from another institute's workspace
  const [u] = await tx.select().from(users).where(eq(users.id, t.userId))
  // The token is tied to the password version it was issued under: once the password changes, it is dead.
  if (!u || !u.isActive || u.deletedAt || u.passwordChangedAt.getTime() !== t.pwv) return null
  return u
}

/** Whether a reset link can still be used (shown before the form, so a dead link is not a surprise on submit). */
export const checkResetToken = (orgId: string, token: string) => withOrgSystem(orgId, async (tx) => !!(await tokenUser(tx, orgId, token)))

export type ResetResult = { ok: true } | { ok: false; error: string }

/** The rules of a reset by link (no rate limit; callers add that). */
export async function resetPasswordIn(tx: Tx, orgId: string, token: string, next: string, ip?: string): Promise<ResetResult> {
  const u = await tokenUser(tx, orgId, token)
  if (!u) return { ok: false, error: INVALID }
  const problem = passwordProblem(next, { email: u.email })
  if (problem) return { ok: false, error: problem }
  // Moving password_changed_at voids this link and every open session of the user.
  await tx.update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date() }).where(eq(users.id, u.id))
  await audit(tx, { userId: u.id, role: 'system' as never, branchId: u.branchId }, { action: 'reset_password_by_link', entity: 'user', entityId: u.id, ip })
  return { ok: true }
}

export async function resetPasswordByLink(orgId: string, token: string, next: string, ip?: string): Promise<ResetResult> {
  if (!(await underLimit(`pwreset:use:${ip ?? 'na'}`, 10, 15 * 60))) return { ok: false, error: 'Too many attempts. Try again in 15 minutes.' }
  return withOrgSystem(orgId, (tx) => resetPasswordIn(tx, orgId, token, next, ip))
}
