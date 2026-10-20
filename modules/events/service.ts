// Seminars, workshops and other events, and the certificate designs they print.
//   Designs: made on the canvas (Certificate Designs). A branch keeps its own; head office's serve every branch.
//   Events: made in the panel (details, an optional quiz, the certificate design). Each has a public page /e/<token>
//   (its link and QR code): people fill in their details, take the quiz when there is one, and get a certificate in
//   the event's design by e-mail — everyone, or only those who pass, as the event says.
// The public side (no sign-in) reads and writes on the server's own connection, and gives out only what the page
// needs: never the quiz answers, never other participants.
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { serverSecret } from '@/lib/auth/secret'
import { and, desc, eq, sql } from 'drizzle-orm'
import { nextOrgNo } from '@/lib/numbering'
import { z } from 'zod'
import { assertCan, can } from '@/lib/auth/permissions'
import { audit } from '@/lib/audit'
import { fmtCertDate } from '@/lib/cert-art'
import { FONT_KEYS, type Design, type DesignField } from '@/lib/cert-design'
import { certificateDesigns, eventParticipants, events, type EventKind, type QuizQuestion } from '@/lib/db/schema'
import { withOrgSystem, type Actor, type Tx } from '@/lib/db/withTenant'
import { publicGet } from '@/lib/net-guard'
import { mailButton } from '@/lib/notify/layout'
import { fillTemplate, resolveTemplate } from '@/modules/templates/service'

export const EVENT_KINDS: Record<EventKind, string> = { seminar: 'Seminar', workshop: 'Workshop', webinar: 'Webinar', bootcamp: 'Bootcamp', competition: 'Competition', other: 'Event' }
export const EVENT_MODES = { offline: 'At the branch', online: 'Online', hybrid: 'Both' } as const
/** The most a design may weigh (its pictures are inside it). */
export const MAX_DESIGN_BYTES = 8 * 1024 * 1024
export const MAX_IMPORT_BYTES = 6 * 1024 * 1024

// ---- Designs -----------------------------------------------------------------------------------------------------

const num = z.number().finite().min(-1000).max(1000)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #rrggbb')
// a picture inside the design, or one of the panel's own files (never a path that climbs out of public/)
const src = z.string().max(MAX_DESIGN_BYTES).refine((s) => /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) || (/^\/[\w-]+(\/[\w-]+(\.[\w-]+)*)*\.(png|jpe?g)$/.test(s) && !s.includes('..')), 'A picture must be PNG or JPEG')
const box = { id: z.string().min(1).max(40), x: num, y: num, w: num, h: num, opacity: z.number().min(0).max(1).optional(), locked: z.boolean().optional() }
const paint = { fill: color.nullish(), stroke: color.nullish(), sw: z.number().min(0).max(30).optional() }
const elInput = z.discriminatedUnion('t', [
  z.object({ ...box, t: z.literal('text'), text: z.string().max(2000), font: z.enum(FONT_KEYS as [string, ...string[]]), size: z.number().min(0.5).max(120), color, align: z.enum(['left', 'center', 'right']), track: z.number().min(-0.2).max(2).optional(), lineHeight: z.number().min(0.6).max(4).optional(), upper: z.boolean().optional() }),
  z.object({ ...box, ...paint, t: z.literal('rect'), r: z.number().min(0).max(200).optional(), rot: z.number().min(-360).max(360).optional() }),
  z.object({ ...box, ...paint, t: z.literal('ellipse') }),
  z.object({ ...box, ...paint, t: z.literal('poly'), sides: z.number().int().min(3).max(12), r: z.number().min(0).max(200).optional(), rot: z.number().min(-360).max(360).optional() }),
  z.object({ ...box, t: z.literal('line'), stroke: color, sw: z.number().min(0.05).max(30), dash: z.boolean().optional() }),
  z.object({ ...box, t: z.literal('image'), src, stretch: z.boolean().optional() }),
  z.object({ ...box, t: z.literal('qr'), color }),
])
export const designInput = z.object({
  name: z.string().trim().min(2, 'Give the design a name').max(80),
  design: z.object({ page: z.enum(['landscape', 'portrait']), bg: color, els: z.array(elInput).max(400, 'At most 400 items on one design') }),
})
export type DesignInput = z.input<typeof designInput>

export type DesignRow = { id: string; name: string; branchId: string | null; branch: string | null; design: Design; updatedAt: string; editable: boolean; usedBy: number }

const mayEditDesign = (actor: Actor, branchId: string | null) => can(actor, 'update', 'certdesign') && (actor.role === 'super_admin' || (!!branchId && branchId === actor.branchId))

export async function listDesigns(tx: Tx, actor: Actor): Promise<DesignRow[]> {
  // the designers, and whoever makes events (they pick a design)
  if (!can(actor, 'read', 'certdesign') && !can(actor, 'create', 'event') && !can(actor, 'update', 'event')) throw new Error('Forbidden: read certdesign')
  const rows = (await tx.execute<{ id: string; name: string; branch_id: string | null; branch: string | null; design: Design; updated_at: Date; used_by: number }>(sql`
    select d.id, d.name, d.branch_id, b.name as branch, d.design, d.updated_at, (select count(*)::int from events e where e.design_id = d.id) as used_by
    from certificate_designs d left join branches b on b.id = d.branch_id
    where d.is_active order by d.branch_id nulls first, d.updated_at desc`)).rows
  return rows.map((r) => ({ id: r.id, name: r.name, branchId: r.branch_id, branch: r.branch, design: r.design, updatedAt: new Date(r.updated_at).toISOString(), editable: mayEditDesign(actor, r.branch_id), usedBy: r.used_by }))
}

export async function getDesign(tx: Tx, actor: Actor, id: string): Promise<DesignRow | null> {
  return (await listDesigns(tx, actor)).find((d) => d.id === id) ?? null
}

/** Adds (no id) or changes a design. A new one belongs to the branch being worked in (head office with none: to all). */
export async function saveDesign(tx: Tx, actor: Actor, id: string | null, input: DesignInput) {
  assertCan(actor, 'update', 'certdesign')
  const v = designInput.parse(input)
  if (JSON.stringify(v.design).length > MAX_DESIGN_BYTES) throw new Error('The design is too big (its pictures weigh over 8 MB): use smaller pictures')
  const design = v.design as Design
  if (id) {
    const [cur] = await tx.select({ branchId: certificateDesigns.branchId }).from(certificateDesigns).where(and(eq(certificateDesigns.id, id), eq(certificateDesigns.isActive, true)))
    if (!cur) throw new Error('That design no longer exists')
    if (!mayEditDesign(actor, cur.branchId)) throw new Error('Only head office can change its own designs: save a copy for your branch instead')
    await tx.update(certificateDesigns).set({ name: v.name, design, updatedAt: new Date() }).where(eq(certificateDesigns.id, id))
    await audit(tx, actor, { action: 'update', entity: 'certificate_design', entityId: id, after: { name: v.name } })
    return id
  }
  const [row] = await tx.insert(certificateDesigns).values({ name: v.name, design, branchId: actor.branchId, createdBy: actor.userId }).returning({ id: certificateDesigns.id })
  await audit(tx, actor, { action: 'create', entity: 'certificate_design', entityId: row.id, after: { name: v.name } })
  return row.id
}

/** Takes a design off the list (events already using it keep printing it). */
export async function archiveDesign(tx: Tx, actor: Actor, id: string) {
  const [cur] = await tx.select({ branchId: certificateDesigns.branchId }).from(certificateDesigns).where(eq(certificateDesigns.id, id))
  if (!cur || !mayEditDesign(actor, cur.branchId)) throw new Error('You cannot remove this design')
  await tx.update(certificateDesigns).set({ isActive: false, updatedAt: new Date() }).where(eq(certificateDesigns.id, id))
  await audit(tx, actor, { action: 'delete', entity: 'certificate_design', entityId: id })
}

/**
 * A picture from a link on the internet, for a design: fetched by the server (the page may load pictures only from
 * this site) and handed back as a data: URL, which the editor turns into PNG / JPEG. Only public addresses.
 */
export async function fetchDesignImage(actor: Actor, link: string): Promise<string> {
  assertCan(actor, 'update', 'certdesign')
  let url = new URL(z.string().trim().url('Paste the full link of the picture (https://…)').parse(link))
  // one plain answer for every failure: what an address answered is never passed back
  const failed = () => new Error('The picture could not be fetched from that link: open the picture itself, copy its address and try again')
  for (let hop = 0; hop < 4; hop++) {
    // the address is checked when the connection is made (lib/net-guard.ts), so no link can reach the server's own network
    const res = await publicGet(url, MAX_IMPORT_BYTES).catch(() => { throw failed() })
    if (res.location) { url = new URL(res.location, url); continue }
    if (res.status !== 200 || !res.body) throw failed()
    if (!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml|avif|bmp)$/.test(res.type)) throw new Error('That link is not a picture (open the picture itself and copy its address)')
    return `data:${res.type === 'image/jpg' ? 'image/jpeg' : res.type};base64,${res.body.toString('base64')}`
  }
  throw failed()
}

// ---- Events ------------------------------------------------------------------------------------------------------

const when = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Pick the date and time')
const question = z.object({
  q: z.string().trim().min(2, 'Every question needs its words').max(500),
  options: z.array(z.string().trim().min(1, 'Fill in every option (or remove it)').max(200)).min(2, 'Every question needs at least two options').max(6),
  answer: z.number().int().min(0),
}).refine((x) => x.answer < x.options.length, 'Pick the right option of every question')
export const eventInput = z.object({
  kind: z.enum(Object.keys(EVENT_KINDS) as [EventKind, ...EventKind[]]),
  title: z.string().trim().min(3, 'Give the event a title').max(160),
  description: z.string().trim().max(3000).optional().transform((v) => v || null),
  startsAt: when, endsAt: when.nullish().or(z.literal('')).transform((v) => v || null),
  mode: z.enum(['offline', 'online', 'hybrid']),
  venue: z.string().trim().max(300).optional().transform((v) => v || null),
  speaker: z.string().trim().max(160).optional().transform((v) => v || null),
  askMobile: z.boolean(), askOrg: z.boolean(),
  hasQuiz: z.boolean(),
  quiz: z.array(question).max(100, 'At most 100 questions'),
  passPercent: z.number().int().min(0).max(100),
  quizMinutes: z.number().int().min(1).max(300).nullish(),
  certificate: z.boolean(),
  certFor: z.enum(['all', 'passed']),
  designId: z.string().uuid().nullish(),
  closesAt: when.nullish().or(z.literal('')).transform((v) => v || null),
}).refine((e) => !e.hasQuiz || e.quiz.length > 0, { message: 'Add at least one question, or switch the quiz off', path: ['quiz'] })
  .refine((e) => !e.certificate || !!e.designId, { message: 'Pick the certificate design (make one in Certificate Designs)', path: ['designId'] })
  .refine((e) => !e.endsAt || Date.parse(e.endsAt) >= Date.parse(e.startsAt), { message: 'The event cannot end before it starts', path: ['endsAt'] })
export type EventInput = z.input<typeof eventInput>

export type EventRow = {
  id: string; kind: EventKind; title: string; startsAt: string; endsAt: string | null; mode: keyof typeof EVENT_MODES; venue: string | null; speaker: string | null
  token: string; hasQuiz: boolean; questions: number; certificate: boolean; certFor: 'all' | 'passed'; designId: string | null; design: string | null
  isOpen: boolean; closesAt: string | null; branch: string | null; joined: number; certified: number; passed: number
}
export type EventFull = EventRow & { description: string | null; askMobile: boolean; askOrg: boolean; quiz: QuizQuestion[]; passPercent: number; quizMinutes: number | null }
export type ParticipantRow = {
  id: string; name: string; email: string; mobile: string | null; organisation: string | null; score: number | null; total: number | null; passed: boolean | null
  certNo: string | null; hash: string; mailedAt: string | null; mailError: string | null; createdAt: string
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null)
type EvSql = {
  id: string; kind: EventKind; title: string; description: string | null; starts_at: Date; ends_at: Date | null; mode: keyof typeof EVENT_MODES; venue: string | null; speaker: string | null
  token: string; ask_mobile: boolean; ask_org: boolean; has_quiz: boolean; quiz: QuizQuestion[]; pass_percent: number; quiz_minutes: number | null; certificate: boolean; cert_for: 'all' | 'passed'
  design_id: string | null; design: string | null; is_open: boolean; closes_at: Date | null; branch: string | null; joined: number; certified: number; passed: number
}
const eventSql = (where: ReturnType<typeof sql>) => sql`
  select e.*, d.name as design, b.name as branch,
    (select count(*)::int from event_participants p where p.event_id = e.id) as joined,
    (select count(*)::int from event_participants p where p.event_id = e.id and p.cert_no is not null) as certified,
    (select count(*)::int from event_participants p where p.event_id = e.id and p.passed) as passed
  from events e left join certificate_designs d on d.id = e.design_id left join branches b on b.id = e.branch_id
  where ${where}`
const toFull = (r: EvSql): EventFull => ({
  id: r.id, kind: r.kind, title: r.title, description: r.description, startsAt: iso(r.starts_at)!, endsAt: iso(r.ends_at), mode: r.mode, venue: r.venue, speaker: r.speaker,
  token: r.token, askMobile: r.ask_mobile, askOrg: r.ask_org, hasQuiz: r.has_quiz, quiz: r.quiz, questions: r.quiz.length, passPercent: r.pass_percent, quizMinutes: r.quiz_minutes,
  certificate: r.certificate, certFor: r.cert_for, designId: r.design_id, design: r.design, isOpen: r.is_open, closesAt: iso(r.closes_at), branch: r.branch,
  joined: r.joined, certified: r.certified, passed: r.passed,
})

export async function listEvents(tx: Tx, actor: Actor): Promise<EventRow[]> {
  assertCan(actor, 'read', 'event')
  const rows = (await tx.execute<EvSql>(sql`${eventSql(sql`true`)} order by e.starts_at desc limit 500`)).rows
  // the list leaves out the questions
  return rows.map((r) => { const { quiz: _q, description: _d, askMobile: _m, askOrg: _o, passPercent: _p, quizMinutes: _t, ...row } = toFull(r); return row })
}

export async function getEvent(tx: Tx, actor: Actor, id: string): Promise<{ event: EventFull; participants: ParticipantRow[] } | null> {
  assertCan(actor, 'read', 'event')
  const [r] = (await tx.execute<EvSql>(eventSql(sql`e.id = ${id}::uuid`))).rows
  if (!r) return null
  const ps = await tx.select().from(eventParticipants).where(eq(eventParticipants.eventId, id)).orderBy(desc(eventParticipants.createdAt))
  return {
    event: toFull(r),
    participants: ps.map((p) => ({ id: p.id, name: p.name, email: p.email, mobile: p.mobile, organisation: p.organisation, score: p.score, total: p.total, passed: p.passed, certNo: p.certNo, hash: p.hash, mailedAt: iso(p.mailedAt), mailError: p.mailError, createdAt: iso(p.createdAt)! })),
  }
}

const newToken = () => randomBytes(8).toString('base64url')

async function assertDesign(tx: Tx, designId: string | null | undefined) {
  if (!designId) return
  const [d] = await tx.select({ id: certificateDesigns.id }).from(certificateDesigns).where(and(eq(certificateDesigns.id, designId), eq(certificateDesigns.isActive, true)))
  if (!d) throw new Error('That certificate design is not available any more: pick another')
}
const values = (v: z.output<typeof eventInput>) => ({
  kind: v.kind, title: v.title, description: v.description, startsAt: new Date(v.startsAt), endsAt: v.endsAt ? new Date(v.endsAt) : null, mode: v.mode, venue: v.venue, speaker: v.speaker,
  askMobile: v.askMobile, askOrg: v.askOrg, hasQuiz: v.hasQuiz, quiz: v.hasQuiz ? v.quiz : [], passPercent: v.passPercent, quizMinutes: v.hasQuiz ? v.quizMinutes ?? null : null,
  certificate: v.certificate, certFor: v.hasQuiz ? v.certFor : 'all' as const, designId: v.certificate ? v.designId ?? null : null, closesAt: v.closesAt ? new Date(v.closesAt) : null,
})

export async function createEvent(tx: Tx, actor: Actor, input: EventInput) {
  assertCan(actor, 'create', 'event')
  const v = eventInput.parse(input)
  await assertDesign(tx, v.designId)
  const [row] = await tx.insert(events).values({ ...values(v), branchId: actor.branchId, token: newToken(), createdBy: actor.userId }).returning({ id: events.id })
  await audit(tx, actor, { action: 'create', entity: 'event', entityId: row.id, after: { title: v.title, kind: v.kind } })
  return row.id
}

export async function updateEvent(tx: Tx, actor: Actor, id: string, input: EventInput) {
  assertCan(actor, 'update', 'event')
  const v = eventInput.parse(input)
  await assertDesign(tx, v.designId)
  const [cur] = (await tx.execute<{ joined: number; quiz: QuizQuestion[]; has_quiz: boolean }>(sql`
    select e.quiz, e.has_quiz, (select count(*)::int from event_participants p where p.event_id = e.id) as joined from events e where e.id = ${id}::uuid`)).rows
  if (!cur) throw new Error('That event no longer exists')
  // once people have answered, the questions stay as they were (their scores are against them)
  const same = (a: QuizQuestion[]) => JSON.stringify(a.map((x) => [x.q, x.options, x.answer]))
  if (cur.joined && (cur.has_quiz !== v.hasQuiz || same(cur.quiz) !== same(v.hasQuiz ? v.quiz : []))) throw new Error(`${cur.joined} people have already taken part: the quiz can no longer change`)
  await tx.update(events).set({ ...values(v), updatedAt: new Date() }).where(eq(events.id, id))
  await audit(tx, actor, { action: 'update', entity: 'event', entityId: id, after: { title: v.title } })
}

/** Opens or closes the event's sign-ups (live on its public page at once). */
export async function setEventOpen(tx: Tx, actor: Actor, id: string, open: boolean) {
  assertCan(actor, 'update', 'event')
  const r = await tx.update(events).set({ isOpen: open, updatedAt: new Date() }).where(eq(events.id, id)).returning({ id: events.id })
  if (!r.length) throw new Error('That event no longer exists')
  await audit(tx, actor, { action: open ? 'open' : 'close', entity: 'event', entityId: id })
}

const nextCertNo = (tx: Tx) => nextOrgNo(tx, 'EVC')

/** Whether this participant earns a certificate now. */
const earns = (e: { certificate: boolean; designId: string | null; hasQuiz: boolean; certFor: string }, passed: boolean | null) =>
  e.certificate && !!e.designId && (!e.hasQuiz || e.certFor === 'all' || passed === true)

/**
 * Staff: issues the certificate to a participant who earns one but has none yet (the design was added later, say)
 * and returns the participant to e-mail it to again.
 */
export async function issueParticipantCertificate(tx: Tx, actor: Actor, participantId: string) {
  assertCan(actor, 'update', 'event')
  const [p] = await tx.select({ id: eventParticipants.id, certNo: eventParticipants.certNo, passed: eventParticipants.passed, eventId: eventParticipants.eventId }).from(eventParticipants).where(eq(eventParticipants.id, participantId))
  if (!p) throw new Error('That participant is not in this branch')
  if (!p.certNo) {
    const [e] = await tx.select().from(events).where(eq(events.id, p.eventId))
    if (!e || !earns(e, p.passed)) throw new Error(!e?.certificate || !e.designId ? 'This event gives no certificate (or has no design): set one in Edit' : 'They did not pass the quiz, so no certificate')
    await tx.update(eventParticipants).set({ certNo: await nextCertNo(tx) }).where(eq(eventParticipants.id, p.id))
  }
  await audit(tx, actor, { action: 'resend', entity: 'event_participant', entityId: p.id })
  return p.id
}

// ---- The public page ------------------------------------------------------------------------------------------------

export type PublicEvent = {
  token: string; kind: EventKind; kindLabel: string; title: string; description: string | null; startsAt: string; endsAt: string | null; mode: keyof typeof EVENT_MODES
  venue: string | null; speaker: string | null; branch: string; askMobile: boolean; askOrg: boolean
  quiz: { q: string; options: string[] }[]; passPercent: number; quizMinutes: number | null; certificate: boolean; certFor: 'all' | 'passed'
  open: boolean; why: string | null
}

/** The event as its public page shows it (no answers), or null for an unknown link. */
export async function publicEvent(orgId: string, token: string): Promise<PublicEvent | null> {
  return withOrgSystem(orgId, (tx) => publicEventIn(tx, token))
}
export async function publicEventIn(tx: Tx, token: string): Promise<PublicEvent | null> {
  if (!/^[\w-]{6,40}$/.test(token)) return null
  const [e] = (await tx.execute<EvSql>(eventSql(sql`e.token = ${token}`))).rows
  if (!e) return null
  const closed = !e.is_open ? 'Sign-ups for this event are closed.' : e.closes_at && new Date(e.closes_at) < new Date() ? 'Sign-ups for this event have closed.' : null
  return {
    token: e.token, kind: e.kind, kindLabel: EVENT_KINDS[e.kind], title: e.title, description: e.description, startsAt: iso(e.starts_at)!, endsAt: iso(e.ends_at), mode: e.mode,
    venue: e.venue, speaker: e.speaker, branch: e.branch ?? 'techcadd', askMobile: e.ask_mobile, askOrg: e.ask_org,
    quiz: e.has_quiz ? e.quiz.map((x) => ({ q: x.q, options: x.options })) : [], passPercent: e.pass_percent, quizMinutes: e.quiz_minutes,
    certificate: e.certificate && !!e.design_id, certFor: e.cert_for, open: !closed, why: closed,
  }
}

// The quiz's time limit, kept by the server: opening the quiz gives a ticket (when it started, signed), and answers
// sent after the limit (plus a minute for a slow connection) are refused.
const ticketSig = (token: string, at: number) => createHmac('sha256', serverSecret('AUTH_SECRET')).update(`quiz|${token}|${at}`).digest('base64url')
export const quizTicket = (token: string, at = Date.now()) => `${at}.${ticketSig(token, at)}`
function ticketStart(token: string, ticket: string | undefined): number | null {
  const m = /^(\d{10,15})\.([\w-]{43})$/.exec(ticket ?? '')
  if (!m) return null
  const at = Number(m[1]), want = Buffer.from(ticketSig(token, at)), got = Buffer.from(m[2])
  return want.length === got.length && timingSafeEqual(want, got) && at <= Date.now() + 5000 ? at : null
}

export const joinInput = z.object({
  // a name only (letters of any language, spaces, . ' -): no links, e-mail addresses or markup reach the mail or the certificate
  name: z.string().trim().min(2, 'Enter your full name').max(80).regex(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, 'Enter your name as it should be printed (letters only)').transform((v) => v.replace(/\s+/g, ' ')),
  email: z.string().trim().toLowerCase().email('Enter a valid e-mail address').max(160),
  mobile: z.string().trim().max(20).optional().transform((v) => v || null).refine((v) => !v || /^\+?[\d\s-]{10,16}$/.test(v), 'Enter a valid mobile number'),
  organisation: z.string().trim().max(160).optional().transform((v) => v || null).refine((v) => !v || !/:\/\/|www\.|@|[<>{}]/i.test(v), 'Enter the college or company name only'),
  answers: z.array(z.number().int().min(-1).max(10)).max(100).default([]),
  ticket: z.string().max(100).optional(), // from quizTicket, when the event's quiz has a time limit
})
export type JoinInput = z.input<typeof joinInput>
export type JoinResult = { participantId: string; hash: string; name: string; score: number | null; total: number | null; passed: boolean | null; certNo: string | null; already: boolean; mail: boolean }

/** Signs someone up (and marks their quiz). One try per e-mail: a second one is told so, and learns nothing else. */
export async function joinEvent(orgId: string, token: string, input: JoinInput, ip: string | null): Promise<JoinResult> {
  return withOrgSystem(orgId, (tx) => joinEventIn(tx, token, input, ip))
}
export async function joinEventIn(tx: Tx, token: string, input: JoinInput, ip: string | null): Promise<JoinResult> {
  const v = joinInput.parse(input)
  const [e] = await tx.select().from(events).where(eq(events.token, token)).for('update')
  if (!e) throw new Error('This event link is not valid')
  const [had] = await tx.select().from(eventParticipants).where(and(eq(eventParticipants.eventId, e.id), sql`lower(${eventParticipants.email}) = ${v.email}`))
  // closed first: a closed event says nothing about who took part
  if (!e.isOpen || (e.closesAt && e.closesAt < new Date())) throw new Error('Sign-ups for this event are closed')
  // the same e-mail again: nothing about the first try comes back (whoever types someone else's e-mail must not see their
  // name, score or certificate); the certificate went to that inbox
  if (had) return { participantId: '', hash: '', name: v.name, score: null, total: null, passed: null, certNo: null, already: true, mail: false }
  if (e.askMobile && !v.mobile) throw new Error('Enter your mobile number')
  let score: number | null = null, total: number | null = null, passed: boolean | null = null
  if (e.hasQuiz && e.quizMinutes) {
    const at = ticketStart(token, v.ticket)
    if (at === null) throw new Error('Start the quiz from the event page')
    if (Date.now() - at > e.quizMinutes * 60_000 + 60_000) throw new Error('Time is up for this quiz: the answers came in after the time limit')
  }
  if (e.hasQuiz) {
    total = e.quiz.length
    score = e.quiz.reduce((n, q, i) => n + (v.answers[i] === q.answer ? 1 : 0), 0)
    passed = total ? (score * 100) / total >= e.passPercent : true
  }
  const certNo = earns(e, passed) ? await nextCertNo(tx) : null
  const [row] = await tx.insert(eventParticipants).values({
    eventId: e.id, branchId: e.branchId, name: v.name, email: v.email, mobile: v.mobile, organisation: e.askOrg ? v.organisation : null,
    answers: e.hasQuiz ? e.quiz.map((_, i) => v.answers[i] ?? -1) : null, score, total, passed, certNo, hash: randomBytes(16).toString('hex'), ip,
  }).returning()
  return { participantId: row.id, hash: row.hash, name: row.name, score, total, passed, certNo, already: false, mail: !!certNo }
}

// ---- The certificate -------------------------------------------------------------------------------------------------

export type EventCertificate = { name: string; certNo: string; event: string; design: Design; values: Record<DesignField, string> }

/** A participant's certificate (its design and what fills it), by the code of its page; null when there is none. */
export async function eventCertificate(orgId: string, hash: string): Promise<EventCertificate | null> {
  return withOrgSystem(orgId, (tx) => eventCertificateIn(tx, hash))
}
export async function eventCertificateIn(tx: Tx, hash: string): Promise<EventCertificate | null> {
  if (!/^[0-9a-f]{32}$/.test(hash)) return null
  const [r] = (await tx.execute<{ name: string; organisation: string | null; score: number | null; total: number | null; cert_no: string | null; created_at: Date; kind: EventKind; title: string; starts_at: Date; venue: string | null; speaker: string | null; branch: string | null; design: Design | null }>(sql`
    select p.name, p.organisation, p.score, p.total, p.cert_no, p.created_at, e.kind, e.title, e.starts_at, e.venue, e.speaker, b.name as branch, d.design
    from event_participants p join events e on e.id = p.event_id left join branches b on b.id = e.branch_id left join certificate_designs d on d.id = e.design_id
    where p.hash = ${hash}`)).rows
  if (!r?.cert_no || !r.design) return null
  const pct = r.total ? `${Math.round(((r.score ?? 0) * 100) / r.total)}%` : ''
  return {
    name: r.name, certNo: r.cert_no, event: r.title, design: r.design,
    values: {
      name: r.name, event: r.title, kind: EVENT_KINDS[r.kind], date: fmtCertDate(new Date(r.starts_at).toISOString()), venue: r.venue ?? '', speaker: r.speaker ?? '',
      organisation: r.organisation ?? '', score: r.total ? `${r.score} / ${r.total}` : '', percent: pct, cert_no: r.cert_no,
      issued: fmtCertDate(new Date(r.created_at).toISOString()), branch: r.branch ?? 'techcadd',
    },
  }
}

/** The certificate e-mail for a participant (the words from Message Templates), or null when they have no certificate. */
export async function eventCertificateMail(orgId: string, participantId: string, origin: string) {
  return withOrgSystem(orgId, async (tx) => {
    const [r] = (await tx.execute<{ name: string; email: string; cert_no: string | null; hash: string; score: number | null; total: number | null; kind: EventKind; title: string; starts_at: Date; branch_id: string | null; branch: string | null }>(sql`
      select p.name, p.email, p.cert_no, p.hash, p.score, p.total, e.kind, e.title, e.starts_at, e.branch_id, b.name as branch
      from event_participants p join events e on e.id = p.event_id left join branches b on b.id = e.branch_id where p.id = ${participantId}::uuid`)).rows
    if (!r?.cert_no || !r.email.includes('@')) return null
    const t = await resolveTemplate(tx, 'event_certificate_email', r.branch_id)
    const vars = {
      first_name: r.name.split(/\s+/)[0], name: r.name, event: r.title, kind: EVENT_KINDS[r.kind].toLowerCase(), date: fmtCertDate(new Date(r.starts_at).toISOString()), cert_no: r.cert_no,
      score_line: r.total ? `You scored ${r.score} out of ${r.total} in the quiz.` : '', branch: r.branch ?? 'techcadd',
      certificate_link: mailButton('View / download certificate', `${origin}/e/c/${r.hash}`),
    }
    return { to: r.email, branchId: r.branch_id, subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n') }
  })
}

/** Notes how the certificate e-mail went. */
export async function markMailed(orgId: string, participantId: string, error: string | null) {
  await withOrgSystem(orgId, (tx) => tx.update(eventParticipants).set(error ? { mailError: error.slice(0, 300) } : { mailedAt: new Date(), mailError: null }).where(eq(eventParticipants.id, participantId)))
}
