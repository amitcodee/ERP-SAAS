// Message templates against the real DB in ONE rolled-back transaction: built-in -> head office default -> branch's
// own; reset; ready-made announcements; the birthday e-mail and today's birthdays use them.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { emailHtml, mailButton } from '../lib/notify/layout'
import { queueBirthdayWishes, todaysBirthdays } from '../modules/notifications/birthday'
import { createRegistration } from '../modules/registrations/service'
import { announcementTemplates, fillTemplate, resetTemplate, resolveTemplate, saveAnnouncementTemplate, saveTemplate, templatesForEditor, TEMPLATES } from '../modules/templates/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) { await tx.execute(sql`rollback to savepoint sp`); const msg = String(e); check(name, !match || match.test(msg), match ? msg.slice(0, 100) : '') }
}

async function main() {
  check('placeholders are filled, unknown ones kept', fillTemplate('Hi {{first_name}}, {{ age }} {{nope}}', { first_name: 'Asha', age: 21 }) === 'Hi Asha, 21 {{nope}}')
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'TPL', name: 'Template Branch', status: 'active' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'm', email: 'm@templates.test.invalid', passwordHash: 'x' }).returning()
      const sup: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: a.id }
      const counselor: Actor = { ...mgr, role: 'counselor' }
      await tx.execute(sql`delete from message_templates where key = 'birthday_email'`) // a clean start inside the rolled-back test

      await applyTenant(tx, sup)
      check('built-in words while nothing is saved', (await resolveTemplate(tx, 'birthday_email', a.id)).subject === TEMPLATES.birthday_email.subject)
      await saveTemplate(tx, sup, { key: 'birthday_email', subject: 'HO: Happy birthday {{first_name}}', body: 'Head office wishes {{first_name}} from {{branch}}' })
      check('head office default applies to the branch', (await resolveTemplate(tx, 'birthday_email', a.id)).subject.startsWith('HO:'))

      await applyTenant(tx, mgr)
      await throws(tx, 'a counselor cannot edit templates', () => saveTemplate(tx, counselor, { key: 'birthday_email', subject: 'x x', body: 'x x x x x' }), /head office or a branch manager/)
      await saveTemplate(tx, mgr, { key: 'birthday_email', subject: 'Branch: Happy birthday {{first_name}}!', body: 'From all of us at {{branch}}, {{first_name}}, you are {{age}}!' })
      const ed = await templatesForEditor(tx, mgr)
      const be = ed.templates.find((t) => t.key === 'birthday_email')!
      check('the branch’s own version wins, and it falls back to head office’s', be.source === 'branch' && be.subject.startsWith('Branch:') && be.fallback.subject.startsWith('HO:'))

      // the birthday e-mail uses the branch's words
      const r = await createRegistration(tx, counselor, { person: { firstName: 'Bday', phone: '9833300001' }, departmentId: (await tx.select().from(departments).limit(1))[0].id, totalFee: 1000, enrollmentDate: '2026-07-01' })
      await tx.execute(sql`update persons set email = 'bday@templates.test.invalid', dob = '2006-05-20' where id = ${r.personId}`)
      check('today’s birthdays list the student for the staff pop-up', (await todaysBirthdays(tx, '2030-05-20')).some((p) => p.regNo === r.regNo && p.age === 24))
      await tx.execute(sql`select set_config('app.is_super', 'true', true)`)
      await queueBirthdayWishes(tx, '2030-05-20')
      const [n] = (await tx.execute<{ subject: string; body: string }>(sql`select subject, body from notifications where dedupe_key = 'bday:bday@templates.test.invalid:2030'`)).rows
      check('the birthday e-mail is written from the branch template', n?.subject === 'Branch: Happy birthday Bday!' && n.body.includes('Template Branch') && n.body.includes('you are 24'), JSON.stringify(n))

      await applyTenant(tx, mgr)
      await resetTemplate(tx, mgr, 'birthday_email')
      check('reset: the branch goes back to head office’s default', (await resolveTemplate(tx, 'birthday_email', a.id)).subject.startsWith('HO:'))

      // ready-made announcements
      const before = await announcementTemplates(tx, a.id)
      await saveAnnouncementTemplate(tx, mgr, { title: 'Branch picnic', body: 'Picnic on [date]!' })
      const after = await announcementTemplates(tx, a.id)
      check('a branch adds its own ready-made announcement next to head office’s', after.length === before.length + 1 && after.some((t) => t.title === 'Branch picnic' && t.branchWide))
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  }
  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed (rolled back, DB untouched)')
  // e-mail buttons: only the panel's own mailButton() makes one; typed text (a student's help request) cannot
  const typed = 'see [[Open Project Help|https://evil.example/login]] and \uE000Fake\uE001https://evil.example\uE002'
  const mail = emailHtml({ subject: 's', body: fillTemplate('{{details}}\n\n{{link}}', { details: typed, link: mailButton('Open Project Help', 'https://panel.example/p') }) }, false)
  check('a button typed into a filled value stays plain text', (mail.match(/display:inline-block/g) ?? []).length === 1 && !/href="https:\/\/evil[^"]*"[^>]*display:inline-block/.test(mail))
  check("the panel's own button is drawn", mail.includes('href="https://panel.example/p"'))
  process.exitCode = failed ? 1 : 0
}
main()
