// "Your login" e-mails. Sent AFTER the database work commits (outside the transaction), so a mail failure never
// loses data; the caller then shows the one-time password on screen once instead.
import { log } from '@/lib/log'
import { providerFor } from '@/lib/notify/providers'
import { escapeHtml as esc } from '@/lib/notify/layout'
import { orgBrand } from '@/lib/brand'
import type { Login } from './service'

type BranchInfo = { id?: string; name: string; code: string; certCode: string | null; city: string | null; address: string | null; state: string | null; pincode: string | null; phone: string | null }

/** `institute`: the org's name, as the mail names it. */
export function loginMessage(b: BranchInfo | null, login: Login, roleNames: Record<string, string>, origin: string, institute: string) {
  const url = `${origin}/login`
  const where = b ? [b.address, [b.city, b.state].filter(Boolean).join(', '), b.pincode].filter(Boolean).join(', ') : ''
  const rows: [string, string][] = [
    ...(b ? [['Branch', `${b.name} (${b.code})`], ['Address', where || '—']] as [string, string][] : [['Branch', 'Head office']] as [string, string][]),
    ['Your role', login.roles.map((r) => roleNames[r] ?? r).join(', ')],
    ['Sign-in page', url], ['Username', login.email], ['One-time password', login.password],
  ]
  const text = `Hello ${login.name},\n\nYour ${institute} login is ready.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n` +
    `Sign in at ${url}. You will be asked to choose your own password straight away; the one-time password above then stops working.\n` +
    `Keep this e-mail private. If you did not expect it, tell your head office.\n\n- ${institute}`
  const html = `<div style="font-family:Arial,sans-serif;color:#1f2433;max-width:560px">
<h2 style="margin:0 0 8px">Your ${esc(institute)} login is ready</h2><p>Hello ${esc(login.name)},</p>
<table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#555">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table>
<p><a href="${esc(url)}" style="display:inline-block;background:#10186a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p>
<p style="font-size:13px;color:#555">You will be asked to choose your own password straight away; the one-time password then stops working. Keep this e-mail private.</p></div>`
  return { to: login.email, body: text, html }
}

export type Mailed = { name: string; email: string; emailed: boolean; error?: string; password?: string }

/**
 * Mails each login (from the branch's own mail server when it has one). The password comes back ONLY for the ones that
 * could not be mailed (to show once on screen).
 */
export async function mailLogins(orgId: string, b: BranchInfo | null, logins: Login[], roleNames: Record<string, string>, origin: string): Promise<Mailed[]> {
  const [provider, { name }] = await Promise.all([providerFor(orgId, 'email', b?.id), orgBrand(orgId)])
  const out: Mailed[] = []
  for (const l of logins) {
    if (!provider) { out.push({ name: l.name, email: l.email, emailed: false, error: 'No e-mail server is configured (EMAIL_USER / EMAIL_PASS)', password: l.password }); continue }
    const r = await provider.send({ channel: 'email', template: 'branch_welcome', subject: `${name} — your login`, ...loginMessage(b, l, roleNames, origin, name) })
    if (r.ok) log.info('login_mail_sent', { branch: b?.code ?? 'HO', userId: l.userId })
    else log.error('login_mail_failed', { branch: b?.code ?? 'HO', userId: l.userId, error: r.error })
    out.push(r.ok ? { name: l.name, email: l.email, emailed: true } : { name: l.name, email: l.email, emailed: false, error: r.error, password: l.password })
  }
  return out
}
