// What a logged-in student sees. No filtering code here on purpose: the database (student RLS policies)
// only returns this student's rows, so a bug in this file cannot leak anyone else's data.
import { createHash } from 'crypto'
import { desc, eq, sql } from 'drizzle-orm'
import { persons, registrationDocuments, registrations } from '@/lib/db/schema'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { ageOn, isBirthday } from '../notifications/birthday'
import { fillTemplate, resolveTemplate } from '../templates/service'
import { withOrgSystem } from '@/lib/db/withTenant'
import { MAX_DOC_BYTES, sniffMime } from '../documents/service'
import { cleanAadhaar, isValidAadhaar } from '../people/aadhaar'
import { certificateOverview, type CertOverviewRow } from '../certificates/service'
import { listFees, listReceipts, type FeeRow } from '../fees/service'
import { aadhaarColumns, openAadhaar } from '../people/aadhaar-store'
import { brandIn } from '@/lib/brand'

export type PortalItem = {
  fee: FeeRow
  cert: CertOverviewRow | null
  receipts: { receiptNo: string; amount: number; paidAt: string; mode: string; paperSlip: boolean; cancelled: boolean }[]
}

export async function myPortal(tx: Tx, actor: Actor): Promise<PortalItem[]> {
  if (actor.role !== 'student') throw new Error('Forbidden: student portal')
  const fees = await listFees(tx, actor)
  const certs = await certificateOverview(tx, actor)
  const items: PortalItem[] = []
  for (const fee of fees) {
    const receipts = await listReceipts(tx, actor, fee.registrationId)
    items.push({
      fee,
      cert: certs.find((c) => c.registrationId === fee.registrationId) ?? null,
      receipts: receipts.map((r) => ({ receiptNo: r.receiptNo, amount: r.amount, paidAt: r.paidAt.toISOString(), mode: r.mode, paperSlip: !!r.slipId, cancelled: !!r.cancelled })),
    })
  }
  return items
}

/** The student's own profile: their photo, and what the institute still needs from them. */
export type MyProfile = {
  photoId: string | null
  /** What is still missing; the portal asks for it on top. */
  pending: ('photo' | 'aadhaarNo' | 'aadhaarCard')[]
  aadhaarLast4: string | null
  /** set on the student's birthday (India time): the portal opens with a celebration */
  birthday: { firstName: string; age: number | null; year: string; heading: string; message: string } | null
}

export async function myProfile(tx: Tx, actor: Actor): Promise<MyProfile | null> {
  if (actor.role !== 'student' || !actor.personId) throw new Error('Forbidden: student portal')
  const [p] = await tx.select({ aadhaarNo: persons.aadhaarNo, aadhaarLast4: persons.aadhaarLast4, dob: persons.dob, firstName: persons.firstName, branchId: persons.branchId }).from(persons).where(eq(persons.id, actor.personId))
  if (!p) return null
  // the database returns only this student's registrations and their documents
  const docs = await tx.select({ id: registrationDocuments.id, kind: registrationDocuments.kind }).from(registrationDocuments)
    .where(sql`${registrationDocuments.kind} in ('photo', 'id_proof')`).orderBy(desc(registrationDocuments.uploadedAt))
  const photoId = docs.find((d) => d.kind === 'photo')?.id ?? null
  const pending: MyProfile['pending'] = []
  if (!photoId) pending.push('photo')
  const hasCard = docs.some((d) => d.kind === 'id_proof')
  // a picture of the Aadhaar card is enough: the number is asked for only while there is no card
  if (!p.aadhaarNo && !hasCard) pending.push('aadhaarNo')
  if (!hasCard) pending.push('aadhaarCard')
  const today = todayIST()
  let birthday: MyProfile['birthday'] = null
  if (p.dob && isBirthday(String(p.dob), today)) {
    // the branch's words for the card (templates are staff-only rows: read on the server's own connection)
    const { t, branch } = await withOrgSystem(actor.orgId, async (sys) => ({
      t: await resolveTemplate(sys, 'birthday_card', p.branchId),
      branch: (await sys.execute<{ name: string }>(sql`select name from branches where id = ${p.branchId}`)).rows[0]?.name ?? (await brandIn(sys)).name,
    }))
    const age = ageOn(String(p.dob), today)
    const vars = { first_name: p.firstName, branch, age }
    birthday = { firstName: p.firstName, age, year: today.slice(0, 4), heading: fillTemplate(t.subject, vars), message: fillTemplate(t.body, vars) }
  }
  return { photoId, pending, aadhaarLast4: p.aadhaarNo ? (p.aadhaarLast4 ?? openAadhaar(actor.orgId, p.aadhaarNo)?.slice(-4) ?? null) : null, birthday }
}

/** The student adds their Aadhaar number themselves. Once on record it is changed only by the office. */
export async function setMyAadhaar(tx: Tx, actor: Actor, raw: string) {
  if (actor.role !== 'student' || !actor.personId) throw new Error('Forbidden: student portal')
  if (!isValidAadhaar(raw)) throw new Error('Enter a valid 12-digit Aadhaar number')
  const [p] = await tx.select({ aadhaarNo: persons.aadhaarNo }).from(persons).where(eq(persons.id, actor.personId))
  if (!p) throw new Error('Your record was not found')
  if (p.aadhaarNo) throw new Error('Your Aadhaar number is already on record. Ask the office to correct it.')
  await tx.update(persons).set(aadhaarColumns(actor.orgId, cleanAadhaar(raw))).where(eq(persons.id, actor.personId))
}

/** The student uploads their own photo (a new one replaces the old on the ID card) or their Aadhaar card. */
export async function myUpload(tx: Tx, actor: Actor, kind: string, file: { fileName: string; bytes: Buffer }) {
  if (actor.role !== 'student' || !actor.personId) throw new Error('Forbidden: student portal')
  if (kind !== 'photo' && kind !== 'id_proof') throw new Error('Only your photo or your Aadhaar card can be uploaded here')
  const bytes = file.bytes
  if (!bytes.length) throw new Error('The file is empty')
  if (bytes.length > MAX_DOC_BYTES) throw new Error('Files must be 5 MB or smaller')
  const mime = sniffMime(bytes)
  if (!mime || (kind === 'photo' && mime === 'application/pdf')) throw new Error(kind === 'photo' ? 'The photo must be a JPG, PNG or WebP picture' : 'Upload a picture (JPG, PNG, WebP) or a PDF')
  // their latest registration: the file is kept with it
  const [reg] = await tx.select({ id: registrations.id, branchId: registrations.branchId }).from(registrations).orderBy(desc(registrations.createdAt)).limit(1)
  if (!reg) throw new Error('No enrolment found on your account')
  const fileName = (file.fileName.trim() || kind).slice(0, 200).replace(/[\/\r\n"]/g, '_')
  const [doc] = await tx.insert(registrationDocuments).values({
    branchId: reg.branchId, registrationId: reg.id, kind, fileName, mime, sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes, uploadedBy: actor.userId,
  }).returning({ id: registrationDocuments.id })
  return doc
}
