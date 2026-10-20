// Many things happening AT THE SAME TIME, with real committed transactions (dev database only - it leaves rows behind).
// Proves the money and numbering guarantees hold under races, not just in single-threaded tests.
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { branches, departments, lookups, persons, users } from '../lib/db/schema'
import { withTenant, type Actor } from '../lib/db/withTenant'
import { createEnquiry } from '../modules/enquiries/service'
import { getBalance, recordPayment } from '../modules/fees/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
const RUN = Date.now().toString().slice(-5)

async function main() {
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing to run: this test commits data; point DATABASE_URL at the private dev database')
  const [b] = await db.insert(branches).values({ orgId: ORG, code: `K${RUN}`, name: `Concurrency ${RUN}` }).returning()
  const mk = async (name: string) => (await db.insert(users).values({ orgId: ORG, branchId: b.id, name, email: `${name}.${RUN}@cc.test.invalid`, passwordHash: 'x' }).returning())[0]
  const [uc, ua] = [await mk('counselor'), await mk('accountant')]
  const [dept] = await db.select().from(departments).limit(1)
  const [cash] = await db.select().from(lookups).where(eq(lookups.value, 'Cash'))
  const counselor: Actor = { userId: uc.id, orgId: ORG, role: 'counselor', branchId: b.id }
  const acct: Actor = { userId: ua.id, orgId: ORG, role: 'accountant', branchId: b.id }

  // ---- 1. simultaneous payments can never overpay, and receipt numbers stay gapless ---------------
  const reg = await withTenant(counselor, (tx) => createRegistration(tx, counselor, { person: { firstName: 'Race', phone: `93${RUN}001`.slice(0, 10) }, departmentId: dept.id, totalFee: 80000, enrollmentDate: '2026-10-01' }))
  // the first payment has its own minimum (₹500): taken first, then the race on the ₹300 left
  await withTenant(counselor, (tx) => recordPayment(tx, counselor, { registrationId: reg.id, amount: 50000, modeId: cash.id, nextInstallmentDate: '2027-01-01', nextInstallmentAmount: 30000 }))
  const pays = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      withTenant(counselor, (tx) => recordPayment(tx, counselor, { registrationId: reg.id, amount: 10000, modeId: cash.id, nextInstallmentDate: '2027-01-01', nextInstallmentAmount: 1 })),
    ),
  )
  const won = pays.filter((p) => p.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof recordPayment>>>[]
  check('8 simultaneous Rs.100 payments on a Rs.300 balance: exactly 3 succeed', won.length === 3, `${won.length} succeeded`)
  const bal = await withTenant(acct, (tx) => getBalance(tx, reg.id))
  check('balance ends at exactly zero (never negative = never overpaid)', bal.balance === 0 && bal.paid === 80000, JSON.stringify(bal))
  const nums = won.map((w) => Number(w.value.receipt.receiptNo.split('-').pop())).sort((x, y) => x - y)
  check('receipt numbers are gapless 2,3,4 despite the race', nums.join() === '2,3,4', nums.join())
  const rejected = pays.filter((p) => p.status === 'rejected').map((p) => String((p as PromiseRejectedResult).reason))
  check('the losers get a clear business error, not a crash', rejected.length === 5 && rejected.every((m) => /Nothing is due|more than the outstanding/.test(m)), rejected[0]?.slice(0, 60))

  // ---- 2. registration numbers under a stampede ------------------------------------------------------
  const N = 12
  const regs = await Promise.allSettled(
    Array.from({ length: N }, (_, i) =>
      withTenant(counselor, (tx) => createRegistration(tx, counselor, { person: { firstName: `Stampede${i}`, phone: `94${RUN}${String(i).padStart(3, '0')}`.slice(0, 10) }, departmentId: dept.id, totalFee: 100, enrollmentDate: '2026-10-01' })),
    ),
  )
  const okRegs = regs.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof createRegistration>>>[]
  check(`${N} simultaneous registrations all succeed`, okRegs.length === N, `${okRegs.length}/${N}`)
  const seq = okRegs.map((r) => Number(r.value.regNo.split('-').pop())).sort((x, y) => x - y)
  check('registration numbers are unique and contiguous (2..13, after the first one)', new Set(seq).size === N && seq[N - 1] - seq[0] === N - 1, seq.join())

  // ---- 3. the same phone number entered by many people at once = ONE student ---------------------------
  const phone = `95${RUN}777`.slice(0, 10)
  const enq = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      withTenant(counselor, (tx) => createEnquiry(tx, counselor, { person: { firstName: `Dup${i}`, phone }, departmentId: dept.id })),
    ),
  )
  const okEnq = enq.filter((e) => e.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof createEnquiry>>>[]
  const errs = enq.filter((e) => e.status === 'rejected').map((e) => String((e as PromiseRejectedResult).reason).slice(0, 90))
  check('10 simultaneous enquiries with one phone: every one succeeds (no duplicate-key crash)', okEnq.length === 10, errs[0] ?? '')
  const people = await db.select().from(persons).where(eq(persons.branchId, b.id))
  const same = people.filter((p) => p.phoneNorm === phone)
  check('...and there is exactly ONE student record for that phone', same.length === 1, `${same.length} records`)
  const enqNos = okEnq.map((e) => e.value.enquiry.enquiryNo)
  check('enquiry numbers are unique', new Set(enqNos).size === enqNos.length)

  await pool.end()
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((e) => { console.error(e); process.exit(1) })
