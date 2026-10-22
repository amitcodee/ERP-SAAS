// An institute's own domain (modules/orgs/domains.ts) against the real DB, inside ONE transaction that is rolled back:
// what counts as a domain, who may add one, the plan, the TXT check (with a stand-in for DNS), and that a verified
// domain is how the institute is found and linked.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { userRoles, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { addDomain, domainOf, listDomains, removeDomain, TXT_PREFIX, verifyDomain } from '../modules/orgs/domains'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), msg.slice(0, 100)) }
}
const host = `erp${Date.now().toString(36)}.acme-test.in`

async function main() {
  check('a domain: case, scheme, path and port do not matter', domainOf('https://ERP.Acme.in:443/login?x=1') === 'erp.acme.in' && domainOf('acme.co.uk') === 'acme.co.uk')
  check('not a domain: words, an address with no dot, an IP, a bare TLD', domainOf('my institute') === null && domainOf('localhost') === null && domainOf('10.0.0.1') === null && domainOf('in') === null)

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`)
      const [u] = await tx.insert(users).values({ name: 'Head', email: `dom${Date.now()}@test.invalid`, passwordHash: 'x' }).returning()
      await tx.insert(userRoles).values({ userId: u.id, orgId: ORG, role: 'super_admin' })
      const head: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const mgr: Actor = { ...head, role: 'branch_manager', branchId: null }
      await applyTenant(tx, head)

      await throws(tx, 'a branch manager cannot add a domain', () => addDomain(tx, mgr, host), /Forbidden|head office/)
      await throws(tx, 'nonsense is refused', () => addDomain(tx, head, 'my institute'), /Type a domain/)
      const d = await addDomain(tx, head, `https://${host.toUpperCase()}/`)
      check('head office adds it (lower case), not yet verified, with a token', d.host === host && !d.verifiedAt && d.token.length >= 20)
      await throws(tx, 'the same domain twice is refused', () => addDomain(tx, head, host), /added already/)

      const asked: string[] = []
      const none = async (name: string) => { asked.push(name); return [] as string[] }
      check('no TXT record yet: not verified', !(await verifyDomain(tx, head, d.id, none)) && asked[0] === `${TXT_PREFIX}.${host}`)
      check('a wrong TXT value does not verify it', !(await verifyDomain(tx, head, d.id, async () => ['something-else'])))
      check('the right TXT value verifies it', await verifyDomain(tx, head, d.id, async () => ['v=other', ` ${d.token} `]))
      check('… and it stays verified', (await listDomains(tx)).find((x) => x.id === d.id)?.verifiedAt !== null)
      const [found] = (await tx.execute<{ id: string }>(sql`select id from org_for_host(null, ${host})`)).rows
      check('a verified domain finds the institute', found?.id === ORG)

      await removeDomain(tx, head, d.id)
      const [gone] = (await tx.execute<{ id: string }>(sql`select id from org_for_host(null, ${host})`)).rows
      check('removed: the domain no longer finds it', !gone)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
