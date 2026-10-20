// The same person in other branches. People are kept per branch, so a student known in Mohali is a stranger to
// Phagwara's tables. While a call, lead, enquiry or admission is typed in, the mobile number, e-mail and date of birth
// (with the first name) are looked up in every branch, and what each branch has on them (a call, a lead, an
// admission) is shown. Read on the server's own connection: only these few matches.
// Privacy: a person of ANOTHER branch is shown only enough to recognise them (first name, last-name initial, a masked
// mobile, the branch and their records). Their full details come only with "Use these details" (branchMatchDetails),
// which re-checks the match, is rate-limited and is written to the activity log. This branch's own people: in full.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { can } from '@/lib/auth/permissions'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { underLimit } from '@/lib/redis'
import { normalizePhone } from './phone'

export type BranchMatch = {
  personId: string; branchId: string; branch: string; sameBranch: boolean; matchedOn: ('mobile' | 'email' | 'dob')[]
  /** false: another branch's person, shown masked (the details below are empty until "Use these details") */
  full: boolean
  firstName: string; lastName: string | null; phone: string; altPhone: string | null; email: string | null; dob: string | null; gender: string | null
  fatherName: string | null; motherName: string | null; address: string | null
  records: { kind: 'admission' | 'lead' | 'call'; no: string | null; status: string; course: string | null; at: string }[]
}

const query = z.object({
  phone: z.string().max(30).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  firstName: z.string().max(100).optional().nullable(),
  /** a person already open (e.g. a student's profile): left out of the matches */
  excludePersonId: z.string().uuid().optional().nullable(),
})
export type MatchQuery = z.input<typeof query>

/** Anyone who adds people or looks at students may ask. */
export const mayMatch = (a: Actor) => a.role !== 'student' && (can(a, 'create', 'call') || can(a, 'create', 'enquiry') || can(a, 'create', 'registration') || can(a, 'read', 'registration'))
/** Opening another branch's person in full is for filling in a new record: only those who add calls, leads or admissions. */
const mayOpenMatch = (a: Actor) => a.role !== 'student' && (can(a, 'create', 'call') || can(a, 'create', 'enquiry') || can(a, 'create', 'registration'))

const maskPhone = (p: string) => { const d = p.replace(/\D/g, ''); return d.length >= 6 ? `${d.slice(0, 2)}••••••${d.slice(-2)}` : '••••' }
/** Another branch's person: only enough to recognise them. */
const masked = (m: BranchMatch): BranchMatch => ({
  ...m, full: false, lastName: m.lastName ? `${m.lastName.trim()[0]}.` : null, phone: maskPhone(m.phone),
  altPhone: null, email: null, dob: null, gender: null, fatherName: null, motherName: null, address: null,
})

/** While typing: the matches, other branches' people masked. Rate-limited per person (typing makes many lookups). */
export async function branchMatches(actor: Actor, raw: MatchQuery): Promise<BranchMatch[]> {
  if (!mayMatch(actor)) throw new Error('Forbidden: look up people')
  if (!(await underLimit(`match:${actor.userId}`, 150, 600))) throw new Error('Too many look-ups: wait a few minutes')
  return withOrgSystem(actor.orgId, (tx) => branchMatchesIn(tx, actor, raw))
}
export async function branchMatchesIn(tx: Tx, actor: Actor, raw: MatchQuery): Promise<BranchMatch[]> {
  return (await findPeople(tx, actor, query.parse(raw))).map((m) => (m.sameBranch ? m : masked(m)))
}

/** "Use these details": the full record of one match, only if it really matches what was typed. Logged and rate-limited. */
export async function branchMatchDetails(actor: Actor, raw: MatchQuery, personId: string): Promise<BranchMatch> {
  if (!mayOpenMatch(actor)) throw new Error('Forbidden: open people from other branches')
  const id = z.string().uuid().parse(personId)
  if (!(await underLimit(`match-detail:${actor.userId}`, 30, 600))) throw new Error('Too many people opened: wait a few minutes')
  if (!(await underLimit(`match-detail-day:${actor.userId}`, 150, 24 * 3600))) throw new Error('Too many people opened today: try again tomorrow')
  return withOrgSystem(actor.orgId, (tx) => branchMatchDetailsIn(tx, actor, raw, id))
}
export async function branchMatchDetailsIn(tx: Tx, actor: Actor, raw: MatchQuery, personId: string): Promise<BranchMatch> {
  const [m] = await findPeople(tx, actor, query.parse(raw), z.string().uuid().parse(personId))
  if (!m) throw new Error('This person does not match what was typed')
  if (!m.sameBranch) await audit(tx, actor, { action: 'view_person', entity: 'person', entityId: m.personId, after: { branch: m.branch, matchedOn: m.matchedOn } })
  return m
}

async function findPeople(tx: Tx, actor: Actor, q: z.output<typeof query>, onlyId?: string): Promise<BranchMatch[]> {
  const phone = q.phone ? normalizePhone(q.phone) : ''
  const email = q.email?.trim().toLowerCase() || ''
  const first = q.firstName?.trim().toLowerCase() || ''
  const dob = q.dob || ''
  const byPhone = phone.length === 10, byEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), byDob = !!dob && first.length >= 2
  if (!byPhone && !byEmail && !byDob) return []
  {
    const people = (await tx.execute<{
      id: string; branch_id: string; branch: string; first_name: string; last_name: string | null; phone: string; alt_phone: string | null; email: string | null
      dob: string | null; gender: string | null; father_name: string | null; mother_name: string | null; address: string | null; m_phone: boolean; m_email: boolean; m_dob: boolean
    }>(sql`
      select p.id, p.branch_id, b.name as branch, p.first_name, p.last_name, p.phone, p.alt_phone, p.email, p.dob::text, p.gender, p.father_name, p.mother_name, p.address,
        ${byPhone ? sql`(p.phone_norm = ${phone} or right(regexp_replace(coalesce(p.alt_phone, ''), '\\D', '', 'g'), 10) = ${phone})` : sql`false`} as m_phone,
        ${byEmail ? sql`lower(p.email) = ${email}` : sql`false`} as m_email,
        ${byDob ? sql`(p.dob = ${dob}::date and lower(p.first_name) = ${first})` : sql`false`} as m_dob
      from persons p join branches b on b.id = p.branch_id
      where p.deleted_at is null ${q.excludePersonId ? sql`and p.id <> ${q.excludePersonId}::uuid` : sql``} ${onlyId ? sql`and p.id = ${onlyId}::uuid` : sql``} and (
        ${byPhone ? sql`p.phone_norm = ${phone}` : sql`false`}
        or ${byEmail ? sql`lower(p.email) = ${email}` : sql`false`}
        or ${byDob ? sql`(p.dob = ${dob}::date and lower(p.first_name) = ${first})` : sql`false`})
      order by (p.branch_id = ${actor.branchId}::uuid) desc nulls last, p.created_at desc limit 8`)).rows
    if (!people.length) return []
    const ids = sql.join(people.map((p) => sql`${p.id}::uuid`), sql`, `)
    const recs = (await tx.execute<{ person_id: string; kind: 'admission' | 'lead' | 'call'; no: string | null; status: string; course: string | null; at: string }>(sql`
      select r.person_id, 'admission' as kind, r.reg_no as no, r.status::text as status, coalesce(c.title, r.custom_course_title) as course, r.created_at as at
        from registrations r left join courses c on c.id = r.course_id where r.person_id in (${ids}) and r.deleted_at is null
      union all
      select e.person_id, 'lead', e.enquiry_no, e.status::text, c.title, e.created_at
        from enquiries e left join courses c on c.id = e.course_id where e.person_id in (${ids}) and e.deleted_at is null
      union all
      select k.person_id, 'call', null, coalesce(k.status, 'logged'), null, k.called_at
        from calls k where k.person_id in (${ids}) and k.deleted_at is null and k.enquiry_id is null
      order by at desc`)).rows
    return people.map((p) => ({
      personId: p.id, branchId: p.branch_id, branch: p.branch, sameBranch: p.branch_id === actor.branchId, full: true,
      matchedOn: [...(p.m_phone ? ['mobile' as const] : []), ...(p.m_email ? ['email' as const] : []), ...(p.m_dob ? ['dob' as const] : [])],
      firstName: p.first_name, lastName: p.last_name, phone: p.phone, altPhone: p.alt_phone, email: p.email, dob: p.dob, gender: p.gender,
      fatherName: p.father_name, motherName: p.mother_name, address: p.address,
      records: recs.filter((r) => r.person_id === p.id).slice(0, 5).map((r) => ({ kind: r.kind, no: r.no, status: r.status, course: r.course, at: new Date(r.at).toISOString() })),
    }))
  }
}
