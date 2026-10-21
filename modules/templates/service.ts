// Message templates: the words the panel sends or shows, editable without a code change. Head office writes the
// default for every branch; a branch manager may write their branch's own version (it wins there) or go back to the
// default. Each template has fixed placeholders, e.g. {{first_name}}, filled in when it is used. Announcements have a
// list of ready-made texts to start a new announcement from.
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import type { Actor, Tx } from '@/lib/db/withTenant'
import { can } from '@/lib/auth/permissions'
import { plainText } from '@/lib/notify/layout'
import { brandIn } from '@/lib/brand'

export type TemplateKey = 'birthday_email' | 'birthday_card' | 'certificate_email' | 'ticket_reply_email' | 'help_request_email' | 'help_chosen_email' | 'event_certificate_email'
type Def = { label: string; about: string; subjectLabel: string; bodyLabel: string; vars: Record<string, string>; subject: string; body: string }

export const TEMPLATES: Record<TemplateKey, Def> = {
  birthday_email: {
    label: 'Birthday e-mail', about: 'Sent to each active student on their birthday (with the morning fee reminders). It goes out in a festive layout with balloons and the institute’s logo.',
    subjectLabel: 'Subject', bodyLabel: 'Message', vars: { institute: 'Institute name', first_name: 'First name', name: 'Full name', branch: 'Branch name', age: 'Age reached today' },
    subject: 'Happy Birthday, {{first_name}}! 🎉',
    body: `Dear {{first_name}},

Everyone at {{branch}} wishes you a very happy birthday! May this year bring you new skills, big wins and lots of happiness.

Keep shining, keep growing — we are proud to be a part of your journey. 🌟

Warm wishes,
Team {{institute}}`,
  },
  birthday_card: {
    label: 'Birthday card (student portal)', about: 'The card in the middle of the balloons when a student opens their portal on their birthday.',
    subjectLabel: 'Heading', bodyLabel: 'Message', vars: { institute: 'Institute name', first_name: 'First name', branch: 'Branch name', age: 'Age reached today' },
    subject: 'Happy Birthday, {{first_name}}!',
    body: 'Wishing you a fantastic day and a year full of learning, success and happiness. Keep shining — we are proud to be part of your journey!',
  },
  certificate_email: {
    label: 'Certificate issued e-mail', about: 'Sent to the student as soon as their course certificate is issued, with the links to view, download and verify it.',
    subjectLabel: 'Subject', bodyLabel: 'Message',
    vars: { institute: 'Institute name', first_name: 'First name', course: 'Course', cert_no: 'Certificate number', branch: 'Branch name', certificate_link: 'Button to view / download the certificate', project_link: 'Button for the project certificate (empty when there is none)', verify_link: 'Button to the public verification page' },
    subject: 'Congratulations {{first_name}}! Your {{institute}} certificate is ready 🎓',
    body: `Dear {{first_name}},

Congratulations on completing {{course}}! 🎉

Your certificate {{cert_no}} has been issued by {{branch}}.

{{certificate_link}} {{project_link}}

Anyone (an employer, a college) can check it is genuine:
{{verify_link}}

You can also find it any time in your student portal (Documents).

We wish you every success ahead!

Team {{institute}}`,
  },
  ticket_reply_email: {
    label: 'Help desk reply e-mail', about: 'Sent to a student when the branch answers their help desk ticket.',
    subjectLabel: 'Subject', bodyLabel: 'Message', vars: { institute: 'Institute name', first_name: 'First name', ticket_no: 'Ticket number', reply: 'The reply written', branch: 'Branch name' },
    subject: '{{institute}} — reply to your ticket {{ticket_no}}',
    body: `Dear {{first_name}},

Your ticket {{ticket_no}} has a reply:

{{reply}}

Sign in to your student portal (Help) to read it or answer.

- {{institute}}`,
  },
  help_request_email: {
    label: 'Trainer e-mail: a student asks for help', about: 'Sent to the trainers when a student asks for project or study help.',
    subjectLabel: 'Subject', bodyLabel: 'Message',
    vars: { institute: 'Institute name', trainer: 'Trainer name', student: 'Student, course and branch', kind: 'Kind of help', request_no: 'Request number', title: 'Request title', details: 'What the student wrote', link: 'Button to Project Help' },
    subject: '{{institute}} — a student asks for help: {{title}}',
    body: `Dear {{trainer}},

{{student}} asks for help ({{kind}}), {{request_no}}:

{{title}}

{{details}}

If you can help, offer it in Project Help:
{{link}}
The student chooses one of the trainers who offered.

- {{institute}}`,
  },
  help_chosen_email: {
    label: 'Trainer e-mail: chosen by the student', about: 'Sent to the trainer a student picks for their help request.',
    subjectLabel: 'Subject', bodyLabel: 'Message', vars: { institute: 'Institute name', trainer: 'Trainer name', student: 'Student, course and branch', request_no: 'Request number', title: 'Request title', link: 'Button to Project Help' },
    subject: '{{institute}} — you were chosen for {{request_no}}',
    body: `Dear {{trainer}},

{{student}} chose you to help with {{request_no}}: {{title}}

Their e-mail is in Project Help:
{{link}}

Mark it done there once you have helped.

- {{institute}}`,
  },
  event_certificate_email: {
    label: 'Seminar / workshop certificate e-mail', about: 'Sent to each participant of a seminar, workshop or other event as soon as their certificate is ready (after the quiz, when the event has one).',
    subjectLabel: 'Subject', bodyLabel: 'Message',
    vars: { institute: 'Institute name', first_name: 'First name', name: 'Full name', event: 'Event title', kind: 'Seminar, Workshop…', date: 'Event date', cert_no: 'Certificate number', score_line: 'The quiz score sentence (empty when there was no quiz)', branch: 'Branch name', certificate_link: 'Button to view / download the certificate' },
    subject: 'Your certificate for {{event}} 🎓',
    body: `Dear {{first_name}},

Thank you for joining our {{kind}} “{{event}}” on {{date}}. {{score_line}}

Your certificate {{cert_no}} is ready:

{{certificate_link}}

Anyone can check it is genuine by scanning the QR code on it.

We hope to see you again soon!

Team {{institute}}`,
  },
}
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[]

/** Ready-made announcements every branch starts with (head office and branches add their own). */
export const DEFAULT_ANNOUNCEMENTS = [
  { title: 'Holiday notice', body: 'The institute will remain closed on [date] for [festival/occasion]. Classes resume on [date]. Happy holidays!' },
  { title: 'Fee reminder', body: 'A gentle reminder: fee installments due this month should be paid by [date] at the branch office. Thank you!' },
  { title: 'Test schedule', body: 'The [course] test will be held on [date] at [time]. Please revise the topics covered so far and be on time. All the best!' },
  { title: 'Workshop / seminar', body: 'Join our free workshop on [topic] on [date] at [time]. Seats are limited — register at the front desk.' },
]

/** The placeholders the panel itself fills with a mail button (never with anything a person typed). */
const BUTTON_VARS = ['link', 'certificate_link', 'project_link', 'verify_link']
/** Fills {{placeholders}}; unknown ones are left as they are. Every value is plain text except the panel's buttons. */
export const fillTemplate = (text: string, vars: Record<string, string | number | null | undefined>) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (vars[k] == null ? m : BUTTON_VARS.includes(k) ? String(vars[k]) : plainText(String(vars[k]))))

export const canEditTemplates = (a: Actor) => can(a, 'update', 'template')

/** The words to use in a branch: its own version, else head office's, else the built-in one. */
export async function resolveTemplate(tx: Tx, key: TemplateKey, branchId: string | null): Promise<{ subject: string; body: string }> {
  const rows = (await tx.execute<{ branch_id: string | null; subject: string | null; body: string }>(sql`
    select branch_id, subject, body from message_templates where key = ${key} and (branch_id is null ${branchId ? sql`or branch_id = ${branchId}::uuid` : sql``})`)).rows
  const own = rows.find((r) => r.branch_id && r.branch_id === branchId), def = rows.find((r) => !r.branch_id)
  const r = own ?? def
  // {{institute}} is the org's own name, in every template
  const { name } = await brandIn(tx), named = (t: string) => fillTemplate(t, { institute: name })
  return { subject: named(r?.subject ?? TEMPLATES[key].subject), body: named(r?.body ?? TEMPLATES[key].body) }
}

export type TemplateView = {
  key: TemplateKey; label: string; about: string; subjectLabel: string; bodyLabel: string; vars: Record<string, string>
  subject: string; body: string
  /** where the words in use come from, for the branch being edited */
  source: 'branch' | 'default' | 'built-in'
  /** what the branch would go back to */
  fallback: { subject: string; body: string }
  updatedBy: string | null; updatedAt: string | null
}
export type AnnouncementTemplate = { id: string | null; title: string; body: string; branchWide: boolean }

/** The editor: every template as the branch (or head office's default, when no branch is picked) has it. */
export async function templatesForEditor(tx: Tx, actor: Actor): Promise<{ scope: 'branch' | 'default'; templates: TemplateView[]; announcements: AnnouncementTemplate[] }> {
  if (!canEditTemplates(actor)) throw new Error('Only head office or a branch manager edits templates')
  const b = actor.branchId
  const rows = (await tx.execute<{ id: string; key: string; branch_id: string | null; title: string | null; subject: string | null; body: string; by: string | null; updated_at: string }>(sql`
    select t.id, t.key, t.branch_id, t.title, t.subject, t.body, u.name as by, t.updated_at from message_templates t left join users u on u.id = t.updated_by
    where t.branch_id is null ${b ? sql`or t.branch_id = ${b}::uuid` : sql``} order by t.created_at`)).rows
  const templates = TEMPLATE_KEYS.map((key) => {
    const d = TEMPLATES[key]
    const def = rows.find((r) => r.key === key && !r.branch_id), own = b ? rows.find((r) => r.key === key && r.branch_id === b) : undefined
    const fallback = b ? { subject: def?.subject ?? d.subject, body: def?.body ?? d.body } : { subject: d.subject, body: d.body }
    const cur = own ?? def
    return {
      key, label: d.label, about: d.about, subjectLabel: d.subjectLabel, bodyLabel: d.bodyLabel, vars: d.vars,
      subject: cur?.subject ?? d.subject, body: cur?.body ?? d.body, source: own ? 'branch' : def ? 'default' : 'built-in', fallback,
      updatedBy: cur?.by ?? null, updatedAt: cur ? new Date(cur.updated_at).toISOString() : null,
    } as TemplateView
  })
  return { scope: b ? 'branch' : 'default', templates, announcements: await announcementTemplates(tx, b, rows) }
}

/** Ready-made announcements for a branch: head office's (or the built-in ones while it has none) and the branch's own. */
export async function announcementTemplates(tx: Tx, branchId: string | null, pre?: { id: string; key: string; branch_id: string | null; title: string | null; body: string }[]): Promise<AnnouncementTemplate[]> {
  const rows = pre ?? (await tx.execute<{ id: string; key: string; branch_id: string | null; title: string | null; body: string }>(sql`
    select id, key, branch_id, title, body from message_templates where key = 'announcement' and (branch_id is null ${branchId ? sql`or branch_id = ${branchId}::uuid` : sql``}) order by created_at`)).rows
  const list = rows.filter((r) => r.key === 'announcement')
  const defaults = list.filter((r) => !r.branch_id)
  return [
    ...(defaults.length ? defaults.map((r) => ({ id: r.id, title: r.title ?? 'Announcement', body: r.body, branchWide: false })) : DEFAULT_ANNOUNCEMENTS.map((a) => ({ id: null, ...a, branchWide: false }))),
    ...list.filter((r) => r.branch_id).map((r) => ({ id: r.id, title: r.title ?? 'Announcement', body: r.body, branchWide: true })),
  ]
}

const saveInput = z.object({
  key: z.enum(TEMPLATE_KEYS as [TemplateKey, ...TemplateKey[]]),
  subject: z.string().trim().min(2, 'Write the subject / heading').max(200),
  body: z.string().trim().min(5, 'Write the message').max(5000),
})

/** Saves the template for the branch being worked in (head office with no branch picked: the default for all). */
export async function saveTemplate(tx: Tx, actor: Actor, raw: z.input<typeof saveInput>) {
  if (!canEditTemplates(actor)) throw new Error('Only head office or a branch manager edits templates')
  const v = saveInput.parse(raw)
  const b = actor.branchId ?? null
  const [cur] = (await tx.execute<{ id: string }>(sql`select id from message_templates where key = ${v.key} and branch_id is not distinct from ${b}::uuid`)).rows
  if (cur) await tx.execute(sql`update message_templates set subject = ${v.subject}, body = ${v.body}, updated_by = ${actor.userId}, updated_at = now() where id = ${cur.id}`)
  else await tx.execute(sql`insert into message_templates (key, branch_id, subject, body, updated_by) values (${v.key}, ${b}::uuid, ${v.subject}, ${v.body}, ${actor.userId})`)
  await audit(tx, actor, { action: 'update', entity: 'message_template', after: { key: v.key, branchId: b } })
}

/** Back to what it falls back on: a branch to head office's default, head office's default to the built-in words. */
export async function resetTemplate(tx: Tx, actor: Actor, key: string) {
  if (!canEditTemplates(actor)) throw new Error('Only head office or a branch manager edits templates')
  const k = z.enum(TEMPLATE_KEYS as [TemplateKey, ...TemplateKey[]]).parse(key)
  await tx.execute(sql`delete from message_templates where key = ${k} and branch_id is not distinct from ${actor.branchId ?? null}::uuid`)
  await audit(tx, actor, { action: 'reset', entity: 'message_template', after: { key: k, branchId: actor.branchId ?? null } })
}

const annInput = z.object({ id: z.string().uuid().nullable().optional(), title: z.string().trim().min(2, 'Give it a name').max(150), body: z.string().trim().min(3, 'Write the announcement').max(5000) })

/** Adds or changes a ready-made announcement (head office with no branch picked: for every branch). */
export async function saveAnnouncementTemplate(tx: Tx, actor: Actor, raw: z.input<typeof annInput>) {
  if (!canEditTemplates(actor)) throw new Error('Only head office or a branch manager edits templates')
  const v = annInput.parse(raw)
  const b = actor.branchId ?? null
  // head office's first change turns the built-in list into its own, so nothing disappears
  if (!b) {
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from message_templates where key = 'announcement' and branch_id is null`)).rows
    if (!n && !v.id) for (const a of DEFAULT_ANNOUNCEMENTS) await tx.execute(sql`insert into message_templates (key, branch_id, title, body, updated_by) values ('announcement', null, ${a.title}, ${a.body}, ${actor.userId})`)
  }
  if (v.id) {
    const [r] = (await tx.execute<{ id: string }>(sql`update message_templates set title = ${v.title}, body = ${v.body}, updated_by = ${actor.userId}, updated_at = now()
      where id = ${v.id} and key = 'announcement' and branch_id is not distinct from ${b}::uuid returning id`)).rows
    if (!r) throw new Error(b ? 'A branch changes only its own ready-made announcements' : 'Template not found')
  } else {
    await tx.execute(sql`insert into message_templates (key, branch_id, title, body, updated_by) values ('announcement', ${b}::uuid, ${v.title}, ${v.body}, ${actor.userId})`)
  }
  await audit(tx, actor, { action: 'update', entity: 'announcement_template', after: { title: v.title, branchId: b } })
}

export async function deleteAnnouncementTemplate(tx: Tx, actor: Actor, id: string) {
  if (!canEditTemplates(actor)) throw new Error('Only head office or a branch manager edits templates')
  const [r] = (await tx.execute<{ id: string }>(sql`delete from message_templates where id = ${z.string().uuid().parse(id)} and key = 'announcement' and branch_id is not distinct from ${actor.branchId ?? null}::uuid returning id`)).rows
  if (!r) throw new Error(actor.branchId ? 'A branch removes only its own ready-made announcements' : 'Template not found')
}
