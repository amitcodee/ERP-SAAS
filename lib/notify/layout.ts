// The one look every e-mail goes out in: the techcadd colour logo on top, the message, then a "system-generated,
// do not reply" note at the bottom. The logo travels inside the mail (inline attachment, cid:), so it shows without
// the panel having a public address and without the reader allowing remote images.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const LOGO_CID = 'techcadd-logo'
export const NO_REPLY = 'This is a system-generated e-mail. Please do not reply to it.'

let logo: Promise<Buffer | null> | null = null
/** public/tce-logo.png, read once. Null when it cannot be read (the mail then goes without the picture). */
export function logoPng(): Promise<Buffer | null> {
  logo ??= readFile(path.join(process.cwd(), 'public', 'tce-logo.png')).catch(() => null)
  return logo
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * A button in a mail body. The HTML part draws it as a button; the text part keeps the address. It is marked with
 * private-use characters that typed text never holds (and plainText() removes), so only the panel's own code can
 * make a button: a student who types "[[Open Project Help|https://…]]" into a help request gets plain text.
 */
const BUTTON = /([^-\n]+)(https?:\/\/[^\s-]+)/g
/** Typed or stored text going into a mail body: it cannot carry a button. */
export const plainText = (s: string) => s.replace(/[-]/g, '')
export const mailButton = (label: string, url: string) => `${plainText(label)}${plainText(url)}`

const buttonHtml = (label: string, url: string) =>
  `<a href="${esc(url)}" style="display:inline-block;margin:6px 6px 6px 0;padding:11px 22px;background:#1a1f71;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px">${esc(label)}</a>`

const linked = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1a1f71">${u}</a>`)

/** Plain text turned into simple HTML: paragraphs, line breaks, buttons and clickable links. */
function textToHtml(text: string) {
  const inline = (s: string) => {
    let out = '', at = 0
    for (const m of s.matchAll(BUTTON)) { out += linked(s.slice(at, m.index)) + buttonHtml(m[1], m[2]); at = m.index + m[0].length }
    return out + linked(s.slice(at))
  }
  return text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${inline(p).replace(/\n/g, '<br>')}</p>`).join('')
}

/** The full HTML mail: `html` when the sender wrote one, otherwise built from the text. */
export function emailHtml(m: { body: string; html?: string; subject: string }, withLogo: boolean) {
  const head = withLogo
    ? `<img src="cid:${LOGO_CID}" alt="techcadd" width="190" style="display:block;width:190px;max-width:60%;height:auto;border:0">`
    : `<div style="font-size:26px;font-weight:bold;color:#1a1f71">techcadd</div>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6ef">
<tr><td style="padding:22px 28px 16px;border-bottom:4px solid #1a1f71">${head}</td></tr>
<tr><td style="padding:24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2433">${m.html ?? textToHtml(m.body)}</td></tr>
<tr><td style="padding:16px 28px;background:#f7f8fb;border-top:1px solid #e3e6ef;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#6b7280;text-align:center">
<b>techcadd</b> &middot; Your Skill &amp; Technology Partner<br>${NO_REPLY}</td></tr>
</table></td></tr></table></body></html>`
}

/** The plain-text part, with the same note at the end. */
export const emailText = (body: string) =>
  `${body.replace(BUTTON, (_, label: string, url: string, at: number) => (at === 0 || body[at - 1] === '\n' ? `${label}: ${url}` : url)).trimEnd()}\n\n--\n${NO_REPLY}`
