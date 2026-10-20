// The platform console (modules/platform/service.ts): platform sign-in, the organisations list (sizes only), suspend /
// reactivate, support sessions (opened by the platform, read-only by default, ended by either side, everything in the
// org's audit log under the platform admin), and that the console's tokens never pass as an institute's.
// The services commit their own transactions, so this works on one fixed test org ("platform-test") and leaves it
// as it found it: active, with no open session.
import { sql } from 'drizzle-orm'
import { lookups } from '../lib/db/schema'
import { pool } from '../lib/db/client'
import { audit } from '../lib/audit'
import { readPlatformSession, readSession, readSupportLink, signPlatformSession, signSession, signSupportLink } from '../lib/auth/session'
import { SAMPLE_ORG_ID } from '../lib/db/schema/tenancy'
import { withOrgSystem, withPlatform, withTenant, type Actor } from '../lib/db/withTenant'
import { classifyHost } from '../lib/tenant/host'
import { orgForHost } from '../lib/tenant/resolve'
import { provisionOrg } from '../modules/orgs/provision'
import { endSupportByOrg, endSupportByPlatform, listOrgs, openSupport, platformLogin, setOrgStatus, startSupport, upsertPlatformUser } from '../modules/platform/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? ''); check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '') }
}
const SLUG = 'platform-test'

async function main() {
  try {
    // ---- platform people --------------------------------------------------------------------------------------------
    const made = await upsertPlatformUser({ name: 'Platform Tester', email: 'Platform-Tester@test.invalid' })
    const pu = await platformLogin('platform-tester@test.invalid', made.password)
    check('a platform admin signs in with the password handed over', pu?.id === made.id)
    check('a wrong password and an unknown e-mail get the same nothing', (await platformLogin('platform-tester@test.invalid', 'wrong-password-1')) === null && (await platformLogin('nobody@test.invalid', made.password)) === null)
    if (!pu) throw new Error('cannot go on without a platform admin')

    // ---- the test org --------------------------------------------------------------------------------------------
    let org = await orgForHost(classifyHost(`${SLUG}.localhost`))
    if (!org) { await provisionOrg({ name: 'Platform Test Institute', slug: SLUG, ownerName: 'Test Owner', ownerEmail: 'owner@platform-test.invalid', status: 'active' }); org = await orgForHost(classifyHost(`${SLUG}.localhost`)) }
    const orgId = org!.id
    await withPlatform((tx) => tx.execute(sql`update support_sessions set ended_at = now(), ended_by = 'platform' where org_id = ${orgId} and ended_at is null`))
    if (org!.status !== 'active') await setOrgStatus(pu, orgId, 'active', 'test starts active')

    const [row] = await listOrgs({ q: SLUG })
    check('the list finds it by its address, with its size', row?.id === orgId && row.branches === 1 && row.users >= 1 && row.activeStudents === 0 && row.plan === 'starter')
    check('the status filter works', (await listOrgs({ status: 'suspended' })).every((o) => o.status === 'suspended') && (await listOrgs({ q: SLUG, status: 'cancelled' })).length === 0)
    await throws('the size figures are for the platform only', () => withOrgSystem(SAMPLE_ORG_ID, (tx) => tx.execute(sql`select * from platform_org_stats()`)), /platform only/)

    // ---- suspend / reactivate ------------------------------------------------------------------------------------
    await throws('a status change needs a reason', () => setOrgStatus(pu, orgId, 'suspended', ' '), /reason/)
    await setOrgStatus(pu, orgId, 'suspended', 'unpaid since June')
    check('suspended: its address resolves as suspended at once (getActor then signs everyone out)', (await orgForHost(classifyHost(`${SLUG}.localhost`)))?.status === 'suspended')
    await throws('a support session cannot start in a suspended org', () => startSupport(pu, orgId, { reason: 'look at the fees', mode: 'read' }), /suspended/)
    await setOrgStatus(pu, orgId, 'active', 'paid')
    const logged = await withOrgSystem(orgId, async (tx) => (await tx.execute<{ action: string; impersonator_id: string; after: { reason: string; by: string } }>(sql`
      select action, impersonator_id, after from audit_logs where entity = 'organisation' and action like 'status_%' order by at desc limit 2`)).rows)
    check('both changes are in the org’s own audit log, under the platform admin', logged.length === 2 && logged.every((l) => l.impersonator_id === pu.id) && logged[1].after.reason === 'unpaid since June' && logged[0].action === 'status_active')

    // ---- support sessions ------------------------------------------------------------------------------------------
    await throws('a support session needs a real reason', () => startSupport(pu, orgId, { reason: 'x', mode: 'read' }), /Say why/)
    await throws('... and lasts at most an hour', () => startSupport(pu, orgId, { reason: 'look at the fees', mode: 'read', minutes: 120 }))
    const s = await startSupport(pu, orgId, { reason: 'ticket 42: fees not adding up', mode: 'read', minutes: 15 })
    await throws('one open session per org', () => startSupport(pu, orgId, { reason: 'another look', mode: 'read' }), /already open/)
    const open = await openSupport(orgId)
    check('the org sees it: who, why, read-only, when it ends', open?.id === s.id && open.by === 'Platform Tester' && open.mode === 'read' && open.reason.startsWith('ticket 42') && new Date(open.expiresAt).getTime() - Date.now() <= 15 * 60_000)
    check('another org does not', (await openSupport(SAMPLE_ORG_ID))?.id !== s.id)

    // tokens: each kind is good only where it belongs
    const link = await signSupportLink({ sup: s.id, org: orgId })
    const read = await readSupportLink(link)
    check('a support link names its session and org, and runs out in minutes', read?.sup === s.id && read.org === orgId && read.exp - Date.now() / 1000 <= 300)
    const platformToken = await signPlatformSession({ pid: pu.id, name: pu.name, email: pu.email })
    const tenantToken = await signSession({ userId: pu.id, org: orgId, orgSlug: SLUG, name: 'x', email: 'x@test.invalid', roles: ['super_admin'], role: 'super_admin', branchId: null, branchName: null })
    check('a support link or a platform session is never an institute session', (await readSession(link)) === null && (await readSession(platformToken)) === null)
    check('an institute session is never a platform session, nor a support link', (await readPlatformSession(tenantToken)) === null && (await readSupportLink(tenantToken)) === null && (await readPlatformSession(platformToken))?.pid === pu.id)

    // working inside: as the owner, marked as support, read-only refused by the database
    const owner = await withOrgSystem(orgId, async (tx) => (await tx.execute<{ id: string }>(sql`select owner_user_id as id from organisations where id = ${orgId}`)).rows[0].id)
    const support: Actor = { userId: owner, orgId, role: 'super_admin', branchId: null, readOnly: true, impersonatorId: pu.id, supportSessionId: s.id }
    await throws('a read-only support session cannot change anything', () => withTenant(support, (tx) => tx.insert(lookups).values({ kind: 'enquiry_source', value: 'Support was here', sortOrder: 99 })), /row-level security|read-only|violates/)
    await withTenant({ ...support, readOnly: false }, (tx) => audit(tx, { ...support }, { action: 'support_test', entity: 'settings', entityId: 'x' }))
    const [a] = await withOrgSystem(orgId, async (tx) => (await tx.execute<{ user_id: string; impersonator_id: string; support_session_id: string }>(sql`
      select user_id, impersonator_id, support_session_id from audit_logs where action = 'support_test' order by at desc limit 1`)).rows)
    check('what support does is logged as the owner, with the platform admin and the session named', a?.user_id === owner && a.impersonator_id === pu.id && a.support_session_id === s.id)

    // ending it: not by the support person; by head office; then it is gone
    await throws('the support person cannot end it from inside (head office does, or the console)', () => withTenant({ ...support, readOnly: false }, (tx) => endSupportByOrg(tx, support, s.id)), /head office/)
    const head: Actor = { userId: owner, orgId, role: 'super_admin', branchId: null }
    await withTenant(head, (tx) => endSupportByOrg(tx, head, s.id))
    check('ended by head office: no session open any more', (await openSupport(orgId)) === null)
    await throws('an ended session cannot be ended again', () => endSupportByPlatform(pu, s.id), /already ended/)
    const [ended] = await withPlatform(async (tx) => (await tx.execute<{ ended_by: string }>(sql`select ended_by from support_sessions where id = ${s.id}`)).rows)
    check('... and the console sees who ended it', ended.ended_by === 'org')
    const s2 = await startSupport(pu, orgId, { reason: 'one more look at the fees', mode: 'write', minutes: 5 })
    await endSupportByPlatform(pu, s2.id)
    check('the console can end its own session too', (await openSupport(orgId)) === null)
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
