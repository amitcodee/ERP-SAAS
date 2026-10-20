// Birthday wishes: the date rules (29 February, India dates), and the e-mail queue against the real DB in ONE
// rolled-back transaction — once per e-mail per year, active students only.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { ageOn, birthdayHtml, isBirthday, queueBirthdayWishes } from '../modules/notifications/birthday'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }

async function main() {
  check('same day and month is a birthday', isBirthday('2004-10-13', '2026-10-13') && !isBirthday('2004-10-14', '2026-10-13'))
  check('29 Feb is celebrated on 28 Feb in a common year', isBirthday('2004-02-29', '2027-02-28') && !isBirthday('2004-02-29', '2028-02-28') && isBirthday('2004-02-29', '2028-02-29'))
  check('age reached today', ageOn('2004-10-13', '2026-10-13') === 22 && ageOn('2004-02-29', '2027-02-28') === 23 && ageOn('2004-12-01', '2026-10-13') === 21)
  check('the name is escaped in the e-mail', birthdayHtml('<b>x</b>', 'A & B').includes('&lt;b&gt;x&lt;/b&gt;') && birthdayHtml('Asha', 'A & B').includes('A &amp; B'))
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'BDY', name: 'Birthday Branch', status: 'active' }).returning()
      const [u] = await tx.insert(users).values({ branchId: a.id, name: 'c', email: 'c@birthday.test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const counselor: Actor = { userId: u.id, orgId: ORG, role: 'counselor', branchId: a.id }
      await applyTenant(tx, counselor)
      const mk = async (first: string, phone: string, email: string | null, dob: string) => {
        const r = await createRegistration(tx, counselor, { person: { firstName: first, phone }, departmentId: dept.id, totalFee: 1000, enrollmentDate: '2026-07-01' })
        await tx.execute(sql`update persons set email = ${email}, dob = ${dob}::date where id = ${r.personId}`)
        return r
      }
      await mk('Today', '9822200001', 'today@birthday.test.invalid', '2005-03-15')
      await mk('Tomorrow', '9822200002', 'tomorrow@birthday.test.invalid', '2005-03-16')
      await mk('NoMail', '9822200003', null, '2005-03-15')
      const gone = await mk('Gone', '9822200004', 'gone@birthday.test.invalid', '2005-03-15')
      await tx.execute(sql`update registrations set status = 'discontinued' where id = ${gone.id}`)
      await tx.execute(sql`select set_config('app.is_super', 'true', true)`)
      const first = await queueBirthdayWishes(tx, '2030-03-15')
      const mine = (await tx.execute<{ to_address: string; template: string; html: string | null }>(sql`select to_address, template, html from notifications where dedupe_key like 'bday:%birthday.test.invalid:2030'`)).rows
      check('only the active student with an e-mail and a birthday today', mine.length === 1 && mine[0].to_address === 'today@birthday.test.invalid' && mine[0].template === 'birthday', JSON.stringify(mine.map((m) => m.to_address)))
      check('the wish has its festive HTML', !!mine[0]?.html?.includes('Happy Birthday, Today!'))
      const again = await queueBirthdayWishes(tx, '2030-03-15')
      check('running again the same day queues nothing new', again.birthdayQueued === 0 && first.birthdayQueued >= 1)
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
