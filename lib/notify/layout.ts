// The one look every e-mail goes out in: the sender's logo on top (the institute's, or for the platform's own mail
// its name), the message, then a "system-generated, do not reply" note with the sender's name at the bottom. The logo
// travels inside the mail (inline attachment, cid:), so it shows without the panel having a public address and
// without the reader allowing remote images.
import type { Brand } from '@/lib/brand'

/** Who a mail is from: an institute's brand, or the platform's (its name, no logo). */
export type MailBrand = Pick<Brand, 'name' | 'tagline' | 'color' | 'logo'>

export const LOGO_CID = 'sender-logo'
export const NO_REPLY = 'This is a system-generated e-mail. Please do not reply to it.'

/** The sender's logo as an inline attachment, or null (no logo: the mail shows the name instead). */
export function mailLogo(brand: MailBrand): { filename: string; content: Buffer; contentType: string } | null {
  const m = brand.logo?.match(/^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/)
  return m ? { filename: `logo.${m[2] === 'jpeg' ? 'jpg' : m[2]}`, content: Buffer.from(m[3], 'base64'), contentType: m[1] } : null
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const esc = escapeHtml

/**
 * A button in a mail body. The HTML part draws it as a button; the text part keeps the address. It is marked with
 * private-use characters that typed text never holds (and plainText() removes), so only the panel's own code can
 * make a button: a student who types "[[Open Project Help|https://…]]" into a help request gets plain text.
 */
const BUTTON = /([^-\n]+)(https?:\/\/[^\s-]+)/g
/** Typed or stored text going into a mail body: it cannot carry a button. */
export const plainText = (s: string) => s.replace(/[-]/g, '')
export const mailButton = (label: string, url: string) => `${plainText(label)}${plainText(url)}`

const buttonHtml = (label: string, url: string, color: string) =>
  `<a href="${esc(url)}" style="display:inline-block;margin:6px 6px 6px 0;padding:11px 22px;background:${color};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px">${esc(label)}</a>`

const linked = (s: string, color: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:${color}">${u}</a>`)

/** Plain text turned into simple HTML: paragraphs, line breaks, buttons and clickable links. */
function textToHtml(text: string, color: string) {
  const inline = (s: string) => {
    let out = '', at = 0
    for (const m of s.matchAll(BUTTON)) { out += linked(s.slice(at, m.index), color) + buttonHtml(m[1], m[2], color); at = m.index + m[0].length }
    return out + linked(s.slice(at), color)
  }
  return text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${inline(p).replace(/\n/g, '<br>')}</p>`).join('')
}

/** The full HTML mail: `html` when the sender wrote one, otherwise built from the text. `withLogo`: the sender's logo
 * goes with the mail as LOGO_CID (mailLogo). */
export function emailHtml(m: { body: string; html?: string; subject: string }, brand: MailBrand, withLogo: boolean) {
  const color = /^#[0-9a-fA-F]{6}$/.test(brand.color) ? brand.color : '#10186a'
  const head = withLogo
    ? `<img src="cid:${LOGO_CID}" alt="${esc(brand.name)}" width="190" style="display:block;width:190px;max-width:60%;height:auto;border:0">`
    : `<div style="font-size:26px;font-weight:bold;color:${color}">${esc(brand.name)}</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6ef">
<tr><td style="padding:22px 28px 16px;border-bottom:4px solid ${color}">${head}</td></tr>
<tr><td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2433">${m.html ?? textToHtml(m.body, color)}</td></tr>
<tr><td style="padding:16px 28px;background:#f7f8fb;border-top:1px solid #e3e6ef;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">
<b>${esc(brand.name)}</b>${brand.tagline ? ` &middot; ${esc(brand.tagline)}` : ''}<br>${NO_REPLY}</td></tr>
</table></td></tr></table></body></html>`
}

/** The plain-text part, with the same note at the end. */
export const emailText = (body: string) =>
  `${body.replace(BUTTON, (_, label: string, url: string, at: number) => (at === 0 || body[at - 1] === '\n' ? `${label}: ${url}` : url)).trimEnd()}\n\n--\n${NO_REPLY}`
