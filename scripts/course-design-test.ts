// Course certificates in the institute's own design (modules/certificates/course-design.ts): the fields a design prints,
// the signatures standing in for SIGN_* images, the chosen design used and the built-in layout when none is chosen
// (or the chosen one was archived). Works on the Sample Institute and puts its setting back as it found it.
import { sql } from 'drizzle-orm'
import { pool } from '../lib/db/client'
import { courseCertOps, type CourseCertInput } from '../lib/cert-course'
import { presetDesign, SIGN_AUTHORISED, SIGN_HEAD } from '../lib/cert-design'
import { designOps } from '../lib/cert-design-ops'
import { getConfig, saveConfig } from '../lib/config/store'
import { withOrgSystem } from '../lib/db/withTenant'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { courseCertificateOps, courseDesignValues } from '../modules/certificates/course-design'
import { designInput } from '../modules/events/service'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const SIG_A = 'data:image/png;base64,QUFB', SIG_H = 'data:image/png;base64,QkJC'
const input: CourseCertInput = {
  name: 'Simran Kaur', father: 'Harpreet Singh', gender: 'female', course: 'Diploma in Web Development', tools: ['HTML', 'CSS', 'React'], toolsLabel: 'Modules',
  duration: '6 months', joined: '2026-04-01', ended: '2026-09-30', mode: 'Regular', regNo: 'REG-2026-MAIN-0042', branch: 'Main branch',
  certNo: 'CERT-MAIN-2026-0007', serial: '7', issuedAt: '2026-10-05T10:00:00Z', verifyUrl: 'https://acme.example.com/verify/abc',
  signers: { authorised: { image: SIG_A, title: 'Director' }, head: { image: SIG_H, title: 'Head, Computer Science' } },
  brand: { name: 'Acme Academy', legalName: 'Acme Academy Pvt Ltd', tagline: '', color: '#10186a', logo: null, accreditations: null },
}
const texts = (ops: ReturnType<typeof courseCertOps>) => ops.filter((o) => o.k === 'text').map((o) => (o as { s: string }).s).join(' | ')

async function main() {
  const v = courseDesignValues(input)
  check('the fields a design prints come from the certificate', v.name === 'Simran Kaur' && v.course === 'Diploma in Web Development' && v.reg_no === 'REG-2026-MAIN-0042' && v.father === 'Harpreet Singh' && v.tools === 'HTML, CSS, React' && v.cert_no === 'CERT-MAIN-2026-0007' && v.joined === '1 Apr 2026' && v.ended === '30 Sep 2026' && v.authorised_title === 'Director', JSON.stringify(v))

  const course = presetDesign('course')
  const ops = designOps(course, v, input.verifyUrl, input.brand, { [SIGN_AUTHORISED]: SIG_A, [SIGN_HEAD]: SIG_H })
  const t = texts(ops)
  check('the "Course completion" design prints the student, course, dates and number', /Simran Kaur/.test(t) && /Diploma in Web Development/.test(t) && /1 Apr 2026/.test(t) && /CERT-MAIN-2026-0007/.test(t) && !/\{\{/.test(t), t.slice(0, 200))
  const imgs = ops.filter((o) => o.k === 'img').map((o) => (o as { src: string }).src)
  check('… with both signatures where the design placed them, and the QR code', imgs.includes(SIG_A) && imgs.includes(SIG_H) && ops.some((o) => o.k === 'qr'))
  const noSig = designOps(course, v, input.verifyUrl, input.brand, {})
  check('a signature not set is left out, not drawn broken', !noSig.some((o) => o.k === 'img' && String((o as { src: string }).src).startsWith('sign:')))
  const noFather = texts(designOps(course, { ...v, father: '' }, input.verifyUrl, input.brand))
  check('a missing detail drops its words ("son / daughter of" without a father)', !/daughter of/.test(noFather) && /registration no\. REG-2026/.test(noFather), noFather.slice(0, 160))
  check('a design may place the signatures (they pass the save check)', designInput.safeParse({ name: 'Course', design: course }).success)

  // ---- choosing the design ----
  const before = (await getConfig(ORG, 'course_certificate')).config
  const [owner] = await withOrgSystem(ORG, async (tx) => (await tx.execute<{ id: string }>(sql`select owner_user_id as id from organisations where id = app_org()`)).rows)
  let designId = ''
  try {
    await saveConfig(ORG, 'course_certificate', { designId: null }, {}, owner.id)
    const builtIn = await courseCertificateOps(ORG, input)
    check('no design chosen: the built-in layout', JSON.stringify(builtIn.ops) === JSON.stringify(courseCertOps(input)) && !builtIn.portrait)
    ;[{ id: designId }] = await withOrgSystem(ORG, async (tx) => (await tx.execute<{ id: string }>(sql`
      insert into certificate_designs (name, design) values ('Course test design', ${JSON.stringify(course)}::jsonb) returning id`)).rows)
    await saveConfig(ORG, 'course_certificate', { designId }, {}, owner.id)
    const mine = await courseCertificateOps(ORG, input)
    check('a design chosen: the certificate is drawn with it', texts(mine.ops) === texts(ops) && mine.ops.some((o) => o.k === 'img' && (o as { src: string }).src === SIG_A))
    await withOrgSystem(ORG, (tx) => tx.execute(sql`update certificate_designs set is_active = false where id = ${designId}`))
    const back = await courseCertificateOps(ORG, input)
    check('the chosen design archived: back to the built-in layout, never a blank certificate', JSON.stringify(back.ops) === JSON.stringify(courseCertOps(input)))
  } catch (e) {
    console.error(e); failed++
  } finally {
    await saveConfig(ORG, 'course_certificate', before, {}, owner.id)
    if (designId) await withOrgSystem(ORG, (tx) => tx.execute(sql`update certificate_designs set is_active = false where id = ${designId}`))
  }
  const { redis } = await import('../lib/redis'); redis.disconnect()
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main()
