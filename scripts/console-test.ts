// The platform console's business side (modules/platform/console.ts): metrics, plans, codes, an institute's plan /
// trial / feature flags (each in its audit log), and notices that reach exactly the institutes they are meant for.
// The services commit their own transactions: this works on one fixed test institute and one fixed test plan,
// and leaves them tidy (the plan hidden and off offer, notices ended).
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { SAMPLE_ORG_ID } from '../lib/db/schema/tenancy'
import { withOrgSystem, withPlatform } from '../lib/db/withTenant'
import { classifyHost } from '../lib/tenant/host'
import { orgForHost } from '../lib/tenant/resolve'
import { provisionOrg } from '../modules/orgs/provision'
import { createAnnouncement, createCoupon, endAnnouncement, extendTrial, liveAnnouncementsIn, listAnnouncements, metrics, savePlan, setCouponActive, setFeature, setOrgPlan } from '../modules/platform/console'
import { upsertPlatformUser } from '../modules/platform/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try { await fn(); check(name, false, 'expected error') } catch (e) { const m = `${e} ${(e as { cause?: unknown }).cause ?? ''}`; check(name, !match || match.test(m), match ? m.slice(0, 110) : '') }
}
const RUN = Date.now().toString(36)
const one = async <T,>(q: ReturnType<typeof sql>) => (await withPlatform(async (tx) => (await tx.execute<T & Record<string, unknown>>(q)).rows))[0]
const PLAN = { key: 'console_test', name: 'Console Test', description: 'test plan', priceMonthly: 50000, priceYearly: 500000, limits: { branches: 2, staff: 5, activeStudents: null, storageMb: 100, messagesPerMonth: 10 }, modules: ['events'], isPublic: false, isActive: false, sort: 99 }

async function main() {
  const notices: string[] = []
  try {
    const made = await upsertPlatformUser({ name: 'Console Tester', email: 'console-tester@test.invalid' })
    const pu = { id: made.id, name: 'Console Tester', email: 'console-tester@test.invalid' }
    let org = await orgForHost(classifyHost('console-test.localhost'))
    if (!org) { await provisionOrg({ name: 'Console Test Institute', slug: 'console-test', ownerName: 'Owner', ownerEmail: 'owner@console-test.invalid' }); org = await orgForHost(classifyHost('console-test.localhost')) }
    const orgId = org!.id
    await withPlatform((tx) => tx.execute(sql`update organisations set status = 'trial', trial_ends_at = now() + interval '3 days', plan_key = 'starter', features = '{}' where id = ${orgId}`))

    const m = await metrics()
    check('metrics: counts by status, MRR and the rest are numbers', typeof m.mrr === 'number' && (m.byStatus.trial ?? 0) >= 1 && m.conversion90.started >= m.conversion90.paid && Array.isArray(m.jobFailures))

    // plans
    await savePlan(PLAN)
    await savePlan({ ...PLAN, priceMonthly: 60000 })
    const p = await one<{ price_monthly: number; limits: { branches: number; activeStudents: number | null }; modules: string[] }>(sql`select price_monthly, limits, modules from plans where key = 'console_test'`)
    check('a plan is added, then changed in place', p.price_monthly === 60000 && p.limits.branches === 2 && p.limits.activeStudents === null && p.modules.join() === 'events')
    await throws('a plan with an unknown module is refused', () => savePlan({ ...PLAN, modules: ['teleport'] }), /Unknown module/)

    // codes
    const code = `CT${RUN}`.toUpperCase().slice(0, 20)
    await throws('a code is either a percentage or an amount, not both', () => createCoupon({ code, percentOff: 10, amountOff: 100 }), /either a percentage or an amount/)
    await createCoupon({ code, percentOff: 15, amountOff: null, plans: ['starter'] })
    await throws('the same code cannot be added twice', () => createCoupon({ code, percentOff: 10, amountOff: null }), /exists already/)
    await setCouponActive(code, false)
    check('a code can be switched off', (await one<{ a: boolean }>(sql`select is_active as a from coupons where code = ${code}`)).a === false)

    // one institute
    await setOrgPlan(pu, orgId, 'console_test', 'pilot deal')
    await extendTrial(pu, orgId, 10, 'needs more time to import')
    await setFeature(pu, orgId, 'beta_reports', true)
    const o = await one<{ plan_key: string; status: string; days: number; features: Record<string, boolean> }>(sql`select plan_key, status, extract(day from trial_ends_at - now())::int as days, features from organisations where id = ${orgId}`)
    check('plan changed, trial extended from its end, a flag switched on', o.plan_key === 'console_test' && o.status === 'trial' && o.days >= 12 && o.days <= 13 && o.features.beta_reports === true, JSON.stringify(o))
    await throws('a plan change needs a reason', () => setOrgPlan(pu, orgId, 'starter', ''), /reason/)
    await throws('a trial is extended by 1 to 90 days', () => extendTrial(pu, orgId, 365, 'too long'), /Between 1 and 90/)
    const logged = await withOrgSystem(orgId, async (tx) => (await tx.execute<{ action: string; impersonator_id: string }>(sql`
      select action, impersonator_id from audit_logs where action in ('plan_changed', 'trial_extended', 'feature') and at > now() - interval '1 minute'`)).rows)
    check('each change is in the institute’s audit log, under the platform admin', ['plan_changed', 'trial_extended', 'feature'].every((a) => logged.some((l) => l.action === a && l.impersonator_id === pu.id)))

    // notices: for one plan, then for everyone
    await createAnnouncement(pu, { title: `For console_test ${RUN}`, body: 'Only this plan', plans: ['console_test'] })
    await createAnnouncement(pu, { title: `For everyone ${RUN}`, body: 'Maintenance tonight', tone: 'warning' })
    for (const a of await listAnnouncements()) if (a.title.endsWith(RUN)) notices.push(a.id)
    const seen = async (id: string) => (await withOrgSystem(id, liveAnnouncementsIn)).map((n) => n.title)
    const mine = await seen(orgId), sample = await seen(SAMPLE_ORG_ID)
    check('a notice for a plan reaches the institutes on it', mine.includes(`For console_test ${RUN}`) && mine.includes(`For everyone ${RUN}`))
    check('... and not the others', !sample.includes(`For console_test ${RUN}`) && sample.includes(`For everyone ${RUN}`))
    for (const id of notices) await endAnnouncement(id)
    check('ended notices are gone', !(await seen(orgId)).some((t) => t.endsWith(RUN)))
    await throws('an ended notice cannot be ended again', () => endAnnouncement(notices[0]), /ended already/)
    notices.length = 0
  } finally {
    for (const id of notices) await endAnnouncement(id).catch(() => {})
    await withPlatform(async (tx) => { await tx.execute(sql`update organisations set plan_key = 'starter' where slug = 'console-test'`); await tx.execute(sql`update plans set is_public = false, is_active = false where key = 'console_test'`) })
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
