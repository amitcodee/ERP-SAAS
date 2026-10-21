// Parents' links (modules/portal/parent.ts) against the real DB, inside ONE transaction that is rolled back: who may
// make one, what the parent sees, and that a stopped, replaced or wrong link shows nothing.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { eq } from 'drizzle-orm'
import { recordPayment } from '../modules/fees/service'
import { createParentLink, looksLikeToken, parentLinkState, parentViewIn, revokeParentLink } from '../modules/portal/parent'
import { createRegistration } from '../modules/registrations/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), msg.slice(0, 100)) }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b] = await tx.insert(branches).values({ code: 'PL1', name: 'Parent Pur' }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'Mgr', email: 'pl@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      const trainer: Actor = { ...mgr, role: 'trainer' }
      await applyTenant(tx, mgr)
      const reg = await createRegistration(tx, mgr, { person: { firstName: 'Kiran', lastName: 'Sidhu', phone: '9855500071' }, departmentId: dept.id, totalFee: 2000000, enrollmentDate: '2026-10-01' })
      await tx.execute(sql`update persons set guardian_phone = '9855500072' where id = (select person_id from registrations where id = ${reg.id})`)
      await recordPayment(tx, mgr, { registrationId: reg.id, amount: 500000, modeId: cash.id, nextInstallmentDate: '2026-11-15', nextInstallmentAmount: 1500000 })

      await throws(tx, 'a trainer cannot make a parent link', () => createParentLink(tx, trainer, reg.id), /Forbidden/)
      const first = await createParentLink(tx, mgr, reg.id)
      check('the office makes a link: a 32-character token, with the guardian’s phone to send it to', looksLikeToken(first.token) && first.guardianPhone === '9855500072' && first.name === 'Kiran')
      const [stored] = (await tx.execute<{ token_hash: string }>(sql`select token_hash from parent_links where registration_id = ${reg.id}`)).rows
      check('only a hash of the token is kept', !!stored && stored.token_hash !== first.token && stored.token_hash.length === 64)

      await tx.execute(sql`reset role`)
      const v = await parentViewIn(tx, first.token)
      check('the parent sees the student, course and branch', v?.student.name === 'Kiran Sidhu' && v.student.branch === 'Parent Pur' && v.student.regNo === reg.regNo)
      check('... the fees: paid, balance, the receipt and what is due now', v?.fees.paid === 500000 && v.fees.balance === 1500000 && v.fees.receipts.length === 1 && v.fees.payNow === 1500000, JSON.stringify(v?.fees))
      check('... and nothing else of the registration (no other student)', v?.registrationId === reg.id)
      const seen = await parentLinkState(tx, reg.id)
      check('opening the link is noted (last opened)', seen.live && !!seen.lastSeenAt)
      check('a wrong token shows nothing', (await parentViewIn(tx, 'x'.repeat(32))) === null)

      await applyTenant(tx, mgr)
      const second = await createParentLink(tx, mgr, reg.id)
      await tx.execute(sql`reset role`)
      check('a new link stops the old one', (await parentViewIn(tx, first.token)) === null && (await parentViewIn(tx, second.token)) !== null)
      await applyTenant(tx, mgr)
      await revokeParentLink(tx, mgr, reg.id)
      await tx.execute(sql`reset role`)
      check('a stopped link shows nothing', (await parentViewIn(tx, second.token)) === null && !(await parentLinkState(tx, reg.id)).live)
      await tx.execute(sql`update parent_links set revoked_at = null, created_at = now() - interval '400 days' where registration_id = ${reg.id}`)
      check('a link older than a year shows nothing', (await parentViewIn(tx, second.token)) === null)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exit(failed ? 1 : 0)
}
main()
