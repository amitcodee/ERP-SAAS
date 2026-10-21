// Internship letters for several companies: the companies are there (techcadd the main one), each has its own templates
// (the same name may be used by two companies), an intern is taken on by one company and their letters use its name,
// templates, letterhead and stamp; another company's template is refused; only head office changes companies.
// Everything runs in ONE transaction that is rolled back.
import { eq } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, internships, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { companyArt, createInternship, createTemplate, issueOffer, letterFor, lettersFromRegistrations, listCompanies, listTemplates, saveCompany, saveTemplate, setRegistrationLetters } from '../modules/letters/service'
import { createRegistration } from '../modules/registrations/service'
import { departments } from '../lib/db/schema'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { sql } from 'drizzle-orm'

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
      const [b] = await tx.insert(branches).values({ code: 'LTR', name: 'Letterpur', status: 'active' }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'l', email: 'l@letters.test.invalid', passwordHash: 'x' }).returning()
      const head: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const manager: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }

      await applyTenant(tx, head)
      const companies = await listCompanies(tx)
      const names = companies.map((c) => c.name)
      check('the companies are there, techcadd first', companies[0]?.name === 'techcadd' && companies[0].isDefault && ['Syntax Developer', 'Zabi Technologies', 'Xair Robotics'].every((n) => names.includes(n)), names.join(', '))
      const techcadd = companies[0], syntax = companies.find((c) => c.name === 'Syntax Developer')!

      // templates per company
      const synTpl = await createTemplate(tx, head, 'internship_offer', 'Web Intern', syntax.id)
      await createTemplate(tx, head, 'internship_offer', 'Web Intern', techcadd.id)
      check('two companies may each have a template of the same name', (await listTemplates(tx, 'internship_offer')).filter((t) => t.name === 'Web Intern').length === 2)
      await throws('but not one company twice', () => createTemplate(tx, head, 'internship_offer', 'web intern', syntax.id), /already has a template/)
      await saveTemplate(tx, head, 'internship_offer', synTpl, '# SYNTAX OFFER\n\nDear {{name}}, welcome to {{company_name}} ({{company}}).\n\nRegards,\n\n**{{company_name}}**', 'Web Intern', syntax.id)
      check('a company lists only its own templates (and its Standard)', (await listTemplates(tx, 'internship_offer', syntax.id)).every((t) => t.companyId === syntax.id))

      // the company itself
      await saveCompany(tx, head, syntax.id, { name: 'Syntax Developer', legalName: 'Syntax Developer Pvt. Ltd.', contactPhone: '90000 00001', contactEmail: 'hr@syntax.test', isActive: true })
      await throws('techcadd, the main company, stays on', () => saveCompany(tx, head, techcadd.id, { name: 'techcadd', legalName: techcadd.legalName, contactPhone: null, contactEmail: null, isActive: false }), /stays on/)
      await throws('two companies cannot share a name', () => saveCompany(tx, head, null, { name: 'syntax developer', legalName: '', contactPhone: null, contactEmail: null, isActive: true }), /already exists/)
      await applyTenant(tx, manager)
      await throws('a branch cannot change a company', () => saveCompany(tx, manager, syntax.id, { name: 'X', legalName: '', contactPhone: null, contactEmail: null, isActive: true }), /Forbidden|permission|head office/i)

      // an intern taken on by Syntax Developer
      const base = { name: 'Ira Intern', gender: 'female' as const, designation: 'Web Intern', fromDate: '2026-11-01', toDate: '2027-04-30' }
      await throws('a template of another company is refused', () => createInternship(tx, manager, { ...base, companyId: techcadd.id, offerTemplateId: synTpl }), /chosen company/)
      const intern = await createInternship(tx, manager, { ...base, companyId: syntax.id, offerTemplateId: synTpl })
      check('the intern belongs to the company', intern.companyId === syntax.id)
      const plain = await createInternship(tx, manager, { ...base, name: 'Old Way' })
      check('no company given: techcadd', plain.companyId === techcadd.id)

      const draft = await letterFor(tx, manager, intern.id, 'internship_offer')
      check('the letter is the company\'s template with its names', !!draft && draft.text.includes('# SYNTAX OFFER') && draft.text.includes('welcome to Syntax Developer (Syntax Developer Pvt. Ltd.)'), draft?.text.slice(0, 120))
      check('…on a plain letterhead with the company name, and no stamp (none uploaded)', !!draft && draft.art.letterhead.startsWith('data:image/svg+xml') && decodeURIComponent(draft.art.letterhead).includes('Syntax Developer') && draft.art.stamp === null)
      const own = await letterFor(tx, manager, plain.id, 'internship_offer')
      check('the main company prints on its uploaded letterhead and stamp (the Sample Institute: techcadd’s, as data), and says its name', !!own && own.art.letterhead.startsWith('data:image/jpeg;base64,') && !!own.art.stamp?.startsWith('data:image/png;base64,') && own.text.includes('internship opportunity with techcadd'))
      await issueOffer(tx, manager, intern.id)
      const [issued] = await tx.select({ text: internships.offerText }).from(internships).where(eq(internships.id, intern.id))
      check('issuing freezes the company\'s wording', !!issued.text?.includes('welcome to Syntax Developer'))

      // a registration says which company its letters come from; setting up the intern takes it over
      const [dept] = await tx.select().from(departments).limit(1)
      const reg = await createRegistration(tx, manager, { person: { firstName: 'Reg', lastName: 'Intern', phone: '9811100001' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01', internshipOffer: true, offerTemplateId: synTpl, letterCompanyId: syntax.id }, { quiet: true })
      const waiting = (await lettersFromRegistrations(tx, manager, { branchId: b.id })).find((r) => r.registrationId === reg.id)
      check('a registration’s letters come from its company', waiting?.prefill.companyId === syntax.id, JSON.stringify(waiting?.prefill.companyId))
      await throws('a registration cannot take another company’s template', () => setRegistrationLetters(tx, manager, reg.id, { offer: true, completion: false, offerTemplateId: synTpl, completionTemplateId: null, companyId: techcadd.id }), /chosen company/)
      await setRegistrationLetters(tx, manager, reg.id, { offer: true, completion: false, offerTemplateId: null, completionTemplateId: null, companyId: techcadd.id })
      check('changing it moves the letters to the other company', (await lettersFromRegistrations(tx, manager, { branchId: b.id })).find((r) => r.registrationId === reg.id)?.prefill.companyId === techcadd.id)

      await applyTenant(tx, head)
      check('an uploaded-less company has no stamp; techcadd has its own', (await companyArt(tx, syntax.id)).stamp === null && (await companyArt(tx, techcadd.id)).stamp !== null)
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
