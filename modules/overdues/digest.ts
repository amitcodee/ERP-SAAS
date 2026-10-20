// The daily escalation mail (job "escalations"): each branch manager gets what has reached them in their branch
// (overdue leads and fees at level 1+), head office (every active super admin) what has reached head office (level 2)
// across the branches. Nothing escalated: no mail. The same lists are on the Overdues page.
import { sql } from 'drizzle-orm'
import { appOrigin } from '@/lib/app-url'
import { withOrgSystem } from '@/lib/db/withTenant'
import { log } from '@/lib/log'
import { providerFor } from '@/lib/notify/providers'
import { overdueFeesSql, overdueLeadsSql, thresholds } from './service'

const SHOW = 15
const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

type Lead = { kind: string; name: string; phone: string; days: number; level: number; owner: string | null; branch: string; branch_id: string }
type Fee = { reg_no: string; name: string; phone: string; days: number; level: number; overdue: number; owner: string | null; branch: string; branch_id: string }

/** One org's escalation mails (the job runs it for each org). */
export async function sendEscalationDigest(orgId: string): Promise<{ ok: boolean; summary: Record<string, unknown> }> {
  const email = await providerFor(orgId, 'email')
  const data = await withOrgSystem(orgId, async (tx) => {
    const t = await thresholds(tx)
    const leads = (await tx.execute<Lead>(sql`select * from (${overdueLeadsSql(t)}) y where y.level >= 1 order by y.days desc`)).rows
    const fees = (await tx.execute<Fee>(sql`select * from (${overdueFeesSql(t)}) y where y.level >= 1 order by y.days desc`)).rows
    // branch level: whoever holds a staff role with "overdue:read" (the branch manager by default), for their home
    // branch and the branches they work in with full access
    const managers = (await tx.execute<{ email: string; name: string; branch_id: string }>(sql`
      select distinct u.email, u.name, b.id as branch_id from users u join user_roles r on r.user_id = u.id
        join roles ro on ro.key = r.role and ro.kind = 'staff' and 'overdue:read' = any(ro.permissions)
        join branches b on b.id = u.branch_id or b.id in (select ub.branch_id from user_branches ub where ub.user_id = u.id and ub.access = 'full')
      where u.is_active and u.deleted_at is null and b.status = 'active'`)).rows
    const heads = (await tx.execute<{ email: string; name: string }>(sql`
      select distinct u.email, u.name from users u join user_roles r on r.user_id = u.id and r.role = 'super_admin' where u.is_active and u.deleted_at is null`)).rows
    return { leads, fees, managers, heads }
  })

  const origin = await appOrigin(orgId)
  const link = `${origin}/overdues`
  const mails: { to: string; subject: string; body: string; html: string }[] = []
  const build = (who: string, scope: string, leads: Lead[], fees: Fee[], allBranches: boolean) => {
    const leadLines = leads.slice(0, SHOW).map((l) => `${l.name} (${l.phone || l.kind}) — ${l.days} days overdue${l.owner ? `, with ${l.owner}` : ''}${allBranches ? ` · ${l.branch}` : ''}`)
    const feeLines = fees.slice(0, SHOW).map((f) => `${f.name} ${f.reg_no} — ${inr(Number(f.overdue))}, ${f.days} days overdue${f.owner ? `, admitted by ${f.owner}` : ''}${allBranches ? ` · ${f.branch}` : ''}`)
    const more = (n: number) => (n > SHOW ? [`… and ${n - SHOW} more`] : [])
    const amount = fees.reduce((s, f) => s + Number(f.overdue), 0)
    const subject = `Escalated to you: ${leads.length} overdue lead${leads.length === 1 ? '' : 's'}, ${fees.length} overdue fee${fees.length === 1 ? '' : 's'} (${inr(amount)}) — ${scope}`
    const text = [`Hello ${who},`, '', `These have gone past their follow-up / due date long enough to reach you (${scope}).`, '',
      `Overdue leads (${leads.length}):`, ...(leadLines.length ? leadLines : ['none']), ...more(leads.length), '',
      `Overdue fees (${fees.length}, ${inr(amount)}):`, ...(feeLines.length ? feeLines : ['none']), ...more(fees.length), '',
      `See and filter them all: ${link}`].join('\n')
    const list = (title: string, lines: string[], n: number) => `<h3 style="margin:18px 0 6px;font-size:14px">${esc(title)}</h3>${lines.length ? `<ul style="margin:0;padding-left:18px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}${n > SHOW ? `<li>… and ${n - SHOW} more</li>` : ''}</ul>` : '<p style="margin:0;color:#64748b">None.</p>'}`
    const html = `<div style="font-family:Arial,sans-serif;font-size:13px;color:#1f2937"><p>Hello ${esc(who)},</p><p>These have gone past their follow-up / due date long enough to reach you (${esc(scope)}).</p>${list(`Overdue leads (${leads.length})`, leadLines, leads.length)}${list(`Overdue fees (${fees.length}, ${inr(amount)})`, feeLines, fees.length)}<p style="margin-top:18px"><a href="${link}" style="background:#10186a;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open Overdues</a></p></div>`
    return { subject, body: text, html }
  }

  for (const m of data.managers) {
    const leads = data.leads.filter((l) => l.branch_id === m.branch_id), fees = data.fees.filter((f) => f.branch_id === m.branch_id)
    if (!leads.length && !fees.length) continue
    mails.push({ to: m.email, ...build(m.name, leads[0]?.branch ?? fees[0]?.branch ?? 'your branch', leads, fees, false) })
  }
  const hoLeads = data.leads.filter((l) => Number(l.level) === 2), hoFees = data.fees.filter((f) => Number(f.level) === 2)
  if (hoLeads.length || hoFees.length) for (const h of data.heads) mails.push({ to: h.email, ...build(h.name, 'head office, all branches', hoLeads, hoFees, true) })

  let sent = 0, failed = 0
  if (email) {
    for (const m of mails) {
      const r = await email.send({ channel: 'email', to: m.to, subject: m.subject, body: m.body, html: m.html, template: 'escalation_digest' }).catch((e: unknown) => ({ ok: false as const, error: String(e), retryable: true }))
      if (r.ok) sent++
      else { failed++; log.warn('escalation.mail_failed', { to: m.to, error: r.error }) }
    }
  }
  return {
    ok: failed === 0,
    summary: { escalatedLeads: data.leads.length, escalatedFees: data.fees.length, toHeadOffice: hoLeads.length + hoFees.length, mails: mails.length, sent, failed, emailNotSetUp: email ? null : 'Settings → E-mail is not set up: nothing was sent' },
  }
}
