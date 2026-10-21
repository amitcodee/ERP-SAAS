// WhatsApp on events: lead, call, visit, registration and certificate messages are queued with the right parameters,
// once, only while WhatsApp is on, never for imports, and dropped when they waited too long. The work runs in ONE
// rolled-back transaction; the WhatsApp setting is switched on for the run and put back as it was afterwards.
import { and, eq, sql } from 'drizzle-orm'
import { db, ownerDb, pool } from '../lib/db/client'
import { branches, departments, notifications, users } from '../lib/db/schema'
import { dropConfigCache } from '../lib/config/store'
import type { Provider } from '../lib/notify/providers'
import { WA_MESSAGES, waText } from '../lib/notify/whatsapp'
import { applyTenant, withOrgSystem, type Actor } from '../lib/db/withTenant'
import { createEnquiry, logCall, promoteCall, updateLead } from '../modules/enquiries/service'
import { createRegistration } from '../modules/registrations/service'
import { dispatchQueued } from '../modules/notifications/service'
import { announceCertificate } from '../modules/notifications/whatsapp-events'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { brandIn } from '../lib/brand'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

type Saved = { config: unknown; secrets: string | null; updated_by: string | null } | undefined
async function setWhatsApp(cfg: Record<string, unknown> | null, saved?: Saved) {
  // the tables' owner: the app may not delete settings
  await ownerDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
    if (cfg) await tx.execute(sql`insert into app_config (key, config, secrets) values ('whatsapp', ${JSON.stringify(cfg)}::jsonb, null)
      on conflict (org_id, key) do update set config = excluded.config`)
    else if (saved) await tx.execute(sql`update app_config set config = ${JSON.stringify(saved.config)}::jsonb, secrets = ${saved.secrets} where key = 'whatsapp'`)
    else await tx.execute(sql`delete from app_config where key = 'whatsapp'`)
  })
  dropConfigCache()
}

async function main() {
  const saved = await withOrgSystem(ORG, async (tx) => (await tx.execute<NonNullable<Saved>>(sql`select config, secrets, updated_by from app_config where key = 'whatsapp'`)).rows[0])
  try {
    await setWhatsApp({ enabled: true, provider: 'aisensy', off: [] })
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b] = await tx.insert(branches).values({ code: 'WA1', name: `${(await brandIn(tx)).name} Wapur` }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'wa', email: 'wa@w.test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const actor: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      await applyTenant(tx, actor)
      const rows = async (template: string) => tx.select().from(notifications).where(and(eq(notifications.branchId, b.id), eq(notifications.template, template)))

      // a walk-in enquiry (no lead details) is a visit
      await createEnquiry(tx, actor, { person: { firstName: 'Aman', lastName: 'Gill', phone: '9811122201' }, departmentId: dept.id })
      const visit = await rows('visit_thanks')
      check('walk-in enquiry: "thank you for visiting" with first name and branch', visit.length === 1 && JSON.stringify(visit[0].params) === JSON.stringify(['Aman', 'Wapur']) && visit[0].toAddress === '9811122201' && visit[0].channel === 'whatsapp', JSON.stringify(visit[0]?.params))
      check('the log keeps the message as the student reads it', visit[0].body === waText('visit_thanks', ['Aman', 'Wapur'], (await brandIn(tx)).name) && visit[0].body.includes(`Thank you for visiting ${(await brandIn(tx)).name} Wapur`))

      // a lead that has not come in: "thank you for choosing", then a visit when it is marked visited
      const lead = await createEnquiry(tx, actor, { person: { firstName: 'Bina', phone: '9811122202' }, departmentId: dept.id, lead: { visited: false, callDone: true } })
      check('new lead: "thank you for choosing <institute>"', (await rows('enquiry_thanks')).some((n) => n.personId === lead.person.id && n.params?.[0] === 'Bina'))
      await updateLead(tx, actor, { enquiryId: lead.enquiry.id, lead: { visited: true, callDone: true } })
      check('lead marked visited: "thank you for visiting"', (await rows('visit_thanks')).some((n) => n.personId === lead.person.id))
      await updateLead(tx, actor, { enquiryId: lead.enquiry.id, lead: { visited: true, callDone: true, interested: true, interestPct: 60 } })
      check('saving a visited lead again sends nothing new', (await rows('visit_thanks')).filter((n) => n.personId === lead.person.id).length === 1)

      // a random call, then the call made into an enquiry the same day
      const { call, person } = await logCall(tx, actor, { person: { firstName: 'Chetan', phone: '9811122203' }, departmentId: dept.id })
      check('random call: "thank you for choosing <institute>"', (await rows('enquiry_thanks')).some((n) => n.personId === person.id))
      await promoteCall(tx, actor, call.id)
      check('call made into an enquiry (a visit): "thank you for visiting"', (await rows('visit_thanks')).some((n) => n.personId === person.id))
      await logCall(tx, actor, { person: { firstName: 'Chetan', phone: '9811122203' }, departmentId: dept.id })
      check('a second call the same day is not thanked twice', (await rows('enquiry_thanks')).filter((n) => n.personId === person.id).length === 1)

      // registration
      const reg = await createRegistration(tx, actor, { person: { firstName: 'Deep', phone: '9811122204' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })
      const r = (await rows('registration_confirmed')).find((n) => n.registrationId === reg.id)
      check('registration: confirmed with reg no and course', !!r && r.params?.[0] === 'Deep' && r.params?.[2] === reg.regNo && r.params?.[3] === dept.name, JSON.stringify(r?.params))
      check('registration: tells them the login follows the first payment', !!r?.body.includes('after your first fee payment'))

      // imports never message anyone
      const before = (await tx.select().from(notifications).where(eq(notifications.branchId, b.id))).length
      await createEnquiry(tx, actor, { person: { firstName: 'Old', phone: '9811122205' }, departmentId: dept.id }, { quiet: true })
      await createRegistration(tx, actor, { person: { firstName: 'Older', phone: '9811122206' }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2020-01-01' }, { quiet: true })
      check('imports (quiet) queue nothing', (await tx.select().from(notifications).where(eq(notifications.branchId, b.id))).length === before)

      // delivery: parameters reach the provider; a message that waited too long is dropped
      await tx.execute(sql`update notifications set created_at = now() - interval '3 days' where branch_id = ${b.id} and template = 'enquiry_thanks' and person_id = ${lead.person.id}`)
      const got: { template: string; params: string[] | null | undefined; name: string | null | undefined }[] = []
      const fake: Provider = { name: 'fake', async send(m) { got.push({ template: m.template, params: m.params, name: m.name }); return { ok: true, ref: 'x' } } }
      await dispatchQueued(tx, async (c) => (c === 'whatsapp' ? fake : null), 500)
      const stale = (await rows('enquiry_thanks')).find((n) => n.personId === lead.person.id)
      check('a "thank you" older than 48 hours is not sent', stale?.status === 'skipped' && !got.some((g) => g.template === 'enquiry_thanks' && g.params?.[0] === 'Bina'), stale?.status)
      const sentReg = got.find((g) => g.template === 'registration_confirmed')
      check('the provider gets the parameters and the name', !!sentReg && sentReg.params?.[2] === reg.regNo && sentReg.name === 'Deep')

      // switched off in Settings: nothing is queued for that message
      await setWhatsApp({ enabled: true, provider: 'aisensy', off: ['registration'] })
      const reg2 = await createRegistration(tx, actor, { person: { firstName: 'Esha', phone: '9811122207' }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2026-10-01' })
      check('a message switched off in Settings is not queued', !(await rows('registration_confirmed')).some((n) => n.registrationId === reg2.id))
      await setWhatsApp({ enabled: false, provider: 'aisensy', off: [] })
      await createEnquiry(tx, actor, { person: { firstName: 'Farah', phone: '9811122208' }, departmentId: dept.id })
      check('WhatsApp off: nothing is queued (nothing old goes out when it is switched on)', !(await rows('visit_thanks')).some((n) => n.params?.[0] === 'Farah'))
      check('certificate: an unknown request queues nothing (and its query runs)', (await announceCertificate(tx, '00000000-0000-0000-0000-000000000000', 'https://x.test')) === false)
      check('every event message has a campaign and a template', Object.values(WA_MESSAGES).every((m) => m.campaign && m.template.name && m.template.body.includes('{{1}}')))
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await setWhatsApp(null, saved)
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  process.exitCode = failed ? 1 : 0
}
main()
