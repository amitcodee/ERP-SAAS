// Number formats per org (Settings → Numbering): the renderer and its checks, the org's formats used when numbers are
// minted, and the counters that run across a whole org (tickets, help requests, event certificates), each org its own.
// Against the real DB in ONE rolled-back transaction.
import { sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, users } from '../lib/db/schema'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'
import { applyOrgSystem, applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { financialYear, formatProblem, nextEnquiryNo, nextOrgNo, nextReceiptNo, nextRegNo, numberOf, periodOf, renderNumber } from '../lib/numbering'
import { yearIST } from '../lib/ist'
import { RECEIPT_FY } from '../modules/ops/reconcile'
import { listNumbering, setNumbering } from '../modules/settings/numbering'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 110).replace(/\s+/g, ' ') : '')
  }
}

const d = new Date('2026-10-20T06:00:00Z')
const fy = financialYear(d), y = String(yearIST(d))

function pure() {
  check('the defaults render as before', renderNumber('ENQ-{code}-{yy}-{nnnn}', 'MOH', 7, d) === 'ENQ-MOH-26-0007' && renderNumber('RCP-{code}-{FY}-{nnnnn}', 'MOH', 12, d) === 'RCP-MOH-2026-27-00012'
    && renderNumber('CERT-{code}-{yyyy}-{nnnn}', 'C1', 3, d) === 'CERT-C1-2026-0003' && renderNumber('EV-{yy}-{nnnnnn}', '', 9, d) === 'EV-26-000009')
  check('upper-case aliases: {BRANCH}, {YYYY}, {YY}', renderNumber('{BRANCH}/{YYYY}/{YY}/{n}', 'LDH', 42, d) === 'LDH/2026/26/42')
  check('financial year in January belongs to the year before', financialYear(new Date('2027-01-15T06:00:00Z')) === '2026-27' && financialYear(new Date('2027-04-01T06:00:00Z')) === '2027-28')
  check('the period follows the format', periodOf('X-{FY}-{n}', d) === fy && periodOf('X-{yy}-{n}', d) === y && periodOf('X-{n}', d) === 'ALL')
  check('reading the number back', numberOf('E/{code}/{FY}/{nnn}', 'LDH', `E/LDH/${fy}/045`, d) === 45 && numberOf('E/{code}/{FY}/{nnn}', 'LDH', `E/MOH/${fy}/045`, d) === null)
  check('a format needs the running number exactly once', !!formatProblem('ENQ', 'ENQ-{code}') && !!formatProblem('ENQ', 'ENQ-{code}-{n}-{n}'))
  check('unknown parts and odd characters are refused', !!formatProblem('ENQ', 'ENQ-{code}-{x}-{n}') && !!formatProblem('ENQ', 'ENQ#{code}{n}'))
  check('an org-wide branch number must name the branch', !!formatProblem('ENQ', 'ENQ-{n}') && !formatProblem('ENQ', 'ENQ-{code}-{n}'))
  check('an org-wide counter must not name a branch', !!formatProblem('TKT', 'T-{code}-{n}') && !formatProblem('TKT', 'T-{yyyy}-{nnnn}'))
  check('receipts: per financial year, ending with the number', !!formatProblem('RCP', 'R-{code}-{yyyy}-{n}') && !!formatProblem('RCP', 'R-{code}-{n}-{FY}') && !formatProblem('RCP', 'R/{code}/{FY}/{nnnn}'))
}

async function main() {
  pure()
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`)
      const [b] = await tx.insert(branches).values({ code: 'NB1', name: 'Numbering' }).returning()
      const [u] = await tx.insert(users).values({ branchId: b.id, name: 'Head', email: 'head@numbering.test.invalid', passwordHash: 'x' }).returning()
      const head: Actor = { userId: u.id, orgId: ORG, role: 'super_admin', branchId: null }
      const mgr: Actor = { userId: u.id, orgId: ORG, role: 'branch_manager', branchId: b.id }
      // a second institute, to show its counters are its own
      const [other] = (await tx.execute<{ id: string }>(sql`insert into organisations (name, slug, status, plan_key)
        select 'Numbering Two', 'numbering-two-test', 'active', plan_key from organisations where id = ${ORG} returning id`)).rows
      const as = async (a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }

      const fyOf = async (no: string) => (await tx.execute<{ p: string | null }>(sql`select substring(${no}::text from ${RECEIPT_FY}) as p`)).rows[0].p
      check('reconciliation finds the financial year in any receipt format, not in the branch code',
        (await fyOf('RCP-K41307-2026-27-00001')) === '2026-27' && (await fyOf('R/2026-27/K4130/12')) === '2026-27' && (await fyOf('2026-27-MOH-1')) === '2026-27')

      // ---- the org's formats -----------------------------------------------------------------------------------
      await as(head)
      check('with no format set, the defaults are used', (await nextEnquiryNo(tx, b.id, 'NB1', d)) === 'ENQ-NB1-26-0001')
      await throws(tx, 'a branch manager cannot set the formats', () => setNumbering(tx, mgr, { ENQ: 'E-{code}-{n}' }), /Only head office/)
      await throws(tx, 'a bad format is refused, naming the kind', () => setNumbering(tx, head, { ENQ: 'E-{n}' }), /Enquiry number: Put the branch in it/)
      await throws(tx, 'an unknown kind is refused', () => setNumbering(tx, head, { XYZ: 'X-{n}' }), /Unknown number kind/)
      await setNumbering(tx, head, { ENQ: 'E/{code}/{FY}/{n}', REG: '{code}/{yyyy}/{nnn}', RCP: 'R-{code}-{FY}-{nnnn}', TKT: 'T-{yyyy}-{nnnn}' })
      check('the enquiry number follows the org format (a new counter for the new period)', (await nextEnquiryNo(tx, b.id, 'NB1', d)) === `E/NB1/${fy}/1`)
      check('the receipt number too', (await nextReceiptNo(tx, b.id, 'NB1', d)) === `R-NB1-${fy}-0001`)
      check('a branch without its own registration format uses the org one', (await nextRegNo(tx, b.id, 'NB1', d)) === `NB1/${y}/001`)
      await tx.execute(sql`reset role`); await tx.execute(sql`update branches set reg_format = 'OLD/{n}' where id = ${b.id}`); await as(head)
      check('a branch format still comes first', (await nextRegNo(tx, b.id, 'NB1', d)) === 'OLD/1')
      const rows = await listNumbering(tx)
      check('Settings lists every kind with its format and an example', rows.length === 7 && rows.find((r) => r.kind === 'ENQ')?.format === 'E/{code}/{FY}/{n}' && rows.find((r) => r.kind === 'HLP')?.format === null && rows.find((r) => r.kind === 'TKT')?.example === `T-${yearIST()}-0001`)
      await setNumbering(tx, head, { ENQ: '' })
      check('a blank format goes back to the default', (await nextEnquiryNo(tx, b.id, 'NB1', d)) === 'ENQ-NB1-26-0002' && !(await listNumbering(tx)).find((r) => r.kind === 'ENQ')?.format)
      const [audited] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from audit_logs where action = 'set_numbering' and user_id = ${u.id}`)).rows
      check('each change is in the audit log', audited.n === 2)

      // ---- counters of the whole org ---------------------------------------------------------------------------
      const t1 = await nextOrgNo(tx, 'TKT', d), t2 = await nextOrgNo(tx, 'TKT', d)
      check('ticket numbers follow the org format, one after another', /^T-2026-\d{4}$/.test(t1) && numberOf('T-{yyyy}-{nnnn}', '', t2, d) === numberOf('T-{yyyy}-{nnnn}', '', t1, d)! + 1, `${t1}, ${t2}`)
      await tx.execute(sql`reset role`); await applyOrgSystem(tx, other.id)
      check('another institute counts its own from 1, in its own (default) format', (await nextOrgNo(tx, 'TKT', d)) === 'TKT-00001' && (await nextOrgNo(tx, 'HLP', d)) === 'HLP-00001' && (await nextOrgNo(tx, 'EVC', d)) === 'EV-26-000001')
      const [rawTicket] = (await tx.execute<{ n: string }>(sql`select ('TKT-' || lpad(app_org_seq('TKT', 'ALL')::text, 5, '0')) as n`)).rows
      check('the column default draws from the same counter', rawTicket.n === 'TKT-00002')
      await as(head)
      check('... and the first institute carries on where it was', (await nextOrgNo(tx, 'TKT', d)) === renderNumber('T-{yyyy}-{nnnn}', '', numberOf('T-{yyyy}-{nnnn}', '', t2, d)! + 1, d))
      await throws(tx, 'the app cannot read or change the counters directly', () => tx.execute(sql`select * from org_sequences`), /permission denied/)
      await tx.execute(sql`reset role`); await applyTenant(tx, { ...head, readOnly: true })
      await throws(tx, 'a read-only institute mints no numbers', () => nextOrgNo(tx, 'HLP', d), /read-only/)
      await tx.execute(sql`reset role`); await tx.execute(sql`select set_config('app.org_id', '', true)`); await tx.execute(sql`set local role techcadd_app`)
      await throws(tx, 'outside any institute there is no counter', () => tx.execute(sql`select app_org_seq('TKT', 'ALL')`), /no organisation/)
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) { console.error(e); failed++ }
  } finally {
    await pool.end()
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  process.exit(failed ? 1 : 0)
}
main()
