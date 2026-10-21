// Bulk WhatsApp: campaigns (head office only), who a send picks (students by status / fee, leads by type / category),
// one message per number, the parameters filled per person, a branch limited to its own people, and the provider
// getting the campaign. Everything runs in ONE transaction that is rolled back.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, leadCategories, notifications, users } from '../lib/db/schema'
import type { Provider } from '../lib/notify/providers'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { createEnquiry, logCall } from '../modules/enquiries/service'
import { createRegistration } from '../modules/registrations/service'
import { dispatchQueued } from '../modules/notifications/service'
import { listBroadcasts, previewBroadcast, saveCampaign, sendBroadcast } from '../modules/notifications/broadcasts'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const throws = async (n: string, fn: () => Promise<unknown>, re: RegExp) => {
  try { await fn(); check(n, false, 'did not throw') } catch (e) { check(n, re.test(String((e as Error).message)), (e as Error).message) }
}

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b] = await tx.insert(branches).values({ code: 'BC1', name: 'Bcpur' }).returning()
      const [b2] = await tx.insert(branches).values({ code: 'BC2', name: 'Other' }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'bc', email: 'bc@w.test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cat] = await tx.insert(leadCategories).values({ name: 'BC test category' }).returning()
      const head: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const manager: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      const other: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b2.id }
      const telecaller: Actor = { userId: u.id, orgId: ORG, role: 'telecaller', branchId: b.id }

      // campaigns: head office only
      await applyTenant(tx, manager)
      await throws('a branch cannot list a campaign', () => saveCampaign(tx, manager, null, { label: 'x', campaign: 'x_x', audience: 'any', params: [], isActive: true }), /head office/)
      await applyTenant(tx, head)
      await throws('every {{n}} in the template needs a parameter', () => saveCampaign(tx, head, null, { label: 'Offer', campaign: 'bc_offer', audience: 'any', body: 'Hi {{1}} {{2}}', params: [{ field: 'first_name' }], isActive: true }), /\{\{n\}\}/)
      await throws('a typed parameter says what to type', () => saveCampaign(tx, head, null, { label: 'Offer', campaign: 'bc_offer', audience: 'any', params: [{ field: 'text' }], isActive: true }), /Typed when sending/)
      const offer = await saveCampaign(tx, head, null, {
        label: 'Diwali offer', campaign: 'bc_offer', audience: 'any', body: 'Hello {{1}}, get {{2}} off at our {{3}} branch. Due: {{4}}',
        params: [{ field: 'first_name' }, { field: 'text', label: 'Offer' }, { field: 'branch' }, { field: 'balance' }], mediaUrl: 'https://x.test/a.jpg', isActive: true,
      })
      await throws('the same AiSensy campaign is not listed twice', () => saveCampaign(tx, head, null, { label: 'Again', campaign: 'BC_OFFER', audience: 'any', params: [], isActive: true }), /already listed/)
      const leadsOnly = await saveCampaign(tx, head, null, { label: 'Leads only', campaign: 'bc_leads', audience: 'leads', params: [{ field: 'first_name' }], isActive: true })

      // people: students (one with two registrations), a lead and a call in a category, one in another branch
      await applyTenant(tx, manager)
      await createRegistration(tx, manager, { person: { firstName: 'Sita', lastName: 'Ram', phone: '9822200001' }, departmentId: dept.id, totalFee: 1500000, enrollmentDate: '2026-10-01' }, { quiet: true })
      await createRegistration(tx, manager, { person: { firstName: 'Sita', lastName: 'Ram', phone: '9822200001' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-02' }, { quiet: true })
      await createRegistration(tx, manager, { person: { firstName: 'Gita', phone: '9822200002' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' }, { quiet: true })
      await createEnquiry(tx, manager, { person: { firstName: 'Lalit', phone: '9822200003' }, departmentId: dept.id, lead: { visited: false, callDone: true, categoryId: cat.id } }, { quiet: true })
      await logCall(tx, manager, { person: { firstName: 'Kamal', phone: '9822200004' }, departmentId: dept.id, categoryId: cat.id } as never)
      await createEnquiry(tx, manager, { person: { firstName: 'Nocat', phone: '9822200005' }, departmentId: dept.id, lead: { visited: false, callDone: true } }, { quiet: true })
      await applyTenant(tx, other)
      await createRegistration(tx, other, { person: { firstName: 'Far', phone: '9822200009' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' }, { quiet: true })

      // who a send picks
      await applyTenant(tx, manager)
      const active = await previewBroadcast(tx, manager, offer.id, { kind: 'students', statuses: ['active'] }, ['20%'])
      check('students: one message per number, own branch only', active.sample.filter((x) => x.phone === '9822200001').length === 1 && !active.sample.some((x) => x.phone === '9822200009'), JSON.stringify(active.sample.map((x) => x.phone)))
      check('students: status filter (nobody here has completed)', (await previewBroadcast(tx, manager, offer.id, { kind: 'students', statuses: ['completed'] }, [])).total === 0)
      check('the preview reads as the message, with the details filled in', active.sample.find((x) => x.phone === '9822200001')?.text.startsWith('Hello Sita, get 20% off at our Bcpur branch. Due: ₹') === true, active.sample[0]?.text)
      const leads = await previewBroadcast(tx, manager, offer.id, { kind: 'leads', types: ['call', 'lead', 'visited'], categoryIds: [cat.id] }, ['20%'])
      check('leads: a category picks its calls and leads (and nobody else)', leads.total === 2 && leads.sample.every((x) => ['9822200003', '9822200004'].includes(x.phone)), JSON.stringify(leads.sample.map((x) => x.phone)))
      check('the filter in words', leads.summary.includes('BC test category') && leads.summary.includes('Bcpur'), leads.summary)
      await applyTenant(tx, other)
      check('another branch does not see these people', (await previewBroadcast(tx, other, offer.id, { kind: 'leads', types: ['call', 'lead', 'visited'], categoryIds: [cat.id] }, [])).total === 0)
      await applyTenant(tx, telecaller)
      await throws('sending needs the broadcast permission', () => previewBroadcast(tx, telecaller, offer.id, { kind: 'students', statuses: ['active'] }, []), /Forbidden/)

      // send
      await applyTenant(tx, manager)
      await throws('a typed detail must be filled in', () => sendBroadcast(tx, manager, offer.id, { kind: 'students', statuses: ['active'] }, ['']), /Fill in “Offer”/)
      await throws('a campaign for leads is not sent to students', () => sendBroadcast(tx, manager, leadsOnly.id, { kind: 'students', statuses: ['active'] }, []), /leads only/)
      const sent = await sendBroadcast(tx, manager, offer.id, { kind: 'leads', types: ['call', 'lead', 'visited'], categoryIds: [cat.id] }, ['20%'])
      const rows = await tx.select().from(notifications).where(eq(notifications.broadcastId, sent.id))
      check('queued: one per person, through the campaign, with the media', sent.queued === 2 && rows.length === 2 && rows.every((r) => r.campaign === 'bc_offer' && r.media?.url === 'https://x.test/a.jpg' && r.channel === 'whatsapp'))
      const lalit = rows.find((r) => r.toAddress === '9822200003')
      check('parameters filled per person (a lead has no fee: "-")', JSON.stringify(lalit?.params) === JSON.stringify(['Lalit', '20%', 'Bcpur', '-']), JSON.stringify(lalit?.params))
      const got: { campaign?: string | null; params?: string[] | null; media?: unknown }[] = []
      const fake: Provider = { name: 'fake', async send(m) { got.push({ campaign: m.campaign, params: m.params, media: m.media }); return { ok: true, ref: 'x' } } }
      await applyTenant(tx, head)
      await dispatchQueued(tx, async (c) => (c === 'whatsapp' ? fake : null), 500)
      check('the provider gets the campaign, the parameters and the media', got.filter((g) => g.campaign === 'bc_offer').length === 2 && got.some((g) => g.params?.[0] === 'Kamal' && !!g.media))
      await applyTenant(tx, manager)
      const list = await listBroadcasts(tx, manager)
      check('the send is listed with how many went out', list[0]?.id === sent.id && list[0].sent === 2 && list[0].total === 2, JSON.stringify(list[0]))
      await applyTenant(tx, other)
      check('another branch does not see the send', !(await listBroadcasts(tx, other)).some((x) => x.id === sent.id))
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from notifications where broadcast_id = ${sent.id}`)).rows
      check('…nor its messages', n === 0)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
