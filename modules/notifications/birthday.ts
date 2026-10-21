// Birthday wishes. Each morning (with the fee reminders job) every active student whose birthday it is gets a
// birthday e-mail — once a year per e-mail address, whatever the number of runs — and on that day the student
// portal opens with a celebration. Born on 29 February: celebrated on 28 February in other years. Dates in India time.
import { sql } from 'drizzle-orm'
import { notifications } from '@/lib/db/schema'
import type { Tx } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { fillTemplate, resolveTemplate } from '@/modules/templates/service'

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** Is `today` (YYYY-MM-DD) this date of birth's birthday? */
export function isBirthday(dob: string | null | undefined, today = todayIST()) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return false
  const md = dob.slice(5, 10), t = today.slice(5, 10)
  if (md === t) return true
  return md === '02-29' && t === '02-28' && !leap(Number(today.slice(0, 4)))
}

/** The age reached today (null when the date of birth looks wrong). */
export function ageOn(dob: string, today = todayIST()) {
  const age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) - (today.slice(5, 10) < dob.slice(5, 10) && !isBirthday(dob, today) ? 1 : 0)
  return age > 0 && age < 120 ? age : null
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The festive mail body around the template's message (it goes inside the usual frame: the institute's logo on top, the do-not-reply note below). */
export function birthdayHtml(firstName: string, message: string) {
  const name = esc(firstName)
  const dot = (c: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin:0 4px"></span>`
  const paras = esc(message.trim()).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('')
  return `
<div style="text-align:center;font-size:44px;line-height:1.1;letter-spacing:6px">🎈🎉🎂🎁🎈</div>
<div style="margin:18px 0 6px;text-align:center">${['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'].map(dot).join('')}</div>
<h1 style="margin:10px 0 4px;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;color:#1a1f71">Happy Birthday, ${name}!</h1>
<p style="margin:0 0 22px;text-align:center;font-size:16px;color:#e11d48;font-weight:bold">Wishing you a day as wonderful as you are</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fff1f2,#eef2ff);background-color:#fdf2f8;border-radius:14px">
<tr><td style="padding:22px 24px;font-size:15px;line-height:1.6;color:#1f2433">${paras}</td></tr></table>
<p style="margin:24px 0 0;text-align:center;font-size:30px">🥳</p>`
}

/**
 * Queues today's birthday e-mails: students with an active or on-hold registration, a date of birth and an e-mail.
 * Safe to run any number of times: one wish per e-mail address per year (the dedupe key).
 */
export async function queueBirthdayWishes(tx: Tx, today = todayIST()) {
  const year = today.slice(0, 4)
  const md = today.slice(5, 10)
  const feb28 = md === '02-28' && !leap(Number(year))
  const rows = (await tx.execute<{ person_id: string; branch_id: string; registration_id: string; first_name: string; last_name: string | null; dob: string | null; email: string; branch: string }>(sql`
    select distinct on (lower(p.email)) p.id as person_id, p.branch_id, r.id as registration_id, p.first_name, p.last_name, p.dob::text as dob, p.email, b.name as branch
    from persons p join registrations r on r.person_id = p.id and r.status in ('active', 'on_hold') and r.deleted_at is null
      join branches b on b.id = p.branch_id
    where p.deleted_at is null and p.email is not null and p.email like '%@%' and p.dob is not null
      and (to_char(p.dob, 'MM-DD') = ${md} ${feb28 ? sql`or to_char(p.dob, 'MM-DD') = '02-29'` : sql``})
    order by lower(p.email), r.created_at desc`)).rows
  let queued = 0
  const words = new Map<string, { subject: string; body: string }>() // the branch's template, read once per branch
  for (const r of rows) {
    if (!words.has(r.branch_id)) words.set(r.branch_id, await resolveTemplate(tx, 'birthday_email', r.branch_id))
    const t = words.get(r.branch_id)!
    const vars = { first_name: r.first_name, name: [r.first_name, r.last_name].filter(Boolean).join(' '), branch: r.branch, age: r.dob ? ageOn(r.dob, today) : null }
    const body = fillTemplate(t.body, vars)
    const inserted = await tx.insert(notifications).values({
      branchId: r.branch_id, personId: r.person_id, registrationId: r.registration_id, channel: 'email', template: 'birthday', toAddress: r.email, subject: fillTemplate(t.subject, vars),
      body, html: birthdayHtml(r.first_name, body), dedupeKey: `bday:${r.email.toLowerCase()}:${year}`,
    }).onConflictDoNothing({ target: notifications.dedupeKey }).returning({ id: notifications.id })
    queued += inserted.length
  }
  return { birthdays: rows.length, birthdayQueued: queued }
}

export type TodaysBirthday = { registrationId: string; regNo: string; name: string; firstName: string; phone: string; course: string | null; branch: string; age: number | null }

/** Students of the branch (head office: every branch, or the one picked) whose birthday is today, for the staff pop-up. */
export async function todaysBirthdays(tx: Tx, today = todayIST()): Promise<TodaysBirthday[]> {
  const md = today.slice(5, 10)
  const feb28 = md === '02-28' && !leap(Number(today.slice(0, 4)))
  const rows = (await tx.execute<{ id: string; reg_no: string; first_name: string; last_name: string | null; phone: string; course: string | null; branch: string; dob: string }>(sql`
    select distinct on (p.id) r.id, r.reg_no, p.first_name, p.last_name, p.phone, coalesce(c.title, r.custom_course_title) as course, b.name as branch, p.dob::text as dob
    from persons p join registrations r on r.person_id = p.id and r.status in ('active', 'on_hold') and r.deleted_at is null
      join branches b on b.id = r.branch_id left join courses c on c.id = r.course_id
    where p.deleted_at is null and p.dob is not null and (to_char(p.dob, 'MM-DD') = ${md} ${feb28 ? sql`or to_char(p.dob, 'MM-DD') = '02-29'` : sql``})
    order by p.id, r.created_at desc limit 50`)).rows
  return rows.map((r) => ({ registrationId: r.id, regNo: r.reg_no, name: [r.first_name, r.last_name].filter(Boolean).join(' '), firstName: r.first_name, phone: r.phone, course: r.course, branch: r.branch, age: ageOn(r.dob, today) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
