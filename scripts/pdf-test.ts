// Server-generated PDFs from a real receipt / certificate in the DB (rolled back). Run with --conditions react-server.
import { eq, sql } from 'drizzle-orm'
import { PDFDocument, PDFName } from 'pdf-lib'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { certWidth, courseCertOps, type CourseCertInput } from '../lib/cert-course'
import { projectCertOps } from '../lib/cert-project'
import { certificatePdf, receiptPdf } from '../lib/pdf'
import { getReceipt, recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const mm = (pt: number) => Math.round((pt * 25.4) / 72)

async function main() {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [br] = await tx.insert(branches).values({ code: 'PD1', name: 'PDF Branch – Model Town', address: 'SCO 1, Ludhiana' }).returning()
      const [u] = await tx.insert(users).values({ branchId: br.id, name: 'Acct', email: 'pdf@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const [cash] = await tx.select().from(lookups).where(eq(lookups.value, 'Cash'))
      const acct: Actor = { userId: u.id, orgId: ORG, role: 'accountant', branchId: br.id }
      await applyTenant(tx, { ...acct, role: 'counselor' })
      const reg = await createRegistration(tx, { ...acct, role: 'counselor' }, { person: { firstName: 'Pdf', lastName: 'Student', phone: '9899900001' }, departmentId: dept.id, totalFee: 2500000, enrollmentDate: '2026-10-01' })
      await tx.execute(sql`reset role`); await applyTenant(tx, acct)
      const pay = await recordPayment(tx, { ...acct, role: 'counselor' }, { registrationId: reg.id, amount: 1000050, modeId: cash.id, nextInstallmentDate: '2026-11-01', nextInstallmentAmount: 1499950 })
      const view = await getReceipt(tx, acct, pay.receipt.receiptNo)

      const bytes = await receiptPdf(view, 'https://example.test/verify/receipt/x')
      check('receipt PDF is a valid PDF', Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-')
      const doc = await PDFDocument.load(bytes)
      const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()]
      check('receipt is one A5-landscape page', doc.getPageCount() === 1 && mm(w) === 210 && mm(h) === 148, `${mm(w)}x${mm(h)}mm`)
      check('receipt PDF carries its number as the title', doc.getTitle() === `Receipt ${view.receiptNo}`)

      // the course completion design (lib/cert-course.ts): the same layout the certificate page draws
      const course = (o: Partial<CourseCertInput> = {}): CourseCertInput => ({
        name: 'Pdf Student', father: 'Deepak Kumar', gender: 'male', course: 'Internship Certificate in MERN Stack', tools: ['React', 'Node.js', 'Express.js', 'MySQL', 'Tailwind CSS'], toolsLabel: 'Tools',
        duration: '6 months', joined: '2026-01-20', ended: '2026-07-20', mode: 'Offline', regNo: 'TCD/4009/125', branch: 'Techcadd Mohali', certNo: 'CERT-X-1', serial: 'TCD/1/26',
        issuedAt: new Date().toISOString(), verifyUrl: 'https://example.test/verify/abab',
        signers: { authorised: { image: null, title: 'Authorised Signatory (MD)' }, head: { image: null, title: 'Head Department' } }, ...o,
      })
      const words = (ops: ReturnType<typeof courseCertOps>) => ops.map((o) => (o.k === 'text' ? o.s : o.k === 'glyph' ? o.ch : '')).join('')
      const ops = courseCertOps(course())
      check('course certificate: the student, father, course, tools, mode and branch are on it', ['Pdf Student', 'Son of ', 'Mr. Deepak Kumar', '6 Months', 'Internship Certificate in MERN Stack', 'Technologies Used: ', 'React, Node.js', 'Offline / Classroom', 'TCD/4009/125', 'Mohali Branch', 'TCD/1/26', 'CERT-X-1', 'Scan to Verify'].every((w) => words(ops).includes(w)))
      check('the brand is written techcadd / Techcadd, never TechCADD', words(ops).includes('techcadd') && words(ops).includes('A Unit of Techcadd Computer Education') && !/TechCADD|TECHCADD/.test(words(ops)))
      const long = courseCertOps(course({ name: 'Venkata Satya Narayana Murthy Raghavendra Prasad', course: 'Advanced Diploma in Computer Aided Design, Drafting and Building Information Modelling', tools: Array.from({ length: 20 }, (_, i) => `Tool number ${i}`) }))
      check('a long name, course and tool list are shrunk or cut to stay left of the side panel', long.filter((o) => o.k === 'text' && o.y > 85 && o.y < 140 && o.x < 232).every((o) => o.k === 'text' && o.x + certWidth(o.s, o.font, o.size, o.track) <= 232))
      const cert = await certificatePdf({ name: 'Pdf Student', course: 'CSE-IT', branch: br.name, certNo: 'CERT-X-1', issuedAt: new Date().toISOString(), revoked: true, department: 'Computer', joined: '2026-01-05', ended: '2026-06-30', durationWeeks: 24, hours: 240, modules: ['HTML', 'React'], }, 'ab'.repeat(32), 'https://example.test/verify/abab', 'course', ops)
      const cd = await PDFDocument.load(cert)
      check('certificate is one A4-landscape page', cd.getPageCount() === 1 && mm(cd.getPage(0).getWidth()) === 297 && mm(cd.getPage(0).getHeight()) === 210)
      let threw = false
      try { await certificatePdf({ name: 'नाम 名前 ₹', course: '—', branch: 'x', certNo: 'c', issuedAt: new Date().toISOString(), revoked: false, department: 'Computer', joined: '2026-01-05', ended: '2026-06-30', durationWeeks: 24, hours: 240, modules: ['HTML', 'React'], }, '00'.repeat(32), 'u') } catch { threw = true }
      check('characters the PDF fonts cannot draw never crash generation', !threw)

      // ₹ and Punjabi / Hindi names: drawn in the Unicode fonts, shaped (conjuncts, vowel signs), never "Rs." or "?"
      const fontsOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).context.enumerateIndirectObjects()
        .map(([, o]) => String((o as { get?: (k: unknown) => unknown }).get?.(PDFName.of('BaseFont')) ?? '')).filter(Boolean).join(' ')
      const indian = await receiptPdf({ ...view, studentName: 'ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ', course: 'वेब डिज़ाइन', receivedBy: 'प्रियंका शर्मा' }, 'https://example.test/verify/receipt/x')
      const f = await fontsOf(indian)
      check('a receipt with Punjabi and Hindi names embeds the Gurmukhi and Devanagari fonts', /NotoSansGurmukhi/.test(f) && /NotoSansDevanagari/.test(f), f)
      check('... and the Latin font for ₹ (no built-in Helvetica)', /NotoSans-(Regular|Bold)/.test(f) && !/Helvetica/.test(f), f)
      const cf = await fontsOf(cert)
      check('the course certificate PDF is drawn in Poppins and stays small (under 400 KB)', /Poppins-Bold/.test(cf) && /Poppins-Light/.test(cf) && cert.length < 400_000, `${cert.length} bytes`)
      check('a Punjabi name on the course certificate is drawn in the Gurmukhi font', /NotoSansGurmukhi/.test(await fontsOf(await certificatePdf({ name: 'ਹਰਪ੍ਰੀਤ ਕੌਰ', course: 'x', branch: 'x', certNo: 'c3', issuedAt: new Date().toISOString(), revoked: false, department: 'Computer', joined: '2026-01-05', ended: null, durationWeeks: null, hours: null, modules: [] }, '00'.repeat(32), 'u', 'course', courseCertOps(course({ name: 'ਹਰਪ੍ਰੀਤ ਕੌਰ' }))))))
      check('the fonts keep a receipt small (under 120 KB)', bytes.length < 120_000 && indian.length < 120_000, `${bytes.length} / ${indian.length} bytes`)
      const projectPdf = await certificatePdf({ name: 'ਹਰਪ੍ਰੀਤ ਕੌਰ', course: 'Web Design', branch: 'x', certNo: 'c2', issuedAt: new Date().toISOString(), revoked: false, department: 'Computer', joined: '2026-01-05', ended: null, durationWeeks: null, hours: null, modules: [] }, '00'.repeat(32), 'u', 'project',
        projectCertOps({ name: 'ਹਰਪ੍ਰੀਤ ਕੌਰ', father: null, gender: 'female', project: 'Student Management System', tools: ['React', 'MySQL'], joined: '2026-01-05', ended: null, issuedAt: new Date().toISOString(), regNo: 'R-1', branch: 'Techcadd Mohali', head: { image: null, title: 'Head Department' } }))
      check('a project certificate with a name in Punjabi is generated, in the Gurmukhi font', (await PDFDocument.load(projectPdf)).getPageCount() === 1 && /NotoSansGurmukhi/.test(await fontsOf(projectPdf)))
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
