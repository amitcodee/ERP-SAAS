// Branch life cycle: create (setup) -> details + counselor + accountant -> activate -> logins. One rolled-back transaction.
// No e-mail is sent here (loginMessage is pure; activation returns the logins to mail).
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { verifyPassword } from '../lib/auth/password'
import { codeForCity, nextFreeCode } from '../lib/branch-code'
import { nextCertNo } from '../lib/numbering'
import { branches, userRoles, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { loadUserStateIn } from '../modules/auth/account'
import { BRANCH_NOT_READY, login } from '../modules/auth/login'
import { activateBranch, branchSetup, createBranch, resendLogin, setupOverview, shareStaff, staffElsewhere, unshareStaff, updateBranch, type CreateBranchInput } from '../modules/branches/service'
import { loginMessage } from '../modules/branches/welcome'
import { createUser, resetUserPassword } from '../modules/users/service'
import { SAMPLE_ORG, SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '')
  }
}
const stamp = Date.now()
const full = (o: Partial<CreateBranchInput> = {}): CreateBranchInput => ({
  name: 'Techcadd Nawanshahr', city: 'nawanshahr', address: 'SCO 5, Banga Road', state: 'punjab', pincode: '144 514',
  phone: '+91 98765 43210', email: `nws.${stamp}@branches.test.invalid`, ...o,
})

async function main() {
  check('known cities use their usual short form', codeForCity('Ludhiana') === 'LDH' && codeForCity(' jalandhar ') === 'JAL' && codeForCity('Mohali') === 'MOH')
  check('other cities: first letter + next consonants', codeForCity('Nawanshahr') === 'NWN' && codeForCity('Sangrur') === 'SNG')
  check('a taken code gets the next number', nextFreeCode('LDH', ['LDH']) === 'LDH2' && nextFreeCode('LDH', ['ldh', 'LDH2']) === 'LDH3')

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [u] = await tx.insert(users).values({ name: 'Sup', email: `br${stamp}@test.invalid`, passwordHash: 'x' }).returning()
      await tx.insert(userRoles).values({ userId: u.id, orgId: ORG, role: 'super_admin' })
      const sup: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      await applyTenant(tx, sup)

      const seeded = await tx.select().from(branches).where(sql`${branches.code} in ('LDH','JAL','ASR','CHD','MOH','HSP','PGW')`)
      // the 7 branches migration 0024 adds (a factory reset in Settings removes them: then only what is left is checked)
      if (seeded.length < 7) console.log(`note: ${seeded.length} of the 7 institute branches are in this database (the rest were removed, e.g. by a factory reset)`)
      check('the institute branches there have their city and certificate code', seeded.every((b) => b.city && b.certCode === b.code))

      // ---- 1. create: in setup, branch admin prepared --------------------------------------------------
      const { branch: b, adminUserId } = await createBranch(tx, sup, full())
      check('code from the city; PIN and phone normalised; status = setup', /^NWN\d*$/.test(b.code) && b.pincode === '144514' && b.phone === '9876543210' && b.status === 'setup')
      const [admin] = await tx.select().from(users).where(eq(users.id, adminUserId))
      check('a branch admin login (Branch Manager) is prepared for the branch e-mail', admin.email === b.email && admin.branchId === b.id && (await tx.select().from(userRoles).where(eq(userRoles.userId, admin.id))).map((r) => r.role).join() === 'branch_manager')
      let s = await branchSetup(tx, sup, b.id)
      check('setup 33%: details done, counselor and accountant missing', s.pct === 33 && s.steps[0].done && !s.steps[1].done && !s.steps[2].done && !s.ready, `${s.pct}`)
      check('the branches list shows the same progress', (await setupOverview(tx))[b.id] === 33)
      await throws(tx, 'cannot activate before setup is complete', () => activateBranch(tx, sup, b.id), /Setup is 33% complete. Still missing: Branch counselor, Branch accountant/)

      // ---- nobody signs in before activation ---------------------------------------------------------
      const pw = 'Admin-pass-12345'
      await tx.execute(sql`reset role`)
      await tx.update(users).set({ passwordHash: await (await import('../lib/auth/password')).hashPassword(pw) }).where(eq(users.id, admin.id))
      await applyTenant(tx, sup)
      check('the live session check refuses a branch still in setup', (await loadUserStateIn(tx, admin.id))!.branchActive === false)

      // ---- 2 + 3. counselor, then one person who is accountant AND trainer -----------------------------
      await createUser(tx, sup, { name: 'Nws Counselor', email: `c.${stamp}@branches.test.invalid`, phone: '9811111111', roles: ['counselor'], branchId: b.id })
      s = await branchSetup(tx, sup, b.id)
      check('setup 67% after adding the counselor', s.pct === 67 && s.steps[1].done && s.steps[1].people.includes('Nws Counselor'))
      const multi = await createUser(tx, sup, { name: 'Nws Accounts', email: `a.${stamp}@branches.test.invalid`, phone: '98222 22222', roles: ['accountant', 'trainer'], branchId: b.id })
      check('team member saved with phone and two roles', multi.user.phone === '9822222222' && multi.roles.length === 2)
      await throws(tx, 'a phone must be a 10-digit mobile', () => createUser(tx, sup, { name: 'Bad Phone', email: `p.${stamp}@branches.test.invalid`, phone: '123', roles: ['trainer'], branchId: b.id }), /10-digit/)
      s = await branchSetup(tx, sup, b.id)
      check('setup 100%: ready to activate', s.pct === 100 && s.ready && s.team.length === 3)

      // ---- edit details (view & edit any time) --------------------------------------------------------
      const newMail = `nws2.${stamp}@branches.test.invalid`
      await updateBranch(tx, sup, { id: b.id, name: 'Techcadd Nawanshahr Main', address: 'SCO 9, Banga Road', state: 'Punjab', pincode: '144515', phone: '9876500000', email: newMail, certCode: 'tcnws' })
      const [b2] = await tx.select().from(branches).where(eq(branches.id, b.id))
      const [admin2] = await tx.select().from(users).where(eq(users.id, admin.id))
      check('details edited; the not-yet-used admin login follows the new branch e-mail', b2.name === 'Techcadd Nawanshahr Main' && b2.pincode === '144515' && b2.certCode === 'TCNWS' && admin2.email === newMail)
      check('certificate numbers use the certificate code', (await nextCertNo(tx, b.id, b2.certCode!)).startsWith('CERT-TCNWS-'))

      // ---- 4. activate -----------------------------------------------------------------------------------
      const act = await activateBranch(tx, sup, b.id)
      check('activation: branch active, all 3 people get a fresh one-time password', act.branch.status === 'active' && act.logins.length === 3)
      const [a3] = await tx.select().from(users).where(eq(users.id, admin.id))
      const adminLogin = act.logins.find((l) => l.userId === admin.id)!
      check('the mailed password works and must be changed at first sign-in; the old one does not', await verifyPassword(a3.passwordHash, adminLogin.password) && !(await verifyPassword(a3.passwordHash, pw)) && a3.mustChangePassword)
      check('live session check now allows the branch', (await loadUserStateIn(tx, admin.id))!.branchActive === true)
      const m = loginMessage(act.branch, adminLogin, { branch_manager: 'Branch Manager' }, 'https://panel.example')
      check('login e-mail: link, username, password, role and branch', m.to === newMail && m.body.includes('https://panel.example/login') && m.body.includes(`Username: ${newMail}`) && m.body.includes(adminLogin.password) && m.body.includes('Branch Manager') && m.body.includes('NWN'))
      check('e-mail HTML escapes names', loginMessage({ ...act.branch, name: '<b>x</b>' }, adminLogin, {}, 'https://e.t').html.includes('&lt;b&gt;x'))
      const again = await resendLogin(tx, sup, multi.user.id)
      check('resend login: one new password, for that person only', again.logins.length === 1 && again.logins[0].email === multi.user.email)
      await throws(tx, 'an active branch cannot be activated again', () => activateBranch(tx, sup, b.id), /already active/)

      // ---- one person serving several branches (shared staff)
      const two = await createBranch(tx, sup, full({ name: 'Techcadd Patiala', city: 'Patiala', email: `p.${stamp}@branches.test.invalid` }))
      const pick = await staffElsewhere(tx, sup, two.branch.id, 'accountant')
      check('the accountant of another branch is offered to the new branch', pick.some((o) => o.id === multi.user.id && o.home === b.code))
      await shareStaff(tx, sup, two.branch.id, multi.user.id)
      const shared = await branchSetup(tx, sup, two.branch.id)
      check('a shared accountant completes the accountant step and shows their home branch', shared.steps.find((x) => x.key === 'accountant')!.done && shared.team.find((m) => m.id === multi.user.id)?.home === b.code)
      check('...and is no longer offered again', !(await staffElsewhere(tx, sup, two.branch.id, 'accountant')).some((o) => o.id === multi.user.id))
      await throws(tx, 'a person cannot be shared with their own branch', () => shareStaff(tx, sup, b.id, multi.user.id), /already belongs/)
      check('a branch still in setup is not yet a working branch of the shared person', (await loadUserStateIn(tx, multi.user.id))!.branches.length === 1)
      await tx.execute(sql`update branches set status = 'active' where id = ${two.branch.id}`)
      check('once it is active they can work in both branches (home first)', (await loadUserStateIn(tx, multi.user.id))!.branches.map((x) => x.id).join() === [b.id, two.branch.id].join())
      await tx.execute(sql`reset role`)
      await applyTenant(tx, { userId: two.adminUserId, orgId: ORG, role: 'branch_manager', branchId: two.branch.id })
      check('the other branch sees the shared person', (await tx.select().from(users).where(eq(users.id, multi.user.id))).length === 1)
      await throws(tx, '...but cannot reset their password', () => resetUserPassword(tx, { userId: two.adminUserId, orgId: ORG, role: 'branch_manager', branchId: two.branch.id }, multi.user.id), /another branch/)
      await throws(tx, 'only head office shares staff', () => shareStaff(tx, { userId: two.adminUserId, orgId: ORG, role: 'branch_manager', branchId: two.branch.id }, two.branch.id, admin.id), /Forbidden/)
      await tx.execute(sql`reset role`)
      await applyTenant(tx, sup)
      await unshareStaff(tx, sup, two.branch.id, multi.user.id)
      check('removing them takes the branch away again', (await loadUserStateIn(tx, multi.user.id))!.branches.length === 1)

      await tx.execute(sql`reset role`)
      const mgr: Actor = { userId: admin.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      await applyTenant(tx, mgr)
      await throws(tx, 'only head office adds branches', () => createBranch(tx, mgr, full({ city: 'Patiala', email: `x.${stamp}@t.invalid` })), /Forbidden/)
      await throws(tx, 'only head office edits branches', () => updateBranch(tx, mgr, { id: b.id, name: 'X Y Z', address: 'Somewhere 1', state: 'Punjab', pincode: '144515', phone: '9876500000', email: newMail }), /Forbidden/)
      await throws(tx, 'only head office activates branches', () => activateBranch(tx, mgr, b.id), /Forbidden/)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }

  // ---- sign-in is refused (after the password check) for a branch in setup: real login(), committed + cleaned up
  const c = await pool.connect()
  const email = `gate.${stamp}@branches.test.invalid`
  try {
    const hash = await (await import('../lib/auth/password')).hashPassword('Gate-pass-12345')
    const [{ id: bid }] = (await c.query(`insert into branches (org_id, code, name, status) values ($2, $1, 'Gate test', 'setup') returning id`, [`G${String(stamp).slice(-5)}`, ORG])).rows
    const [{ id: uid }] = (await c.query(`insert into users (org_id, name, email, branch_id, password_hash) values ($4, 'Gate', $1, $2, $3) returning id`, [email, bid, hash, ORG])).rows
    await c.query(`insert into user_roles (org_id, user_id, role) values ($2, $1, 'counselor')`, [uid, ORG])
    const r1 = await login(SAMPLE_ORG, email, 'Gate-pass-12345', { ip: 'gate-' + stamp, userAgent: null })
    check('sign-in to a branch in setup is refused with a clear message', !r1.ok && r1.error === BRANCH_NOT_READY)
    const r2 = await login(SAMPLE_ORG, email, 'wrong-password-1', { ip: 'gate2-' + stamp, userAgent: null })
    check('...but a wrong password still gets the generic message (nothing revealed)', !r2.ok && r2.error === 'Invalid email or password')
    await c.query(`update branches set status = 'active' where id = $1`, [bid])
    const r3 = await login(SAMPLE_ORG, email, 'Gate-pass-12345', { ip: 'gate3-' + stamp, userAgent: null })
    check('after activation the same login works', r3.ok)
    // audit rows are append-only (by design), so the throw-away login is retired rather than deleted
    await c.query(`update users set is_active = false, deleted_at = now() where id = $1`, [uid]); await c.query(`update branches set is_active = false where id = $1`, [bid])
  } finally { c.release() }

  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main()
