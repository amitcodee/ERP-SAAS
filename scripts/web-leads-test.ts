// Website leads: arrival, matching to a branch (website, place, head office), duplicates, who sees what. One rolled-back transaction.
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, enquiries, enquiryEvents, lookups, userRoles, users, webLeads } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { createBranch, updateBranch, type CreateBranchInput } from '../modules/branches/service'
import { isMobile } from '../modules/people/phone'
import { assignWebLead, ingestWebLead, listWebLeads, siteHostOf } from '../modules/web-leads/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e)
    check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '')
  }
}
const stamp = Date.now()
const s = String(stamp).slice(-6)
const branch = (city: string, o: Partial<CreateBranchInput> = {}): CreateBranchInput => ({
  name: `Techcadd ${city}`, city, address: 'SCO 1, Main Road', state: 'Punjab', pincode: '140603', phone: '9876543210', email: `${city.toLowerCase()}.${stamp}@weblead.test.invalid`, ...o,
})

async function main() {
  check('only real mobile numbers count', isMobile('+91 98765 43210') && isMobile('098765 43210') && !isMobile('0000000000') && !isMobile('1234567890') && !isMobile('9999999999') && !isMobile('98765 43210 / 97654 32109') && !isMobile(null))
  check('site address: protocol, www., path and case do not matter', siteHostOf('https://WWW.TechcaddLudhiana.com/contact?x=1') === 'techcaddludhiana.com' && siteHostOf('techcaddludhiana.com') === 'techcaddludhiana.com' && siteHostOf('not a site') === null && siteHostOf('') === null)

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [u] = await tx.insert(users).values({ name: 'Sup', email: `wl${stamp}@test.invalid`, passwordHash: 'x' }).returning()
      await tx.insert(userRoles).values({ userId: u.id, orgId: ORG, role: 'super_admin' })
      const sup: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      await applyTenant(tx, sup)

      // Two places: Zirakpur has its website set, Kharar has none (its leads are found by place).
      const city1 = `Zirak${s}`, city2 = `Khara${s}`
      const site1 = `techcadd${city1.toLowerCase()}.example`
      const { branch: a } = await createBranch(tx, sup, branch(city1, { websiteUrl: `https://www.${site1}/` }))
      const { branch: b } = await createBranch(tx, sup, branch(city2))
      check('a branch keeps its website and the host leads are matched on', a.websiteUrl === `https://www.${site1}/` && a.websiteHost === site1)
      await throws(tx, 'one website belongs to one branch', () => createBranch(tx, sup, branch(`Other${s}`, { websiteUrl: site1 })), /already set on/)
      await throws(tx, 'a branch website must be a web address', () => createBranch(tx, sup, branch(`Bad${s}`, { websiteUrl: 'not a site' })), /website address/)

      // ---- by website ----
      const r1 = await ingestWebLead(tx, { site: `https://${site1}`, sourceUrl: `https://${site1}/courses/autocad`, externalId: '101', name: 'Asha Rani', phone: '+91 98111 0' + s.slice(0, 4), email: 'Asha@Example.com', course: 'AutoCAD', location: 'Zirakpur', message: 'Call me after 5' })
      check('a lead from a branch website becomes a Lead of that branch', r1.status === 'placed' && r1.branchId === a.id && r1.matchedBy === 'website', JSON.stringify(r1))
      const [w1] = await tx.select().from(webLeads).where(eq(webLeads.id, r1.id!))
      const [e1] = await tx.select().from(enquiries).where(eq(enquiries.id, w1.enquiryId!))
      const [website] = await tx.select().from(lookups).where(and(eq(lookups.kind, 'enquiry_source'), eq(lookups.value, 'Website')))
      check('it is a lead (not visited), source Website, with the page it came from', e1.branchId === a.id && !e1.visited && e1.sourceId === website.id && e1.sourceUrl === `https://${site1}/courses/autocad` && e1.status === 'new')
      const ev = await tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, e1.id))
      check('the form (course, message, page) is in its history', ev.length === 1 && /Course: AutoCAD/.test(ev[0].note ?? '') && /Call me after 5/.test(ev[0].note ?? ''))
      check('nobody is credited with creating it, and it is not assigned yet', e1.createdBy === null && e1.assignedTo === null)

      const again = await ingestWebLead(tx, { site: site1, externalId: '101', name: 'Asha Rani', phone: '9811100000' })
      check('the same lead sent twice is kept once', again.status === 'duplicate')
      const same = await ingestWebLead(tx, { site: site1, externalId: '102', name: 'Asha', phone: '98111 0' + s.slice(0, 4), message: 'Second form' })
      const count = (await tx.select().from(enquiries).where(eq(enquiries.personId, e1.personId))).length
      check('the same phone again adds to the existing lead (no second lead)', same.status === 'added_to_existing' && count === 1)

      const junk = await ingestWebLead(tx, { site: site1, externalId: '104', name: 'Junk', phone: '1234567890' })
      check('a made-up number is not made a lead', junk.status === 'invalid_phone')
      const evil = await ingestWebLead(tx, { site: site1, externalId: '105', name: 'Link', phone: '91234' + s.slice(0, 5), sourceUrl: 'javascript:alert(1)' })
      const [we] = await tx.select().from(webLeads).where(eq(webLeads.id, evil.id!))
      check('a page link that is not a web address is not kept', we.sourceUrl === null)
      const bad = await ingestWebLead(tx, { site: site1, externalId: '103', name: 'No Phone', email: 'x@example.com' })
      const [wb] = await tx.select().from(webLeads).where(eq(webLeads.id, bad.id!))
      check('no valid phone: kept for the branch with the reason, not made a lead', bad.status === 'invalid_phone' && wb.branchId === a.id && !wb.enquiryId && !!wb.problem)

      // ---- by place ----
      const r2 = await ingestWebLead(tx, { site: `techcadd${city2.toLowerCase()}.example`, externalId: '1', name: 'Ravi Kumar', phone: '97000' + s.slice(0, 5) })
      check('a site named after one branch city goes to that branch', r2.status === 'placed' && r2.branchId === b.id && r2.matchedBy === 'location', JSON.stringify(r2))

      // Whole words only: a branch city that is part of another place's name does not match.
      const { branch: z } = await createBranch(tx, sup, branch(`Zi${s}`))
      const part = await ingestWebLead(tx, { site: 'some-other-site.example', externalId: 'p1', name: 'Part', phone: '94000' + s.slice(0, 5), location: `Zi${s}pur Road` })
      const whole = await ingestWebLead(tx, { site: 'some-other-site.example', externalId: 'p2', name: 'Whole', phone: '93000' + s.slice(0, 5), location: `Main Bazaar, Zi${s}` })
      check('a city inside a longer place name is not matched; the whole word is', part.status === 'waiting' && whole.status === 'placed' && whole.branchId === z.id, `${part.status} ${whole.status}`)

      // ---- waiting, then sent on by head office ----
      const r3 = await ingestWebLead(tx, { site: 'https://unknown-site.example', externalId: 'x1', name: 'Meena', phone: '96000' + s.slice(0, 5), location: 'Mumbai' })
      check('a site no branch has, from a place no branch is in, waits for head office', r3.status === 'waiting')

      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id, perms: ['weblead:read', 'enquiry:read'] }
      await applyTenant(tx, mgr)
      const mine = await listWebLeads(tx, mgr)
      check('a branch sees only its own website leads', mine.rows.length > 0 && mine.rows.every((r) => r.branchId === a.id) && !mine.rows.some((r) => r.siteHost === 'unknown-site.example'), `${mine.rows.length}`)
      await throws(tx, 'a branch cannot send website leads to a branch', () => assignWebLead(tx, mgr, { id: r3.id!, branchId: a.id }), /Forbidden: assign weblead/)
      await applyTenant(tx, sup)

      const all = await listWebLeads(tx, sup, { state: 'waiting' })
      check('head office sees the waiting ones, by website', all.rows.some((r) => r.id === r3.id) && all.sites.some((x) => x.host === 'unknown-site.example' && x.waiting >= 1 && !x.branchName))
      const placed = await assignWebLead(tx, sup, { id: r3.id!, branchId: b.id })
      const [w3] = await tx.select().from(webLeads).where(eq(webLeads.id, r3.id!))
      check('head office sends it to a branch: it becomes a Lead there', placed.placed && !placed.existing && !placed.problem && w3.branchId === b.id && w3.matchedBy === 'manual' && w3.placedBy === u.id)
      await throws(tx, 'a lead already in a branch is not sent again', () => assignWebLead(tx, sup, { id: r3.id!, branchId: a.id }), /already a lead/)
      const nomob = await ingestWebLead(tx, { site: 'unknown-site.example', externalId: 'x2', name: 'Nomob', email: 'n@example.com' })
      await throws(tx, 'a waiting lead with no mobile cannot be sent (it stays waiting, clearly)', () => assignWebLead(tx, sup, { id: nomob.id!, branchId: b.id }), /no valid mobile/)

      // ---- a website set later collects what it sent before ----
      const r4 = await ingestWebLead(tx, { site: 'later-site.example', externalId: 'l1', name: 'Kiran', phone: '95000' + s.slice(0, 5) })
      check('before: waiting', r4.status === 'waiting')
      const [bb] = await tx.select().from(branches).where(eq(branches.id, b.id))
      await updateBranch(tx, sup, { id: b.id, name: bb.name, address: bb.address!, state: bb.state!, pincode: bb.pincode!, phone: bb.phone!, email: bb.email!, certCode: bb.certCode, websiteUrl: 'later-site.example' })
      const [w4] = await tx.select().from(webLeads).where(eq(webLeads.id, r4.id!))
      check('setting the website on a branch places its waiting leads there', w4.branchId === b.id && !!w4.enquiryId && w4.matchedBy === 'website')
      await updateBranch(tx, sup, { id: b.id, name: bb.name, address: bb.address!, state: bb.state!, pincode: bb.pincode!, phone: bb.phone!, email: bb.email!, certCode: bb.certCode })
      const [bk] = await tx.select().from(branches).where(eq(branches.id, b.id))
      check('saving a branch without the website field keeps the website', bk.websiteHost === 'later-site.example')

      await throws(tx, 'a lead without a name is refused', () => ingestWebLead(tx, { site: site1, name: ' ', phone: '9811111111' }), /name/)
      await throws(tx, 'a lead without its website is refused', () => ingestWebLead(tx, { name: 'X', phone: '9811111111' }), /site/)
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
