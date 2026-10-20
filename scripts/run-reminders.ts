// Daily job: queue today's fee reminders, then deliver whatever can be delivered (Settings → Reminders).
// The panel runs this by itself (Settings → Scheduled jobs); this script is for running it by hand, for every open
// organisation. Safe to run more than once.
import { pool } from '../lib/db/client'
import { runJobForAllOrgs } from '../lib/job-registry'

async function main() {
  console.log('[reminders]', JSON.stringify(await runJobForAllOrgs('reminders')))
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
