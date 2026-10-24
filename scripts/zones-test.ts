// Zones (modules/branches/zones.ts) against the real DB, inside ONE transaction that is rolled back: only head office
// sets them up; a zonal manager gets every branch of the zone (full access) and loses only what the zone gave.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, userBranches, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { addZoneManager, createZone, deleteZone, listZones, removeZoneManager, setBranchZone } from '../modules/branches/zones'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = `${e} ${(e as { cause?: unknown }).cause ?? ''}`; check(name, !match || match.test(msg), msg.slice(0, 100)) }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`)
      const mk = async (code: string) => (await tx.insert(branches).values({ code, name: `Zone ${code}` }).returning())[0]
      const [a, b, c, d] = [await mk('ZA1'), await mk('ZB1'), await mk('ZC1'), await mk('ZD1')]
      const [zm] = await tx.insert(users).values({ branchId: a.id, name: 'Zonal Manager', email: 'zm@zone.test.invalid', passwordHash: 'x' }).returning()
      const [hoUser] = await tx.insert(users).values({ name: 'HO', email: 'ho@zone.test.invalid', passwordHash: 'x' }).returning()
      const head: Actor = { userId: hoUser.id, orgId: ORG, role: 'super_admin', branchId: null }
      const mgr: Actor = { userId: zm.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const shares = async () => (await tx.execute<{ branch_id: string; access: string; via_zone: string | null }>(sql`select branch_id, access, via_zone from user_branches where user_id = ${zm.id}`)).rows

      await applyTenant(tx, mgr)
      await throws(tx, 'a branch manager cannot set up zones', () => createZone(tx, mgr, 'North'), /head office|Forbidden/)
      await tx.execute(sql`reset role`); await applyTenant(tx, head)
      const north = await createZone(tx, head, 'North')
      await throws(tx, 'two zones cannot share a name', () => createZone(tx, head, 'north'), /already/)
      await throws(tx, 'head office staff cannot manage a zone (they see everything)', () => addZoneManager(tx, head, north, hoUser.id), /head office/)

      // D was shared with the manager by hand (own work only) before any zone
      await tx.insert(userBranches).values({ userId: zm.id, branchId: d.id, access: 'own' })
      for (const x of [a, b, c, d]) await setBranchZone(tx, head, x.id, north)
      await addZoneManager(tx, head, north, zm.id)
      let s = await shares()
      check('the manager gets every branch of the zone with full access (not their home)', s.some((x) => x.branch_id === b.id && x.access === 'full' && x.via_zone === north) && s.some((x) => x.branch_id === c.id && x.access === 'full') && !s.some((x) => x.branch_id === a.id), JSON.stringify(s))
      check('a branch shared by hand keeps the access head office gave', s.some((x) => x.branch_id === d.id && x.access === 'own' && x.via_zone === null))
      const [zr] = (await listZones(tx, head)).filter((z) => z.id === north)
      check('the zone lists its branches and manager', zr.branches.length === 4 && zr.managers[0]?.userId === zm.id)

      await setBranchZone(tx, head, c.id, null)
      s = await shares()
      check('a branch taken out of the zone: the manager loses it', !s.some((x) => x.branch_id === c.id) && s.some((x) => x.branch_id === b.id))
      await setBranchZone(tx, head, c.id, north)
      check('… and gets it back when it comes in again', (await shares()).some((x) => x.branch_id === c.id && x.via_zone === north))

      await removeZoneManager(tx, head, north, zm.id)
      s = await shares()
      check('taken off the zone: only what the zone gave goes', s.length === 1 && s[0].branch_id === d.id, JSON.stringify(s))

      await addZoneManager(tx, head, north, zm.id)
      await deleteZone(tx, head, north)
      s = await shares()
      const zoned = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from branches where zone_id is not null and id in (${a.id}, ${b.id}, ${c.id}, ${d.id})`)).rows[0].n
      check('a zone deleted: its branches stay (in no zone), its shares go', zoned === 0 && s.length === 1 && s[0].branch_id === d.id)
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
