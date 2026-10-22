// The online admission form (modules/web-leads/apply.ts) against the real DB, inside ONE transaction that is rolled
// back: the signed ticket, the hidden robot field, the centre the visitor chose, the ad it came from (utm_*), and that
// it lands as a website lead and a Lead of that centre.
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { DEFAULTS, type AdmissionFormConfig } from '../lib/config/store'
import { branches, enquiries, enquiryEvents, userRoles, users, webLeads } from '../lib/db/schema'
import { applyOrgSystem, applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { applyFormIn, applyTicket, submitApplicationIn, ticketProblem } from '../modules/web-leads/apply'
import { campaignOf, listWebLeads } from '../modules/web-leads/service'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), msg.slice(0, 110)) }
}
const stamp = Date.now()
const s = String(stamp).slice(-5)
const OTHER_ORG = '00000000-0000-4000-8000-00000000abcd'

async function main() {
  // ---- the ticket (pure) ----
  const t0 = 1_800_000_000_000
  const tk = applyTicket(ORG, t0)
  check('a ticket sent at once is refused (robots are quick)', /very quick/.test(ticketProblem(ORG, tk, t0 + 1000) ?? ''))
  check('a ticket after a few seconds is accepted', ticketProblem(ORG, tk, t0 + 5000) === null)
  check('a ticket left open over 12 hours is refused', /long time/.test(ticketProblem(ORG, tk, t0 + 13 * 3600_000) ?? ''))
  check('a changed or made-up ticket is refused', /out of date/.test(ticketProblem(ORG, tk.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), t0 + 5000) ?? '') && /out of date/.test(ticketProblem(ORG, `${t0}.xyz`, t0 + 5000) ?? '') && /out of date/.test(ticketProblem(ORG, '', t0) ?? ''))
  check('another institute’s ticket is refused', /out of date/.test(ticketProblem(OTHER_ORG, tk, t0 + 5000) ?? ''))
  check('the campaign reads source / medium / campaign', campaignOf({ utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'summer', gclid: 'x' }) === 'instagram / paid / summer' && campaignOf({ utm_source: ' fb ' }) === 'fb' && campaignOf(null) === null && campaignOf({ utm_source: 5 }) === null)

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`)
      const [u] = await tx.insert(users).values({ name: 'Sup', email: `ap${stamp}@test.invalid`, passwordHash: 'x' }).returning()
      await tx.insert(userRoles).values({ userId: u.id, orgId: ORG, role: 'super_admin' })
      const sup: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const [a] = await tx.insert(branches).values({ code: `AP${s}`, name: `Apply North ${s}`, city: `Northcity${s}` }).returning()
      const [b] = await tx.insert(branches).values({ code: `AQ${s}`, name: `Apply South ${s}`, city: `Southcity${s}` }).returning()
      const [gone] = await tx.insert(branches).values({ code: `AR${s}`, name: `Apply Closed ${s}`, isActive: false }).returning()
      await applyOrgSystem(tx, ORG) // as the public form runs: the institute's system, no user

      const off: AdmissionFormConfig = DEFAULTS.admission_form
      const on: AdmissionFormConfig = { ...off, enabled: true, thanks: 'Thanks! We call back within a day.' }
      const ticket = applyTicket(ORG, Date.now() - 10_000)
      const base = { name: '  Simran   Kaur ', phone: `98${s}0101`.slice(0, 10), email: 'Simran@Example.com', branchId: b.id, course: '', location: 'Model Town', message: 'Weekend batch?', ticket, page: '', referrer: '' }

      const form = await applyFormIn(tx, ORG, on)
      check('the page offers the active centres only, with their codes', form.branches.some((x) => x.id === a.id && x.code === `AP${s}`) && form.branches.some((x) => x.id === b.id) && !form.branches.some((x) => x.id === gone.id))
      check('it is off until switched on', !(await applyFormIn(tx, ORG, off)).enabled && form.enabled)
      await throws(tx, 'a form sent while it is off is refused', () => submitApplicationIn(tx, ORG, off, base, 'acme.example.com'), /not open online/)
      await throws(tx, 'a form without a real mobile is refused', () => submitApplicationIn(tx, ORG, on, { ...base, phone: '12345' }, 'acme.example.com'), /valid 10-digit mobile/)
      await throws(tx, 'a form without a name is refused (the sentence, for a visitor)', () => submitApplicationIn(tx, ORG, on, { ...base, name: ' ' }, 'acme.example.com'), /full name/)
      await throws(tx, 'with several centres, one must be chosen', () => submitApplicationIn(tx, ORG, on, { ...base, branchId: '' }, 'acme.example.com'), /choose the centre/)
      await throws(tx, 'a closed centre cannot be chosen', () => submitApplicationIn(tx, ORG, on, { ...base, branchId: gone.id }, 'acme.example.com'), /choose the centre/)
      await throws(tx, 'a form sent too fast is refused', () => submitApplicationIn(tx, ORG, on, { ...base, ticket: applyTicket(ORG) }, 'acme.example.com'), /very quick/)

      const before = (await tx.execute<{ n: number }>(sql`select count(*)::int n from web_leads`)).rows[0].n
      const robot = await submitApplicationIn(tx, ORG, on, { ...base, website: 'http://spam.example' }, 'acme.example.com')
      const after = (await tx.execute<{ n: number }>(sql`select count(*)::int n from web_leads`)).rows[0].n
      check('a robot (the hidden field) is thanked and nothing is kept', robot.status === 'received' && before === after)

      // ---- embedded in the institute's website, from an Instagram ad ----
      const r = await submitApplicationIn(tx, ORG, on, { ...base, page: `https://www.acme-site${s}.example/admissions?utm_source=instagram`, referrer: 'https://l.instagram.com/', utm: { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'summer-batch', fbclid: 'abc', evil: 'x' } }, 'acme.example.com')
      check('the visitor is thanked with the institute’s words', r.thanks === 'Thanks! We call back within a day.')
      const [w] = await tx.select().from(webLeads).where(eq(webLeads.siteHost, `acme-site${s}.example`))
      check('it arrives as a website lead of the website page holding the form', !!w && w.sourceUrl === `https://www.acme-site${s}.example/admissions?utm_source=instagram` && w.name === 'Simran Kaur' && w.email === 'simran@example.com' && w.location === 'Model Town')
      check('… in the centre the visitor chose (not by website or place)', w?.branchId === b.id && w.matchedBy === 'form' && !!w.enquiryId && !w.problem)
      const p = (w?.payload ?? {}) as Record<string, string>
      check('… with the ad it came from, the referrer and the form kept; unknown fields are not', p.utm_source === 'instagram' && p.utm_campaign === 'summer-batch' && p.fbclid === 'abc' && p.referrer === 'https://l.instagram.com/' && p.form === 'admission' && !('evil' in p), JSON.stringify(p))
      const [e] = await tx.select().from(enquiries).where(eq(enquiries.id, w!.enquiryId!))
      const [ev] = await tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, e.id))
      check('it is a new Lead of that centre, its history naming the campaign and the question', e.branchId === b.id && e.status === 'new' && /Campaign: instagram \/ paid \/ summer-batch/.test(ev.note ?? '') && /Weekend batch\?/.test(ev.note ?? ''), ev.note ?? '')

      // ---- the same person again, from the hosted page ----
      await submitApplicationIn(tx, ORG, on, { ...base, page: 'http://acme.example.com/apply', message: 'Fees?' }, 'acme.example.com')
      const again = await tx.select().from(webLeads).where(and(eq(webLeads.siteHost, 'acme.example.com'), eq(webLeads.phoneNorm, base.phone)))
      check('from the institute’s own page the site is its own address', again.length === 1 && again[0].branchId === b.id)
      check('… and the same person is added to their open lead, not a second one', again[0]?.enquiryId === e.id)

      // ---- the institute asks for less ----
      const less: AdmissionFormConfig = { ...on, askEmail: false, askLocation: false, askMessage: false }
      await submitApplicationIn(tx, ORG, less, { ...base, phone: `97${s}0202`.slice(0, 10), branchId: a.id, page: `https://less${s}.example/` }, 'acme.example.com')
      const [l] = await tx.select().from(webLeads).where(eq(webLeads.siteHost, `less${s}.example`))
      check('fields the form does not ask for are not kept', !!l && l.email === null && l.location === null && l.message === null && l.branchId === a.id)

      await applyTenant(tx, sup)
      const list = await listWebLeads(tx, sup, { site: `acme-site${s}.example` })
      check('Web Leads shows the campaign and that the visitor chose the centre', list.rows[0]?.campaign === 'instagram / paid / summer-batch' && list.rows[0]?.matchedBy === 'form')
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
