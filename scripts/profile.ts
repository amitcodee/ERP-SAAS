// Times every data loader of the main page for one user (dev database). Usage: tsx scripts/profile.ts <userId> <role> <branchId>
import { pool } from '../lib/db/client'
import { withTenant, type Actor } from '../lib/db/withTenant'
import { listBatches, listTrainers } from '../modules/academics/service'
import { listBranches } from '../modules/branches/service'
import { certificatePage } from '../modules/certificates/service'
import { listCourses, loadCatalogs } from '../modules/catalog/service'
import { listCallsPage, listEnquiries } from '../modules/enquiries/service'
import { listFeesPage } from '../modules/fees/service'
import { listNotifications } from '../modules/notifications/service'
import { listRegistrations } from '../modules/registrations/service'
import { dashboard, reports, summaries } from '../modules/reports/service'
import { listRules } from '../modules/settings/service'
import { listUsers } from '../modules/users/service'
import { SAMPLE_ORG_ID } from '../lib/db/schema/tenancy'

async function main() {
  const [userId, role, branchId] = process.argv.slice(2)
  const actor: Actor = { userId, orgId: SAMPLE_ORG_ID, role: role as never, branchId }
  const P = { limit: 25 }
  const steps: [string, (tx: any) => Promise<unknown>][] = [
    ['branches', (tx) => listBranches(tx)], ['catalogs', (tx) => loadCatalogs(tx)],
    ['enquiries', (tx) => listEnquiries(tx, actor, P)], ['registrations', (tx) => listRegistrations(tx, actor, P)],
    ['fees', (tx) => listFeesPage(tx, actor, P)], ['batches', (tx) => listBatches(tx, actor)], ['trainers', (tx) => listTrainers(tx)],
    ['certificates', (tx) => certificatePage(tx, actor, P)], ['courses', (tx) => listCourses(tx, actor)], ['calls', (tx) => listCallsPage(tx, actor, P)],
    ['dashboard', (tx) => dashboard(tx, actor, branchId)], ['reports', (tx) => reports(tx, actor, branchId)], ['users', (tx) => listUsers(tx, actor)],
    ['rules', (tx) => listRules(tx)], ['notifications', (tx) => listNotifications(tx, actor)], ['summaries', (tx) => summaries(tx, actor)],
  ]
  await withTenant(actor, async (tx) => {
    for (const [name, fn] of steps) { const t = performance.now(); await fn(tx); console.log(name.padEnd(14), Math.round(performance.now() - t), 'ms') }
  })
  await pool.end()
}
main()
