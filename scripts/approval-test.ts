// How new institutes start and stop (modules/platform/rules.ts, modules/platform/console.ts approveOrg / activateOrg,
// modules/billing/dunning.ts, lib/tenant/gate.ts): the platform's rules, approval, activation by hand with or without
// an end, a trial that ends closing the institute, and what each status lets people see. The services commit their own
// transactions: this works on one fixed test institute and puts the rules back as it found them.
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { withOrgSystem, withPlatform } from '../lib/db/withTenant'
import { classifyHost } from '../lib/tenant/host'
import { gateFor } from '../lib/tenant/gate'
import { forgetHosts, orgForHost } from '../lib/tenant/resolve'
import { runDunning } from '../modules/billing/dunning'
import { provisionOrg } from '../modules/orgs/provision'
import { activateOrg, approveOrg } from '../modules/platform/console'
import { onboardingRules, saveOnboardingRules } from '../modules/platform/rules'
import { upsertPlatformUser } from '../modules/platform/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try { await fn(); check(name, false, 'expected error') } catch (e) { const m = String(e); check(name, !match || match.test(m), m.slice(0, 110)) }
}
const one = async <T,>(q: ReturnType<typeof sql>) => (await withPlatform(async (tx) => (await tx.execute<T & Record<string, unknown>>(q)).rows))[0]
const plat = (q: ReturnType<typeof sql>) => withPlatform((tx) => tx.execute(q))
type Org = { status: string; days: number | null; features: Record<string, boolean> }

async function main() {
  const before = await onboardingRules()
  try {
    // ---- what each status lets people see (pure) ----
    check('waiting: head office may finish Set Up, branches, courses, staff and choose a plan', ['/setup', '/branches', '/users', '/courses', '/settings', '/account'].every((p) => gateFor('pending', p, true) === null))
    check('waiting: nothing else, and nothing at all for staff', gateFor('pending', '/dashboard', true) === 'pending' && gateFor('pending', '/enquiries', true) === 'pending' && gateFor('pending', '/setup', false) === 'pending')
    check('closed: head office sees only Plan & billing and its account; staff and students nothing', gateFor('read_only', '/settings', true) === null && gateFor('read_only', '/account', true) === null && gateFor('read_only', '/setup', true) === 'closed' && gateFor('read_only', '/dashboard', false) === 'closed')
    check('running: everything', ['trial', 'active', 'past_due'].every((s) => gateFor(s, '/dashboard', false) === null))
    check('"/setupx" is not Set Up', gateFor('pending', '/setupx', true) === 'pending')

    // ---- the rules ----
    await throws('a trial of 0 days is refused', () => saveOnboardingRules({ trialDays: 0, approval: true }), /At least 1 day/)
    await saveOnboardingRules({ trialDays: 3, approval: true })
    const r = await onboardingRules()
    check('the rules are saved: 3 days, approval on', r.trialDays === 3 && r.approval === true)

    const made = await upsertPlatformUser({ name: 'Approval Tester', email: 'approval-tester@test.invalid' })
    const pu = { id: made.id, name: 'Approval Tester', email: 'approval-tester@test.invalid' }
    let org = await orgForHost(classifyHost('approval-test.localhost'))
    if (!org) { await provisionOrg({ name: 'Approval Test Institute', slug: 'approval-test', ownerName: 'Owner', ownerEmail: 'owner@approval-test.invalid', status: 'pending' }); forgetHosts(); org = await orgForHost(classifyHost('approval-test.localhost')) }
    const id = org!.id
    const state = () => one<Org>(sql`select status, round(extract(epoch from trial_ends_at - now()) / 86400)::int as days, features from organisations where id = ${id}`)
    const reset = () => plat(sql`update organisations set status = 'pending', trial_ends_at = null, features = '{}' where id = ${id}`).then(() => plat(sql`update subscriptions set status = 'cancelled', current_period_start = now() - interval '2 days', current_period_end = now() - interval '1 day' where org_id = ${id}`)).then(() => forgetHosts())
    await reset()

    // ---- approval ----
    const a = await approveOrg(pu, id)
    const s1 = await state()
    check('approved: its trial starts now, for the platform’s length', a.status === 'trial' && s1.status === 'trial' && s1.days === 3, JSON.stringify(s1))
    await throws('approving twice is refused', () => approveOrg(pu, id), /not waiting/)
    const [audit] = await withOrgSystem(id, async (tx) => (await tx.execute<{ n: number }>(sql`select count(*)::int n from audit_logs where action = 'approved' and entity_id = ${id}`)).rows)
    check('the approval is in the institute’s own audit log', audit.n >= 1)

    await reset()
    await plat(sql`insert into subscriptions (org_id, plan_key, interval, status, current_period_start, current_period_end) select ${id}, plan_key, 'month', 'active', now(), now() + interval '30 days' from organisations where id = ${id}
      on conflict (org_id) do update set status = 'active', current_period_start = now(), current_period_end = now() + interval '30 days'`)
    const paid = await approveOrg(pu, id)
    check('approved after paying: active at once, no trial', paid.status === 'active' && (await state()).status === 'active' && (await state()).days === null)

    // ---- activation by hand ----
    await reset()
    await throws('activating needs a reason', () => activateOrg(pu, id, null, ''), /reason/)
    await throws('activating until a past date is refused', () => activateOrg(pu, id, '2020-01-01', 'bank transfer'), /after today/)
    const until = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
    await activateOrg(pu, id, until, 'paid ₹5,000 by bank transfer')
    const sub = await one<{ status: string; end_day: string; interval: string }>(sql`select status, (current_period_end at time zone 'Asia/Kolkata')::date::text as end_day, interval from subscriptions where org_id = ${id}`)
    check('active until a date: a paid period to that day (a reminder, grace, then closed, as if paid online)', (await state()).status === 'active' && sub.status === 'active' && sub.end_day === until && sub.interval === 'year', JSON.stringify(sub))
    await runDunning()
    check('… which the hourly billing check leaves alone before that day', (await state()).status === 'active')

    await activateOrg(pu, id, null, 'partner institute, free')
    await plat(sql`update subscriptions set current_period_start = now() - interval '60 days', current_period_end = now() - interval '20 days' where org_id = ${id}`)
    await runDunning()
    const s2 = await state()
    check('active with no end: never billed, even with an old period behind it', s2.status === 'active' && s2.features.billing_exempt === true)
    await activateOrg(pu, id, until, 'now paying')
    check('activating until a date again ends the exemption', (await state()).features.billing_exempt === undefined)

    // ---- a trial that ends closes it; paying or the platform opens it ----
    await reset()
    await approveOrg(pu, id)
    await plat(sql`update organisations set trial_ends_at = now() - interval '1 hour' where id = ${id}`)
    const d = await runDunning()
    check('the trial over and nothing paid: closed (only Plan & billing for head office)', d.changed.some((c) => c.from === 'trial' && c.to === 'read_only') && (await state()).status === 'read_only')
    forgetHosts()
    const closed = await orgForHost(classifyHost('approval-test.localhost'))
    check('… and its address says so to the gate', gateFor(closed!.status, '/dashboard', true) === 'closed')
    await activateOrg(pu, id, null, 'opened by hand')
    check('the platform can open a closed institute', (await state()).status === 'active')
  } catch (e) {
    console.error(e); failed++
  } finally {
    await saveOnboardingRules(before)
  }
  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main()
