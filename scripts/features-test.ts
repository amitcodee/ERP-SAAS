// Feature packs (lib/panel/features.ts): which menu pages each hides, what a new institute starts with, and that an
// institute made before them keeps everything. Pure, plus one rolled-back look at a provisioned institute's choice.
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { withPlatform } from '../lib/db/withTenant'
import { FEATURES, hiddenModules, NEW_ORG_OFF } from '../lib/panel/features'
import { GROUPS, labelOf, MODULES } from '../lib/panel/modules'
import { provisionOrgIn } from '../modules/orgs/provision'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  const keys = new Set(MODULES.map((m) => m.key))
  check('every pack names real menu pages, and no page is in two packs', FEATURES.every((f) => f.modules.every((m) => keys.has(m))) && new Set(FEATURES.flatMap((f) => f.modules)).size === FEATURES.flatMap((f) => f.modules).length)
  const core = ['Dashboard', 'Leads', 'Enquiry', 'Registration', 'Fees', 'Students', 'Courses', 'Certificate Requests', 'Issue Certificate', 'Certificate Designs', 'Reports', 'Users & Staff', 'Branches', 'Settings', 'Set Up'] as const
  check('the core is in no pack: it can never be switched off', core.every((k) => !FEATURES.some((f) => (f.modules as string[]).includes(k))))
  check('nothing off: nothing hidden (institutes made before packs keep everything)', hiddenModules([]).size === 0)
  check('calling off hides the calling pages only', [...hiddenModules(['calling'])].sort().join() === [...FEATURES.find((f) => f.key === 'calling')!.modules].sort().join())
  check('an unknown pack hides nothing', hiddenModules(['nonsense']).size === 0)
  check('a new institute starts without calling, internships, letters, events, WhatsApp campaigns and the old-system import', ['calling', 'internships', 'letters', 'events', 'whatsapp', 'import'].every((k) => NEW_ORG_OFF.includes(k as never)) && !NEW_ORG_OFF.includes('webleads'))
  check('every page sits in one of the menu groups', MODULES.every((m) => GROUPS.includes(m.group)))
  check('plain names in the menu', labelOf('Enquiry') === 'Enquiries' && labelOf('Random Call') === 'Calls' && labelOf('Enquiry Update') === 'Find an enquiry')

  try {
    await withPlatform(async (tx) => {
      const made = await provisionOrgIn(tx, { name: 'Features Test', slug: `features-${Date.now().toString(36)}`, ownerName: 'Owner', ownerEmail: 'owner@features-test.invalid', status: 'pending' })
      const [c] = (await tx.execute<{ config: { off: string[] } }>(sql`select config from app_config where key = 'features'`)).rows
      check('a provisioned institute is saved with the starting packs off', !!made.orgId && JSON.stringify([...c.config.off].sort()) === JSON.stringify([...NEW_ORG_OFF].sort()))
      throw new Rollback()
    })
  } catch (e) { if (!(e instanceof Rollback)) { console.error(e); failed++ } }
  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main()
