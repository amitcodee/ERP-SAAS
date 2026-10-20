// A new organisation (modules/orgs/provision.ts) and roles per org: what a new institute starts with, that its roles
// are its own (changing one never touches another org's), and that a person can only hold their own org's roles.
// Against the real DB in ONE rolled-back transaction.
import { sql } from 'drizzle-orm'
import { DEFAULT_ROLES } from '../lib/auth/permissions'
import { verifyPassword } from '../lib/auth/password'
import { db, pool } from '../lib/db/client'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { applyOrgSystem, applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { provisionOrgIn, STARTER_LOOKUPS } from '../modules/orgs/provision'
import { listRoles, saveRole } from '../modules/roles/service'

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
/** The platform context, as withPlatform sets it. */
const platform = async (tx: Tx) => {
  await tx.execute(sql`reset role`); await tx.execute(sql`set local role techcadd_app`)
  await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true), set_config('app.role', 'platform', true), set_config('app.is_super', 'false', true)`)
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await platform(tx)
      const made = await provisionOrgIn(tx, { name: 'Bright Future Academy', slug: 'bright-future-test', ownerName: 'Meera Kapoor', ownerEmail: 'Meera@Bright.test.invalid' })
      check('a new org gets a temporary owner password, to change at first sign-in', !!made.tempPassword && made.tempPassword.length >= 12)

      await platform(tx)
      const [o] = (await tx.execute<{ status: string; plan_key: string; days: number; owner_user_id: string; timezone: string }>(sql`
        select status, plan_key, extract(day from trial_ends_at - now())::int as days, owner_user_id, timezone from organisations where id = ${made.orgId}`)).rows
      check('it starts on a 14-day trial of the starter plan, with its owner set', o.status === 'trial' && o.plan_key === 'starter' && o.days >= 13 && o.days <= 14 && o.owner_user_id === made.ownerUserId && o.timezone === 'Asia/Kolkata')
      await throws(tx, 'the same web address cannot be taken twice', () => provisionOrgIn(tx, { name: 'Copy', slug: 'bright-future-test', ownerName: 'X Y', ownerEmail: 'x@y.test.invalid' }), /taken/)
      await platform(tx)
      await throws(tx, 'a reserved address is refused', () => provisionOrgIn(tx, { name: 'Admin', slug: 'admin', ownerName: 'X Y', ownerEmail: 'x@y.test.invalid' }), /reserved/)
      await platform(tx)
      await throws(tx, 'a bad owner e-mail is refused', () => provisionOrgIn(tx, { name: 'Bad Mail', slug: 'bad-mail-test', ownerName: 'X Y', ownerEmail: 'not-mail' }), /valid e-mail/)

      // ---- inside the new org ------------------------------------------------------------------------------------
      await tx.execute(sql`reset role`); await applyOrgSystem(tx, made.orgId)
      const rows = <T,>(q: ReturnType<typeof sql>) => tx.execute<T & Record<string, unknown>>(q).then((r) => r.rows)
      const owner = (await rows<{ email: string; branch_id: string | null; must_change_password: boolean; password_hash: string }>(sql`select email, branch_id, must_change_password, password_hash from users`))
      check('one login: the owner, at head office, e-mail in lower case, a change forced', owner.length === 1 && owner[0].email === 'meera@bright.test.invalid' && owner[0].branch_id === null && owner[0].must_change_password)
      check('... whose temporary password works', await verifyPassword(owner[0].password_hash, made.tempPassword!))
      const ownerRoles = await rows<{ role: string }>(sql`select role from user_roles`)
      check('the owner is the Institute Admin', ownerRoles.length === 1 && ownerRoles[0].role === 'super_admin')
      const lists = await rows<{ kind: string; n: number }>(sql`select kind, count(*)::int as n from lookups group by kind`)
      check('the standard lists are there', Object.entries(STARTER_LOOKUPS).every(([k, v]) => lists.find((l) => l.kind === k)?.n === v.length))
      const br = await rows<{ code: string; name: string }>(sql`select code, name from branches`)
      check('a first branch, MAIN', br.length === 1 && br[0].code === 'MAIN' && br[0].name === 'Main branch')
      check('nothing of the Sample Institute is visible', (await rows<{ n: number }>(sql`select count(*)::int as n from registrations`))[0].n === 0 && (await rows<{ n: number }>(sql`select count(*)::int as n from departments`))[0].n === 0)

      const head: Actor = { userId: made.ownerUserId, orgId: made.orgId, role: 'super_admin', branchId: null }
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      const mine = await listRoles(tx)
      check('the Roles screen shows the org’s own roles: every default, named as in the code', mine.length === DEFAULT_ROLES.length && DEFAULT_ROLES.every((d) => mine.find((r) => r.key === d.key)?.name === d.name))
      check('the head-office role is called Institute Admin', mine.find((r) => r.key === 'super_admin')?.name === 'Institute Admin' && mine.find((r) => r.key === 'super_admin')?.users === 1)

      // ---- roles are per org --------------------------------------------------------------------------------------
      await saveRole(tx, head, { key: 'counselor', name: 'Admissions Counsellor', permissions: ['enquiry:read'] })
      const custom = await saveRole(tx, head, { name: 'Placement Officer', permissions: ['registration:read'] })
      await tx.execute(sql`reset role`); await applyOrgSystem(tx, ORG)
      const sample = await rows<{ key: string; name: string; permissions: string[] }>(sql`select key, name, permissions from roles`)
      check('changing a role in one org leaves the same role in another org as it was', sample.find((r) => r.key === 'counselor')?.name === 'Counselor' && (sample.find((r) => r.key === 'counselor')?.permissions.length ?? 0) > 2)
      check('a role made in one org is not in another', !sample.some((r) => r.key === custom))
      const [sampleUser] = await rows<{ id: string }>(sql`select id from users limit 1`)
      await throws(tx, 'a person cannot be given another org’s role', () => tx.execute(sql`insert into user_roles (user_id, role) values (${sampleUser.id}, ${custom})`), /foreign key|violates/)
      await tx.execute(sql`reset role`); await applyOrgSystem(tx, made.orgId)
      await throws(tx, 'nor can a role point at a person of another org', () => tx.execute(sql`insert into user_roles (user_id, role) values (${sampleUser.id}, 'trainer')`), /foreign key|violates/)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
