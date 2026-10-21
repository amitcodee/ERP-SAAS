// Seminars & workshops and certificate designs, against the real DB in ONE rolled-back transaction: a design is saved
// from a template, an event with a quiz is made, people sign up on the public side (pass, fail, the same e-mail twice,
// after closing), certificates are issued only as the event says, and the certificate draws into a PDF. Branches see
// only their own; the public side never gets the answers.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { designOps } from '../lib/cert-design-ops'
import { PRESETS, SAMPLE_VALUES, presetDesign } from '../lib/cert-design'
import { branches, eventParticipants, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { layoutPdf } from '../lib/pdf'
import {
  createEvent, eventCertificateIn, quizTicket, getEvent, issueParticipantCertificate, joinEventIn, listDesigns, listEvents, publicEventIn, saveDesign, setEventOpen, updateEvent, type EventInput,
} from '../modules/events/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '') + ' ' + JSON.stringify((e as { issues?: unknown }).issues ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 120).replace(/\s+/g, ' ') : '')
  }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }
/** The server's own connection, as the public page uses it. */
const asSystem = async (tx: Tx) => { await tx.execute(sql`reset role`); await tx.execute(sql`set local role techcadd_app`); await tx.execute(sql`select set_config('app.is_super', 'true', true), set_config('app.role', 'system', true), set_config('app.branch_id', '', true)`) }

async function main() {
  // every template draws, with the sample details, into the layout and a PDF
  for (const p of PRESETS) {
    const ops = designOps(p.make(), SAMPLE_VALUES, 'https://example.test/e/c/x', { name: 'Acme', logo: null })
    const pdf = await layoutPdf('t', ops, p.make().page === 'portrait')
    check(`template "${p.name}" lays out and makes a PDF`, ops.length > 5 && pdf.length > 5000 && !ops.some((o) => o.k === 'text' && /\{\{/.test(o.s)))
  }
  // a long name is shrunk to its box, never past it
  const hex = presetDesign('hexagon')
  const nameEl = hex.els.find((e) => e.t === 'text' && e.text === '{{name}}')!
  const long = designOps(hex, { ...SAMPLE_VALUES, name: 'Gurpreet Singh Sandhu Dhillon Randhawa Bajwa Grewal' }, 'q', { name: 'Acme', logo: null }).find((o) => o.k === 'text' && o.s.startsWith('Gurpreet'))
  check('a long name gets smaller to fit its box', !!long && long.k === 'text' && long.size < (nameEl as { size: number }).size && long.x >= nameEl.x - 0.01)

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [b1] = await tx.insert(branches).values({ code: 'EV1', name: 'Techcadd Events One' }).returning()
      const [b2] = await tx.insert(branches).values({ code: 'EV2', name: 'Techcadd Events Two' }).returning()
      const mk = async (name: string, branchId: string) => (await tx.insert(users).values({ branchId, name, email: `${name}@ev.test.invalid`, passwordHash: 'x' }).returning())[0]
      const [u1, u2, u3, u4] = [await mk('m1', b1.id), await mk('m2', b2.id), await mk('t1', b1.id), await mk('a1', b1.id)]
      const mgr1: Actor = { userId: u1.id, orgId: ORG, role: 'branch_manager', branchId: b1.id }
      const mgr2: Actor = { userId: u2.id, orgId: ORG, role: 'branch_manager', branchId: b2.id }
      const trainer: Actor = { userId: u3.id, orgId: ORG, role: 'trainer', branchId: b1.id }
      const academic: Actor = { userId: u4.id, orgId: ORG, role: 'academic_manager', branchId: b1.id }

      // ---- designs ----
      await as(tx, mgr1)
      const designId = await saveDesign(tx, mgr1, null, { name: 'Hexagon', design: presetDesign('hexagon') })
      await throws(tx, 'a picture must be PNG / JPEG (data: URL or a panel file)', () => saveDesign(tx, mgr1, null, { name: 'Bad', design: { page: 'landscape', bg: '#ffffff', els: [{ id: 'a', t: 'image', x: 0, y: 0, w: 10, h: 10, src: 'https://evil.test/x.png' }] } }), /PNG or JPEG/)
      await throws(tx, 'a trainer cannot design certificates', () => saveDesign(tx, trainer, null, { name: 'T', design: presetDesign('minimal') }), /Forbidden/)
      await as(tx, academic)
      await throws(tx, 'the academic manager sees designs but cannot make them', () => saveDesign(tx, academic, null, { name: 'A', design: presetDesign('minimal') }), /Forbidden/)
      await as(tx, mgr2)
      check('another branch does not see the design', !(await listDesigns(tx, mgr2)).some((d) => d.id === designId))
      await throws(tx, 'another branch cannot change it', () => saveDesign(tx, mgr2, designId, { name: 'Mine now', design: presetDesign('minimal') }), /no longer exists/)

      // ---- an event with a quiz ----
      await as(tx, mgr1)
      const quiz = [{ q: '2 + 2?', options: ['3', '4', '5'], answer: 1 }, { q: 'Capital of Punjab?', options: ['Chandigarh', 'Amritsar'], answer: 0 }]
      const base: EventInput = {
        kind: 'workshop', title: 'Generative AI Workshop', startsAt: '2026-10-20T10:00:00+05:30', mode: 'offline', venue: 'Hall 2', speaker: 'Er. Rohit',
        askMobile: true, askOrg: true, hasQuiz: true, quiz, passPercent: 60, quizMinutes: 10, certificate: true, certFor: 'passed', designId,
      }
      await throws(tx, 'a quiz needs questions', () => createEvent(tx, mgr1, { ...base, quiz: [] }), /at least one question/)
      await throws(tx, 'the right option must exist', () => createEvent(tx, mgr1, { ...base, quiz: [{ q: 'Q?', options: ['a', 'b'], answer: 3 }] }), /right option/)
      await throws(tx, 'a certificate needs a design', () => createEvent(tx, mgr1, { ...base, designId: null }), /design/)
      await throws(tx, 'a trainer cannot create events', () => createEvent(tx, trainer, base), /Forbidden/)
      const eventId = await createEvent(tx, mgr1, base)
      const ev = (await getEvent(tx, mgr1, eventId))!.event
      check('the event is made with its link code and quiz', /^[\w-]{11}$/.test(ev.token) && ev.questions === 2 && ev.isOpen)
      await as(tx, mgr2)
      check('another branch does not see the event', !(await listEvents(tx, mgr2)).some((e) => e.id === eventId) && !(await getEvent(tx, mgr2, eventId)))

      // ---- the public page ----
      await asSystem(tx)
      const pub = (await publicEventIn(tx, ev.token))!
      check('the public page has the questions but never the answers', pub.quiz.length === 2 && !JSON.stringify(pub).includes('"answer"') && pub.open && pub.certificate)
      check('an unknown link is nothing', (await publicEventIn(tx, 'nope-nope-nope')) === null)
      const t = quizTicket(ev.token)
      await throws(tx, 'a timed quiz needs the start ticket', () => joinEventIn(tx, ev.token, { name: 'No Ticket', email: 'nt@example.com', mobile: '9876543215', answers: [1, 0] }, null), /Start the quiz/)
      await throws(tx, 'answers after the time limit are refused', () => joinEventIn(tx, ev.token, { name: 'Too Late', email: 'late2@example.com', mobile: '9876543216', answers: [1, 0], ticket: quizTicket(ev.token, Date.now() - 12 * 60_000) }, null), /Time is up/)
      await throws(tx, 'a forged ticket is refused', () => joinEventIn(tx, ev.token, { name: 'Forger', email: 'f@example.com', mobile: '9876543217', answers: [1, 0], ticket: `${Date.now()}.${'A'.repeat(43)}` }, null), /Start the quiz/)
      await throws(tx, 'a name with a link is refused (no phishing through the certificate mail)', () => joinEventIn(tx, ev.token, { name: 'Claim prize at https://evil.example', email: 'v@example.com', mobile: '9876543218', answers: [1, 0], ticket: t }, null), /letters only/)
      const pass = await joinEventIn(tx, ev.token, { name: 'Aman Gill', email: 'Aman@Example.com', mobile: '9876543210', organisation: 'DAV College', answers: [1, 0], ticket: t }, '1.2.3.4')
      check('all right: passed, certificate issued', pass.score === 2 && pass.total === 2 && pass.passed === true && /^EV-\d{2}-\d{6}$/.test(pass.certNo ?? '') && pass.mail)
      const fail = await joinEventIn(tx, ev.token, { name: 'Ravi Kumar', email: 'ravi@example.com', mobile: '9876543211', answers: [0, 1], ticket: t }, null)
      check('all wrong: not passed, no certificate (pass only)', fail.score === 0 && fail.passed === false && !fail.certNo && !fail.mail)
      const again = await joinEventIn(tx, ev.token, { name: 'Aman Again', email: 'aman@example.com', mobile: '9876543210', answers: [0, 0], ticket: t }, null)
      check('the same e-mail again: one try, and nothing of the first one comes back', again.already && !again.hash && !again.certNo && again.score === null && again.passed === null && !again.mail)
      await throws(tx, 'the mobile is needed when the event asks', () => joinEventIn(tx, ev.token, { name: 'No Phone', email: 'np@example.com', answers: [1, 0], ticket: t }, null), /mobile/)
      await throws(tx, 'a name with markup is refused', () => joinEventIn(tx, ev.token, { name: '<b>x</b>', email: 'x@example.com', mobile: '9876543212', answers: [] }, null), /printed/)

      // ---- the certificate ----
      const cert = (await eventCertificateIn(tx, pass.hash))!
      check('the certificate is filled with the participant', cert.values.name === 'Aman Gill' && cert.values.score === '2 / 2' && cert.values.percent === '100%' && cert.values.kind === 'Workshop' && cert.values.organisation === 'DAV College')
      const ops = designOps(cert.design, cert.values, `https://example.test/e/c/${pass.hash}`, { name: 'Acme', logo: null })
      check('it prints the name and the QR code of its own page', ops.some((o) => o.k === 'text' && o.s === 'Aman Gill') && ops.some((o) => o.k === 'qr' && o.text.endsWith(pass.hash)))
      check('no certificate page for one who did not pass', (await eventCertificateIn(tx, fail.hash)) === null && (await eventCertificateIn(tx, 'zz')) === null)

      // ---- own work only: a second-branch helper sees only the events they made ----
      const helper: Actor = { userId: u3.id, orgId: ORG, role: 'academic_manager', branchId: b1.id, ownOnly: true }
      await as(tx, helper)
      check('"own work only" staff do not see others’ events or participants', !(await listEvents(tx, helper)).some((e) => e.id === eventId)
        && !(await tx.execute(sql`select 1 from event_participants where event_id = ${eventId}`)).rows.length)

      // ---- staff: change, close, issue ----
      await as(tx, mgr1)
      await throws(tx, 'the quiz cannot change once people answered', () => updateEvent(tx, mgr1, eventId, { ...base, quiz: [quiz[0]] }), /can no longer change/)
      await updateEvent(tx, mgr1, eventId, { ...base, certFor: 'all', title: 'Generative AI Workshop (Day 1)' })
      await issueParticipantCertificate(tx, mgr1, fail.participantId)
      const [rf] = await tx.select().from(eventParticipants).where(sql`${eventParticipants.id} = ${fail.participantId}`)
      check('switched to "everyone": the one who failed can be issued one', !!rf.certNo)
      await setEventOpen(tx, mgr1, eventId, false)
      await asSystem(tx)
      check('closed: the public page says so', (await publicEventIn(tx, ev.token))!.open === false)
      await throws(tx, 'closed: a past participant’s e-mail learns nothing either', () => joinEventIn(tx, ev.token, { name: 'Aman Gill', email: 'aman@example.com', mobile: '9876543210', answers: [1, 0], ticket: t }, null), /closed/)
      await throws(tx, 'closed: nobody new can sign up', () => joinEventIn(tx, ev.token, { name: 'Late Comer', email: 'late@example.com', mobile: '9876543213', answers: [1, 0], ticket: t }, null), /closed/)
      await as(tx, mgr1)
      const listed = (await listEvents(tx, mgr1)).find((e) => e.id === eventId)!
      check('the list counts sign-ups, passes and certificates', listed.joined === 2 && listed.passed === 1 && listed.certified === 2 && !listed.isOpen)

      // an event with no quiz: everyone gets the certificate at once
      const seminar = await createEvent(tx, mgr1, { ...base, kind: 'seminar', title: 'Career Seminar', hasQuiz: false, quiz: [], askMobile: false })
      const seminarToken = (await getEvent(tx, mgr1, seminar))!.event.token
      await asSystem(tx)
      const s = await joinEventIn(tx, seminarToken, { name: 'Simran', email: 'simran@example.com', answers: [] }, null)
      check('no quiz: signed up and certified at once', !!s.certNo && s.score === null && s.passed === null)
      throw new Rollback()
    })
  } catch (e) { if (!(e instanceof Rollback)) { console.error(e); failed++ } }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back)')
  process.exitCode = failed ? 1 : 0
}
main()
