// Password lifecycle + session revocation rules, in ONE rolled-back transaction.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { hashPassword, verifyPassword } from '../lib/auth/password'
import { passwordProblem, sessionValidity } from '../lib/auth/validity'
import { branches, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { changePasswordIn, loadUserStateIn } from '../modules/auth/account'
import { readResetToken, signResetToken } from '../lib/auth/reset-token'
import { readSession } from '../lib/auth/session'
import { resetPasswordIn } from '../modules/auth/reset'
import { createStudentLogin, createUser, resetUserPassword, setUserActive } from '../modules/users/service'
import { createRegistration } from '../modules/registrations/service'
import { departments } from '../lib/db/schema'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}

async function main() {
  // ---- pure rules -----------------------------------------------------------------
  const t0 = new Date('2026-10-01T10:00:00.123Z')
  const live = { isActive: true, deleted: false, passwordChangedAt: t0 }
  check('session issued under the current password version is valid', sessionValidity(t0.getTime(), live) === 'ok')
  check('session from an older password version is revoked', sessionValidity(t0.getTime() - 1, live) === 'revoked')
  check('...even if it is only 1 millisecond older (no time window)', sessionValidity(t0.getTime() - 1, live) === 'revoked' && sessionValidity(t0.getTime() + 1, live) === 'revoked')
  check('deactivated user is revoked', sessionValidity(t0.getTime(), { ...live, isActive: false }) === 'revoked')
  check('deleted user is revoked', sessionValidity(t0.getTime(), { ...live, deleted: true }) === 'revoked')
  check('unknown user is revoked', sessionValidity(t0.getTime(), undefined) === 'revoked')
  check('token without a password version is revoked', sessionValidity(undefined, live) === 'revoked')
  check('password policy: too short', passwordProblem('abc123') !== null)
  check('password policy: no digit', passwordProblem('abcdefghijkl') !== null)
  check('password policy: no letter', passwordProblem('1234567890123') !== null)
  check('password policy: good password accepted', passwordProblem('Correct-horse-42') === null)
  check('password policy: same as current rejected', passwordProblem('Correct-horse-42', { current: 'Correct-horse-42' }) !== null)
  check('password policy: contains the email name rejected', passwordProblem('amithsp-Secret-99', { email: 'amithsp@x.com' }) !== null)

  // ---- against the database ---------------------------------------------------------
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'PA1', name: 'Pw A' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [sup] = await tx.insert(users).values({ name: 'S', email: 'sup@pw.test.invalid', passwordHash: await hashPassword('Initial-pass-1') }).returning()
      const [mgrU] = await tx.insert(users).values({ branchId: a.id, name: 'M', email: 'mgr@pw.test.invalid', passwordHash: 'x' }).returning()
      const superA: Actor = { userId: sup.id, orgId: ORG, role: 'super_admin', branchId: a.id }
      const mgr: Actor = { userId: mgrU.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      await applyTenant(tx, superA)

      const made = await createUser(tx, superA, { name: 'New Counselor', email: 'nc@pw.test.invalid', role: 'counselor', branchId: a.id })
      check('a newly created account must change its password', made.user.mustChangePassword === true)
      const st = await loadUserStateIn(tx, made.user.id)
      check('live state reports mustChange', st?.mustChange === true && st.isActive)

      await throws(tx, 'wrong current password refused', () => changePasswordIn(tx, made.user.id, 'not-it', 'Brand-new-pass-7').then((r) => { if (!r.ok) throw new Error(r.error) }), /Current password is not correct/)
      await throws(tx, 'weak new password refused', () => changePasswordIn(tx, made.user.id, made.tempPassword, 'short1').then((r) => { if (!r.ok) throw new Error(r.error) }), /at least 10/)
      await throws(tx, 'reusing the temporary password refused', () => changePasswordIn(tx, made.user.id, made.tempPassword, made.tempPassword).then((r) => { if (!r.ok) throw new Error(r.error) }), /different|at least|letter/)

      const before = (await loadUserStateIn(tx, made.user.id))!.passwordChangedAt
      await new Promise((r) => setTimeout(r, 20))
      const r = await changePasswordIn(tx, made.user.id, made.tempPassword, 'Brand-new-pass-7')
      check('valid change succeeds', r.ok)
      const after = await loadUserStateIn(tx, made.user.id)
      check('flag cleared and password_changed_at moves forward (voids old sessions)', after?.mustChange === false && after.passwordChangedAt.getTime() > before.getTime())
      const [row] = await tx.select().from(users).where(eq(users.id, made.user.id))
      check('new password works, old temporary one no longer does', (await verifyPassword(row.passwordHash, 'Brand-new-pass-7')) && !(await verifyPassword(row.passwordHash, made.tempPassword)))
      check('the old session is now revoked; one issued for the new version is fine', sessionValidity(before.getTime(), after!) === 'revoked' && r.ok && sessionValidity(r.pwv, after!) === 'ok')

      // deactivation revokes at once
      await setUserActive(tx, superA, made.user.id, false)
      check('deactivating a user makes their live state revoked', sessionValidity(after!.passwordChangedAt.getTime(), (await loadUserStateIn(tx, made.user.id))!) === 'revoked')
      await throws(tx, 'a deactivated user cannot change password', () => changePasswordIn(tx, made.user.id, 'Brand-new-pass-7', 'Another-pass-88').then((r) => { if (!r.ok) throw new Error(r.error) }), /not available/)
      await setUserActive(tx, superA, made.user.id, true)

      // admin reset
      const reset = await resetUserPassword(tx, superA, made.user.id)
      const st2 = await loadUserStateIn(tx, made.user.id)
      check('reset issues a fresh one-time password and forces a change', reset.tempPassword.length >= 10 && st2?.mustChange === true)
      check('reset voids sessions issued a moment before it (no grace window)', sessionValidity(after!.passwordChangedAt.getTime(), st2!) === 'revoked')
      const [row2] = await tx.select().from(users).where(eq(users.id, made.user.id))
      check('reset password is stored hashed and works', row2.passwordHash !== reset.tempPassword && (await verifyPassword(row2.passwordHash, reset.tempPassword)))
      await throws(tx, 'nobody resets their own password this way', () => resetUserPassword(tx, superA, sup.id), /change password/)

      await tx.execute(sql`reset role`)
      await applyTenant(tx, mgr)
      const staff = await createUser(tx, superA.role === 'super_admin' ? { ...mgr, role: 'branch_manager' } : mgr, { name: 'Tina Trainer', email: 't@pw.test.invalid', role: 'trainer' })
      const rs = await resetUserPassword(tx, mgr, staff.user.id)
      check('manager can reset own-branch staff', rs.tempPassword.length >= 10)
      await throws(tx, 'manager cannot reset another manager / admin', () => resetUserPassword(tx, mgr, sup.id), /not found|Forbidden/)

      // forgot password: reset by emailed link
      const [lu] = await tx.select().from(users).where(eq(users.id, staff.user.id))
      const link = await signResetToken(ORG, lu.id, lu.passwordChangedAt.getTime())
      check('a reset token is not accepted as a session', (await readSession(link)) === null && (await readResetToken(link))?.userId === lu.id)
      check('a tampered reset token is refused', !(await resetPasswordIn(tx, ORG, link.slice(0, -2) + 'xx', 'Link-chosen-pass-5')).ok)
      check('a weak password is refused on the reset link', !(await resetPasswordIn(tx, ORG, link, 'short1')).ok)
      await new Promise((r) => setTimeout(r, 20))
      check('a valid reset link sets the new password', (await resetPasswordIn(tx, ORG, link, 'Link-chosen-pass-5')).ok)
      const [lu2] = await tx.select().from(users).where(eq(users.id, lu.id))
      check('...the new password works, no forced change, old sessions void', (await verifyPassword(lu2.passwordHash, 'Link-chosen-pass-5')) && !lu2.mustChangePassword && lu2.passwordChangedAt.getTime() > lu.passwordChangedAt.getTime())
      check('the same reset link cannot be used twice', !(await resetPasswordIn(tx, ORG, link, 'Another-chosen-9')).ok)
      await setUserActive(tx, mgr, lu.id, false)
      check('a deactivated user cannot reset by link', !(await resetPasswordIn(tx, ORG, await signResetToken(ORG, lu.id, lu2.passwordChangedAt.getTime()), 'Another-chosen-9')).ok)

      // student logins also start with a forced change
      const reg = await createRegistration(tx, { ...mgr, role: 'counselor' }, { person: { firstName: 'Stu', phone: '9400000001' }, departmentId: dept.id, totalFee: 1000, enrollmentDate: '2026-10-01' })
      const sl = await createStudentLogin(tx, mgr, { registrationId: reg.id, email: 'stu@pw.test.invalid' })
      check('student portal logins must change their password on first use', sl.user.mustChangePassword === true)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
