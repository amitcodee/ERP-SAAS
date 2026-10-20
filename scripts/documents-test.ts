// Registration documents against the real DB, in ONE rolled-back transaction.
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '../lib/db/client'
import { auditLogs, branches, departments, users } from '../lib/db/schema'
import { applyTenant, type Actor, type Tx } from '../lib/db/withTenant'
import { deleteDocument, getDocument, listDocuments, sniffMime, uploadDocument } from '../modules/documents/service'
import { createRegistration } from '../modules/registrations/service'
import { SAMPLE_ORG_ID as ORG } from '../lib/db/schema/tenancy'

class Rollback extends Error {}
let failed = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? ' - ' + x : ''}`); if (!ok) failed++ }
async function throws(tx: Tx, name: string, fn: () => Promise<unknown>, match?: RegExp) {
  await tx.execute(sql`savepoint sp`)
  try { await fn(); check(name, false, 'expected error') }
  catch (e) {
    await tx.execute(sql`rollback to savepoint sp`)
    const msg = String(e) + ' ' + String((e as { cause?: unknown }).cause ?? '')
    check(name, !match || match.test(msg), match ? msg.slice(0, 100).replace(/\s+/g, ' ') : '')
  }
}
const as = async (tx: Tx, a: Actor) => { await tx.execute(sql`reset role`); await applyTenant(tx, a) }

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32), Buffer.from('%%EOF')])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)])
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)])
const HTML = Buffer.from('<html><script>alert(1)</script></html>')

async function main() {
  check('sniffing: pdf/png recognised, exe/html refused', sniffMime(PDF) === 'application/pdf' && sniffMime(PNG) === 'image/png' && !sniffMime(EXE) && !sniffMime(HTML))
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${ORG}, true)`) // the Sample Institute owns what the test makes
      const [a] = await tx.insert(branches).values({ code: 'DA1', name: 'Docs A' }).returning()
      const [b] = await tx.insert(branches).values({ code: 'DB1', name: 'Docs B' }).returning()
      const [ua] = await tx.insert(users).values({ branchId: a.id, name: 'Cou', email: 'da@test.invalid', passwordHash: 'x' }).returning()
      const [ub] = await tx.insert(users).values({ branchId: b.id, name: 'Mgr B', email: 'db@test.invalid', passwordHash: 'x' }).returning()
      const [dept] = await tx.select().from(departments).limit(1)
      const counselor: Actor = { userId: ua.id, orgId: ORG, role: 'counselor', branchId: a.id }
      const trainer: Actor = { ...counselor, role: 'trainer' }
      const mgrB: Actor = { userId: ub.id, orgId: ORG, role: 'branch_manager', branchId: b.id }

      await as(tx, counselor)
      const reg = await createRegistration(tx, counselor, { person: { firstName: 'Doc Student', phone: '9877700001' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })
      const other = await createRegistration(tx, counselor, { person: { firstName: 'Other Student', phone: '9877700002' }, departmentId: dept.id, totalFee: 100000, enrollmentDate: '2026-10-01' })

      const d1 = await uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'id_proof', fileName: 'aadhaar.pdf', bytes: PDF })
      await uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'photo', fileName: '../../evil"name.png', bytes: PNG })
      const list = await listDocuments(tx, counselor, reg.id)
      check('counselor uploads; list shows both, newest first, without file bytes', list.length === 2 && !('data' in list[0]))
      check('file name is sanitised', list.some((d) => d.fileName === '.._.._evil_name.png'), list.map((d) => d.fileName).join(','))
      const got = await getDocument(tx, counselor, d1.id)
      check('download returns the exact bytes and detected type', !!got && Buffer.compare(got.data, PDF) === 0 && got.mime === 'application/pdf' && got.sizeBytes === PDF.length)
      const [log] = await tx.select().from(auditLogs).where(and(eq(auditLogs.entity, 'document'), eq(auditLogs.entityId, d1.id)))
      check('upload is audited', !!log && log.action === 'create')

      await throws(tx, 'an .exe renamed to .pdf is refused', () => uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'other', fileName: 'x.pdf', bytes: EXE }), /Only PDF/)
      await throws(tx, 'an HTML file is refused', () => uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'other', fileName: 'x.png', bytes: HTML }), /Only PDF/)
      await throws(tx, 'over 5 MB is refused', () => uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'other', fileName: 'big.pdf', bytes: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) }), /5 MB/)
      await throws(tx, 'empty file is refused', () => uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'other', fileName: 'e.pdf', bytes: Buffer.alloc(0) }), /empty/)
      await throws(tx, 'unknown document type is refused', () => uploadDocument(tx, counselor, { registrationId: reg.id, kind: 'passport_scan', fileName: 'x.pdf', bytes: PDF }))
      await throws(tx, 'trainer can view but not upload', () => uploadDocument(tx, trainer, { registrationId: reg.id, kind: 'other', fileName: 'x.pdf', bytes: PDF }), /Forbidden/)
      check('trainer can list', (await listDocuments(tx, trainer, reg.id)).length === 2)

      // ---- isolation -------------------------------------------------------------------
      await as(tx, mgrB)
      check('another branch sees no documents', (await listDocuments(tx, mgrB, reg.id)).length === 0)
      check('another branch cannot download by id', (await getDocument(tx, mgrB, d1.id)) === null)
      await throws(tx, 'another branch cannot upload to it', () => uploadDocument(tx, mgrB, { registrationId: reg.id, kind: 'other', fileName: 'x.pdf', bytes: PDF }), /not found/)
      await throws(tx, 'another branch cannot delete it', () => deleteDocument(tx, mgrB, d1.id), /not found/)

      await as(tx, counselor)
      await uploadDocument(tx, counselor, { registrationId: other.id, kind: 'other', fileName: 'other.pdf', bytes: PDF })
      const [stu] = await tx.insert(users).values({ branchId: a.id, name: 'Stu', email: 'ds@test.invalid', passwordHash: 'x' }).returning()
      const student: Actor = { userId: stu.id, orgId: ORG, role: 'student', branchId: a.id, personId: reg.personId }
      await as(tx, student)
      const seen = await tx.execute(sql`select registration_id from registration_documents`)
      check('a student sees only their own documents (RLS)', seen.rows.length === 2 && seen.rows.every((r) => r.registration_id === reg.id), String(seen.rows.length))

      await as(tx, counselor)
      await deleteDocument(tx, counselor, d1.id)
      check('delete removes it', (await getDocument(tx, counselor, d1.id)) === null && (await listDocuments(tx, counselor, reg.id)).length === 1)
      const del = await tx.select().from(auditLogs).where(and(eq(auditLogs.entity, 'document'), eq(auditLogs.action, 'delete'), eq(auditLogs.entityId, d1.id)))
      check('delete is audited with the file hash', del.length === 1 && JSON.stringify(del[0].before).includes('sha256'))

      await tx.execute(sql`reset role`)
      await throws(tx, 'the database itself refuses > 5 MB', () => tx.execute(sql`insert into registration_documents (branch_id, registration_id, kind, file_name, mime, size_bytes, sha256, data)
        values (${a.id}, ${reg.id}, 'other', 'x', 'application/pdf', 6000000, 'x', '\\x00')`), /size_ck/)
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
