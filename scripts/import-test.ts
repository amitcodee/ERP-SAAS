// Legacy import (insti.md §11) against the real DB, in ONE rolled-back transaction.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, enquiries, installments, registrationEvents, registrations, users } from '../lib/db/schema'
import { applyTenant, type Actor } from '../lib/db/withTenant'
import { getBalance } from '../modules/fees/service'
import { importEnquiries, importRegistrations, parseCsv, parseDate, parseRupees } from '../modules/import/legacy'
import { importOldFees, importOldRegistrations } from '../modules/import/oldsystem'
import { setRegNumbering } from '../modules/branches/service'
import { reconcile } from '../modules/ops/reconcile'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const bad = (fn: () => unknown) => { try { fn(); return false } catch { return true } }

const ENQ = `Legacy Ref,Enquiry Date,First Name,Last Name,Phone,Source,Department,Course,Proposed Fee,Status,Follow Up Date,Not Joined Reason,Remarks
OLD-1,15-08-2026,Riya,Sharma,+91 98765 11001,Social Media,CSE-IT,,"25,000",follow_up,05-10-2026,,"Asked, twice"
OLD-2,20/08/2026,Aman,,09876511002,Direct visit,Graphic Designing,,18000,not_joined,,Will Take time to Register,
OLD-3,21-08-2026,Bad,Course,9876511003,,,AutoCAD Wizardry 9000,,new,,,
OLD-4,31-02-2026,Bad,Date,9876511004,,CSE-IT,,,new,,,
OLD-5,22-08-2026,Bad,Status,9876511005,,CSE-IT,,,joined,,,
`
const REG = `legacy_reg_no,first_name,last_name,phone,department,class_mode,enrollment_date,total_fee,paid_to_date,status,next_due_date,next_due_amount,remarks
TC/0101,Riya,Sharma,9876511001,CSE-IT,Offline,01-07-2026,"₹30,000","12,000",active,10-10-2026,9000,
TC/0087,Simran,Kaur,9876511006,Digital Marketing,Online,15-04-2026,20000,20000,completed,,,June batch
TC/0090,Hold,Me,9876511007,CAD/CAM,,01-05-2026,10000,0,on_hold,,,fees pending
TC/0091,Over,Paid,9876511008,CAD/CAM,,01-05-2026,10000,12000,active,,,
TC/0092,No,Dept,9876511009,,,01-05-2026,10000,,active,,,
,Missing,Legacy,9876511010,CAD/CAM,,01-05-2026,10000,,active,,,
`

// The old system's own tables, as phpMyAdmin exports them (column names in the first row; empty = NULL)
const OLD_REG = `id,regno,passcode,date,center_code,branch,software,course,coursetype,j_date,fee,gst,total_fee,paid,pending,name,f_name,phone,whatsappno,parents,qualification,email,dob,collegework,address,image,certi_delver,discontinue,status
1,TCD/4002/1,techcadd123456,2021-01-07,4002,Hoshiarpur,NULL,Certificate Course in Mechanical Cad,Mechanical,2021-01-07,12500,0,12500,12500,0,DILPREET KAUR,JATINDER SINGH,9464056650,NULL,NULL,NULL,dil@x.test,2003-05-01,NULL,Hoshiarpur,img.jpg,Delivered,NULL,agree
2,TCD/4002/2,techcadd123456,2021-01-07,4002,Hoshiarpur,3ds Max,Certificate Course in Civil CAD,Civil,2021-01-07,10500,0,10500,4000,6500,MANJOT SINGH,RAJESHWAR SINGH,9877042673,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
3,TCD/4002/2577,techcadd123456,2026-09-08,4002,Hoshiarpur,NULL,Basic Computer,Computer Application,2026-09-08,4500,0,4500,0,4500,ANU,RAM,9501029178,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
4,TCD/4002/2577,techcadd123456,2026-09-08,4002,Hoshiarpur,NULL,Basic Computer,Computer Application,2026-09-08,4500,0,4500,0,4500,VIKAS,SHAM,9501029179,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
5,TCD/4002/2580,techcadd123456,2026-09-09,4002,Hoshiarpur,NULL,IELTS Coaching,IELTS,2026-09-09,9000,0,9000,0,9000,PREET,DEV,9501029180,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
6,TCD/4002/2581,techcadd123456,2026-09-09,4002,Hoshiarpur,NULL,Basic Computer,Computer Application,2026-09-09,4500,0,4500,0,4500,SIMRAN,RAM,9501029178,9501029190,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
7,TCD/4002/2582,techcadd123456,2026-09-10,4002,Hoshiarpur,NULL,Basic Computer,Computer Application,2026-09-10,4500,0,4500,0,4500,KIRAN,RAM,9501029178,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
8,TCD/4001/9,techcadd123456,2026-09-10,4001,Jalandhar,NULL,Basic Computer,Computer Application,2026-09-10,4500,0,4500,0,4500,OTHER,BRANCH,9501029181,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,agree
`
const OLD_FEE = `id,regno,cname,fname,course,type,totalfee,totalremain,paid,remain,status,cdate,feedate,mobile,recep,center_code,installmentpayment,message,bookno
101,TCD/4002/1,Dilpreet Kaur,Jatinder,Mech CAD,,12500,0,12500,0,Cash,Nill,2021-01-07,9464056650,TCD/101,4002,0,NULL,12
102,TCD/4002/2,Manjot Singh,Rajeshwar,Civil CAD,,10500,6500,3000,7500,G-Pay,Nill,2021-01-07,9877042673,TCD/102,4002,0,NULL,0
103,TCD/4002/2,Manjot Singh,Rajeshwar,Civil CAD,,10500,6500,1000,6500,Cash,Nill,2021-02-07,9877042673,TCD/103,4002,0,NULL,0
104,TCD/4001/3200,Someone,Else,Basic,,6500,0,6500,0,Cash,Nill,2026-10-09,7696139311,TCD/104,4001,0,NULL,122
105,TCD/4002/2577,Anu,Ram,Basic,,4500,4500,0,4500,Cash,Nill,2026-09-08,9501029178,TCD/105,4002,0,NULL,0
106,TCD/4002/2,Manjot Singh,Rajeshwar,Civil CAD,,10500,6500,3000,7500,G-Pay,Nill,2021-01-07,9877042673,TCD/102,4002,0,NULL,0
`

async function main() {
  // ---- parsing ------------------------------------------------------------------------------
  const rows = parseCsv('﻿A Col,B\r\n"x, ""y""",2\r\n\r\n3,\n')
  check('CSV: BOM, quotes, escaped quotes, CRLF, blank lines, header normalisation', rows.length === 2 && rows[0].a_col === 'x, "y"' && rows[0].b === '2' && rows[1].b === '')
  check('dates: Indian and ISO formats', parseDate('05-10-2026', 'd') === '2026-10-05' && parseDate('5/1/2027', 'd') === '2027-01-05' && parseDate('2026-10-05', 'd') === '2026-10-05')
  check('dates: impossible dates refused', bad(() => parseDate('31-02-2026', 'd')) && bad(() => parseDate('2026/10/05x', 'd')))
  check('money: ₹, commas, paise', parseRupees('₹30,000', 'f') === 3000000 && parseRupees('12500.50', 'f') === 1250050 && bad(() => parseRupees('12k', 'f')))

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [br] = await tx.insert(branches).values({ code: 'IM1', name: 'Import A' }).returning()
      const [u] = await tx.insert(users).values({ name: 'Importer', email: 'imp@test.invalid', passwordHash: 'x' }).returning()
      const actor: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: br.id }
      await applyTenant(tx, actor)

      const e = await importEnquiries(tx, actor, parseCsv(ENQ))
      check('enquiries: 2 created, 3 rejected with reasons', e.created === 2 && e.rejects.length === 3, JSON.stringify(e.rejects))
      check('reject: course not in the catalog', e.rejects.some((r) => r.key === 'OLD-3' && /not in the catalog/.test(r.reason)))
      check('reject: impossible date', e.rejects.some((r) => r.key === 'OLD-4' && /real date/.test(r.reason)))
      check('reject: "joined" belongs in registrations', e.rejects.some((r) => r.key === 'OLD-5' && /registrations file/.test(r.reason)))
      const [riya] = await tx.select().from(enquiries).where(eq(enquiries.legacyRef, 'OLD-1'))
      check('enquiry keeps old ref, date, fee, follow-up status', !!riya && riya.status === 'follow_up' && riya.nextFollowUp === '2026-10-05' && riya.proposedFee === 2500000 && riya.createdAt.toISOString().startsWith('2026-08-15'))
      const [aman] = await tx.select().from(enquiries).where(eq(enquiries.legacyRef, 'OLD-2'))
      check('not joined with a reason', aman?.status === 'not_joined' && !!aman.notJoinedReasonId)

      const r = await importRegistrations(tx, actor, parseCsv(REG))
      check('registrations: 3 created, 3 rejected', r.created === 3 && r.rejects.length === 3, JSON.stringify(r.rejects))
      check('reject: paid more than the fee', r.rejects.some((x) => x.key === 'TC/0091' && /more than the total fee/.test(x.reason)))
      check('reject: department missing', r.rejects.some((x) => x.key === 'TC/0092' && /department/.test(x.reason)))
      check('reject: no legacy number', r.rejects.some((x) => /legacy_reg_no is required/.test(x.reason)))

      const [k] = await tx.select().from(registrations).where(eq(registrations.legacyRegNo, 'TC/0101'))
      check('registration keeps legacy no., gets a new REG number, dated at enrolment', !!k && k.regNo.startsWith('REG-') && k.createdAt.toISOString().startsWith('2026-07-01') && k.totalFee === 3000000)
      check('same phone as the enquiry -> same person (no duplicate student)', k.personId === riya.personId)
      const b = await getBalance(tx, k.id)
      check('opening balance: charged 30,000, paid-before 12,000 (shown as paid) -> due 18,000', b.charged === 3000000 && b.paid === 1200000 && b.balance === 1800000, JSON.stringify(b))
      const inst = await tx.select().from(installments).where(eq(installments.registrationId, k.id))
      check('next installment scheduled from the sheet', inst.length === 1 && inst[0].dueDate === '2026-10-10' && inst[0].amount === 900000)
      const [s] = await tx.select().from(registrations).where(eq(registrations.legacyRegNo, 'TC/0087'))
      check('completed student: status set, history recorded, nothing due', s.status === 'completed' && (await getBalance(tx, s.id)).balance === 0
        && (await tx.select().from(registrationEvents).where(eq(registrationEvents.registrationId, s.id))).some((ev) => ev.toStatus === 'completed' && /June batch/.test(ev.note ?? '')))
      const [h] = await tx.select().from(registrations).where(eq(registrations.legacyRegNo, 'TC/0090'))
      check('on hold via the normal transition', h.status === 'on_hold')
      const receipts = await tx.execute(sql`select count(*)::int as n from receipts where branch_id = ${br.id}`)
      check('no receipts minted for old payments', Number(receipts.rows[0].n) === 0)

      const again = await importRegistrations(tx, actor, parseCsv(REG))
      const enqAgain = await importEnquiries(tx, actor, parseCsv(ENQ))
      check('re-running skips what is already imported', again.created === 0 && again.skipped === 3 && enqAgain.created === 0 && enqAgain.skipped === 2)
      check('imported branch reconciles cleanly', (await reconcile(tx)).problems.filter((p) => p.branch === 'IM1').length === 0)

      // ---- the OLD system's tables: old numbers kept, every payment kept, nothing lost
      const [hb] = await tx.insert(branches).values({ code: 'IM2', name: 'Old System Branch' }).returning()
      const ha: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: hb.id }
      await tx.execute(sql`reset role`); await applyTenant(tx, ha)
      let threw = ''
      try { await importOldRegistrations(tx, ha, parseCsv(OLD_REG)) } catch (x) { threw = String(x) }
      check('the branch number format must be set first', /number format first/.test(threw), threw.slice(0, 90))
      await setRegNumbering(tx, ha, hb.id, 'TCD/4002/{n}', null)
      const o = await importOldRegistrations(tx, ha, parseCsv(OLD_REG))
      check('old students: 5 brought over, 3 refused with reasons', o.created === 5 && o.rejects.length === 3, JSON.stringify(o.rejects))
      check('refused: no department for IELTS (say how to fix it)', o.rejects.some((x) => x.key === 'TCD/4002/2580' && /IELTS.*--map/.test(x.reason)))
      check('refused: another branch\'s number in this file', o.rejects.some((x) => x.key === 'TCD/4001/9' && /not in this branch/.test(x.reason)))
      const old = async (no: string) => (await tx.execute<{ id: string; reg_no: string; status: string; custom_course_title: string | null; legacy_data: Record<string, string> | null; first_name: string; last_name: string | null; phone: string; total_fee: number; created_at: Date }>(sql`
        select r.id, r.reg_no, r.status::text, r.custom_course_title, r.legacy_data, p.first_name, p.last_name, p.phone, r.total_fee, r.created_at from registrations r join persons p on p.id = r.person_id where r.branch_id = ${hb.id} and r.reg_no = ${no}`)).rows[0]
      const d1 = await old('TCD/4002/1')
      check('the old number is THE registration number', !!d1 && d1.reg_no === 'TCD/4002/1')
      check('name tidied, the whole old row kept, the password left out', d1.first_name === 'Dilpreet' && d1.last_name === 'Kaur' && d1.legacy_data?.f_name === 'JATINDER SINGH' && !('passcode' in (d1.legacy_data ?? {})) && !('image' in (d1.legacy_data ?? {})))
      check('certificate delivered there -> completed here; the old course name kept', d1.status === 'completed' && d1.custom_course_title === 'Certificate Course in Mechanical Cad' && d1.total_fee === 1250000)
      check('NULL in the export is read as empty', (await old('TCD/4002/2')).legacy_data?.email === 'NULL' && (await old('TCD/4002/2')).status === 'active')
      check('an old number used twice: the second gets -2 (both kept)', !!(await old('TCD/4002/2577')) && !!(await old('TCD/4002/2577-2')) && o.notes.some((n) => /2577 was used twice/.test(n)))
      const sib = await old('TCD/4002/2581')
      check('a sibling on a mobile already used: brought over on their WhatsApp number', sib?.first_name === 'Simran' && sib.phone === '9501029190', sib?.phone)
      check('a third sibling with no number of their own: refused (never merged into someone else)', !(await old('TCD/4002/2582'))
        && o.rejects.some((x) => x.key === 'TCD/4002/2582' && /already used by another student/.test(x.reason)))
      const next = await setRegNumbering(tx, ha, hb.id, 'TCD/4002/{n}', null)
      check('new admissions carry on after the highest old number brought over', next.next === 'TCD/4002/2582', next.next)

      const f = await importOldFees(tx, ha, parseCsv(OLD_FEE))
      check('old payments: 3 brought over; other branch and zero rows left out', f.created === 3 && f.notes.some((n) => /other branches/.test(n)) && f.notes.some((n) => /nothing paid/.test(n)), JSON.stringify(f))
      check('the same receipt saved twice in the old system is taken once', f.notes.some((n) => /1 payment rows were the same receipt saved again/.test(n)))
      const bal2 = await getBalance(tx, (await old('TCD/4002/2')).id)
      check('balance from the old payments: 10,500 - (3,000 + 1,000) = 6,500', bal2.balance === 650000, JSON.stringify(bal2))
      const lp = (await tx.execute<{ receipt_no: string; mode: string; paid_on: string; book_no: string | null }>(sql`select receipt_no, mode, paid_on::text, book_no from legacy_payments where registration_id = ${d1.id}`)).rows
      check('each old payment kept with its receipt, mode, date and book no.', lp.length === 1 && lp[0].receipt_no === 'TCD/101' && lp[0].mode === 'Cash' && lp[0].paid_on === '2021-01-07' && lp[0].book_no === '12')
      check('the check: old record says 4,000 paid for TCD/4002/2 and the payments match (no note)', !f.notes.some((n) => n.startsWith('TCD/4002/2:')))
      const f2 = await importOldFees(tx, ha, parseCsv(OLD_FEE))
      const o2 = await importOldRegistrations(tx, ha, parseCsv(OLD_REG))
      check('re-running adds nothing twice', f2.created === 0 && o2.created === 0 && o2.skipped === 5 && (await getBalance(tx, (await old('TCD/4002/2')).id)).balance === 650000)
      check('no new receipts were minted for old payments', Number((await tx.execute(sql`select count(*)::int as n from receipts where branch_id = ${hb.id}`)).rows[0].n) === 0)
      check('the branch reconciles cleanly', (await reconcile(tx)).problems.filter((p) => p.branch === 'IM2').length === 0, JSON.stringify((await reconcile(tx)).problems.filter((p) => p.branch === 'IM2')))
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
