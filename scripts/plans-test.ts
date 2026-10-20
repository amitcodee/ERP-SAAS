// Plans and limits (lib/plan/limits.ts): the institute's usage counted over the whole institute and its own only, each
// limit refused with an upgrade prompt where things are added (branches, staff, students, files, messages), and the
// paid modules (events, the API) closed outside the plan but open during the trial.
// Against the real DB in ONE rolled-back transaction, on an institute made the real way.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { departments } from '../lib/db/schema'
import { SAMPLE_ORG_ID } from '../lib/db/schema/tenancy'
import { applyOrgSystem, applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { hasModule, orgPlan, orgUsage } from '../lib/plan/limits'
import { createBranch } from '../modules/branches/service'
import { uploadDocument } from '../modules/documents/service'
import { createEvent } from '../modules/events/service'
import { createApiKey } from '../modules/integrations/api'
import { createWebhook } from '../modules/integrations/webhooks'
import { provisionOrgIn } from '../modules/orgs/provision'
import { createRegistration } from '../modules/registrations/service'
import { createUser } from '../modules/users/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 120) : '') }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role techcadd_app`)
      await tx.execute(sql`select set_config('app.platform', 'true', true), set_config('app.org_id', '', true), set_config('app.role', 'platform', true)`)
      const org = await provisionOrgIn(tx, { name: 'Plans Test', slug: 'plans-test', ownerName: 'Owner', ownerEmail: 'owner@plans.test.invalid', status: 'active', planKey: 'starter' })
      // the platform's levers, as the database owner: the plan and status of the institute, and a plan with no room
      const owner = async (q: ReturnType<typeof sql>) => { await tx.execute(sql`reset role`); await tx.execute(q) }
      await owner(sql`insert into plans (key, name, limits, modules) values ('tiny_test', 'Tiny', '{"branches": 1, "staff": 1, "activeStudents": 0, "storageMb": 0, "messagesPerMonth": 0}', '{}')`)
      const head: Actor = { userId: org.ownerUserId, orgId: org.orgId, role: 'super_admin', branchId: null }
      const inBranch: Actor = { ...head, branchId: org.branchId }
      const as = async (a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
      await as(head)

      const p = await orgPlan(tx)
      check('the institute’s plan is read from its own row', p.key === 'starter' && p.status === 'active' && p.limits.branches === 1 && p.modules.includes('events'))
      const u = await orgUsage(tx)
      check('usage: one branch, one staff login (the owner), nothing else', u.branches === 1 && u.staff === 1 && u.activeStudents === 0 && u.storageMb === 0 && u.messagesPerMonth === 0, JSON.stringify(u))
      await as({ userId: org.ownerUserId, orgId: SAMPLE_ORG_ID, role: 'super_admin', branchId: null })
      check('another institute’s usage is its own', (await orgUsage(tx)).branches !== 1 || (await orgUsage(tx)).staff !== 1)
      await as(head)

      // limits, where things are added
      await throws(tx, 'a second branch on a one-branch plan is refused, with an upgrade prompt', () => createBranch(tx, head, { name: 'Second', city: 'Mohali' } as never), /plan allows 1 branch; 1 in use already\. Upgrade under Settings/)
      await owner(sql`update organisations set plan_key = 'tiny_test' where id = ${org.orgId}`); await as(head)
      await throws(tx, 'a staff login past the plan is refused', () => createUser(tx, head, { name: 'Teacher', email: 'teacher@plans.test.invalid', branchId: org.branchId, roles: ['trainer'] } as never), /allows 1 staff login/)
      await applyOrgSystem(tx, org.orgId)
      const [dept] = await tx.insert(departments).values({ name: 'Plans Dept' }).returning()
      await as(inBranch)
      await throws(tx, 'a registration past the plan’s active students is refused', () => createRegistration(tx, inBranch, { person: { firstName: 'Asha', phone: '9812345670' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' }), /allows 0 active students/)
      await throws(tx, 'a file past the plan’s storage is refused', () => uploadDocument(tx, inBranch, { registrationId: '00000000-0000-4000-8000-000000000123', kind: 'photo', fileName: 'p.png', bytes: Buffer.alloc(2048, 1) }), /allows 0 MB of files/)

      // modules
      await throws(tx, 'events are closed outside a plan that has them', () => createEvent(tx, inBranch, { title: 'Open day' } as never), /Seminars & workshops is not part of your Tiny plan/)
      await throws(tx, 'the API is closed outside a plan that has it', () => createApiKey(tx, head.userId, { name: 'BI', scopes: ['payments'] } as never), /read API is not part of your Tiny plan/)
      await throws(tx, '... and webhooks', () => createWebhook(tx, head.userId, { name: 'n8n', url: 'https://example.com/hook', events: ['*'] }), /Webhooks is not part of your Tiny plan/)
      await owner(sql`update organisations set status = 'trial' where id = ${org.orgId}`); await as(head)
      check('during the trial every module is open', (await hasModule(tx, 'api')) && (await hasModule(tx, 'events')) && (await hasModule(tx, 'white_label')))
      await throws(tx, '... but the plan’s limits still apply', () => createBranch(tx, head, { name: 'Second', city: 'Mohali' } as never), /plan allows 1 branch/)
      await owner(sql`update organisations set plan_key = 'enterprise', status = 'active' where id = ${org.orgId}`); await as(head)
      check('a plan without limits refuses nothing (null = no limit)', (await orgPlan(tx)).limits.branches == null && (await hasModule(tx, 'api')))
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
