// One interface, swapped by configuration (insti.md §7). Adapters call the vendor HTTP API directly.
// Settings come from Settings → E-mail / WhatsApp & SMS (saved in app_config), falling back to the server's
// environment variables (EMAIL_USER, WHATSAPP_TOKEN, MSG91_AUTH_KEY...) when nothing is saved there.
// E-mail is per branch: mail sent for a branch goes out from that branch's own server (Settings → Branch e-mail)
// once it is set up there; until then, from the central one.
import { branchEmailReady, getBranchEmail, getConfig, type Channel, type EmailConfig, type SmsConfig, type WhatsAppConfig } from '@/lib/config/store'
import { emailHtml, emailText, LOGO_CID, logoPng } from './layout'
import { assertPublicHost } from '@/lib/net-guard'
import { WA_MESSAGES, waMessageFor, waParams } from './whatsapp'

export type { Channel }
/** `name`: the person's full name, when known (WhatsApp greets by it and AiSensy files the contact under it). */
/** `campaign` / `media`: a Bulk WhatsApp message goes out through its own AiSensy campaign (Settings → WhatsApp campaigns). */
export type Outgoing = {
  channel: Channel; to: string; body: string; template: string; subject?: string; html?: string; name?: string | null; params?: string[] | null
  campaign?: string | null; media?: { url: string; filename: string } | null
}
export type SendResult = { ok: true; ref?: string } | { ok: false; error: string; retryable: boolean }

export interface Provider {
  readonly name: string
  send(m: Outgoing): Promise<SendResult>
}

const digits = (p: string, cc = '91') => p.replace(/\D/g, '').replace(/^0+/, '').replace(/^(?=\d{10}$)/, cc)

async function post(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  return { status: res.status, json: await res.json().catch(() => null) }
}

/** Meta WhatsApp Cloud API. Business-initiated messages must use an approved template. */
function whatsapp(c: WhatsAppConfig, token: string): Provider {
  return {
    name: 'whatsapp-cloud',
    async send(m) {
      const { status, json } = await post(`https://graph.facebook.com/${c.apiVersion || 'v20.0'}/${c.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: digits(m.to, c.countryCode), type: 'template',
          // fee reminders: the template named in Settings; event messages: their own (lib/notify/whatsapp.ts)
          template: m.campaign
            ? { name: m.campaign, language: { code: c.language || 'en' }, components: m.params?.length ? [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }] : [] }
            : m.params?.length
            ? { name: WA_MESSAGES[waMessageFor(m.template) ?? 'fee_reminder'].template.name, language: { code: 'en' }, components: [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }] }
            : { name: c.reminderTemplate || m.template, language: { code: c.language || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: m.body }] }] },
        }),
      })
      const ref = (json as { messages?: { id: string }[] } | null)?.messages?.[0]?.id
      const why = (json as { error?: { message?: string } } | null)?.error?.message
      return status < 300 && ref ? { ok: true, ref } : { ok: false, error: `WhatsApp HTTP ${status}${why ? `: ${why}` : ''}`, retryable: status >= 500 || status === 429 }
    },
  }
}

/**
 * AiSensy API campaigns. Each message in lib/notify/whatsapp.ts goes out through its own live API campaign, which
 * holds the approved template; the panel sends only the number, the name and the template's parameters.
 */
// AiSensy's own error, and what to do about it (shown in the test result and the message log)
const AISENSY_HINTS: [RegExp, string][] = [
  [/no plan active/i, 'the AiSensy account this API key belongs to has no active plan: AiSensy → Manage → Billing, start or renew the plan, or paste the key of the project that has one'],
  [/api ?key|unauthori[sz]ed|invalid key/i, 'the API key is wrong: copy it again from AiSensy → Manage → API Key'],
  [/campaign.*(not|doesn.?t) (exist|found|live)|no campaign|campaign.*(inactive|paused|stopped)/i, 'the API campaign name does not match AiSensy, or the campaign is not Live there'],
  [/template.*param|param.*(count|mismatch)/i, 'the number of {{n}} details does not match the template'],
  [/wallet|credit|balance|insufficient/i, 'the AiSensy wallet is empty: add credit in AiSensy → Manage → Wallet'],
]

export function aisensy(c: WhatsAppConfig, apiKey: string): Provider {
  return {
    name: 'aisensy',
    async send(m) {
      const key = m.campaign ? null : waMessageFor(m.template)
      if (!m.campaign && !key) return { ok: false, error: `No WhatsApp message is set up for "${m.template}" (lib/notify/whatsapp.ts)`, retryable: false }
      const name = m.name?.replace(/\s+/g, ' ').trim() || 'Student'
      const { status, json } = await post('https://backend.aisensy.com/campaign/t1/api/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey, campaignName: key ? c.campaigns?.[key] || WA_MESSAGES[key].campaign : m.campaign, destination: digits(m.to, c.countryCode), userName: name,
          templateParams: m.params?.length || !key ? m.params ?? [] : waParams(key, { text: m.body }), source: 'techcadd-panel',
          ...(m.media ? { media: m.media } : {}),
        }),
      })
      const j = json as { submitted_message_id?: string; messageId?: string; message?: string; errorMessage?: string } | null
      if (status < 300) return { ok: true, ref: j?.submitted_message_id ?? j?.messageId }
      const why = j?.errorMessage ?? j?.message
      const hint = why ? AISENSY_HINTS.find(([re]) => re.test(String(why)))?.[1] : undefined
      return { ok: false, error: `AiSensy HTTP ${status}${why ? `: ${String(why).slice(0, 200)}` : ''}${hint ? ` (${hint})` : ''}`, retryable: status >= 500 || status === 429 }
    },
  }
}

/** MSG91 transactional SMS (Flow API). */
function sms(c: SmsConfig, authKey: string): Provider {
  return {
    name: 'msg91',
    async send(m) {
      const { status, json } = await post('https://control.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: { authkey: authKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: c.templateId, ...(c.senderId ? { sender: c.senderId } : {}), recipients: [{ mobiles: digits(m.to, c.countryCode), message: m.body }] }),
      })
      const ok = status < 300 && (json as { type?: string } | null)?.type === 'success'
      return ok ? { ok: true, ref: (json as { message?: string }).message } : { ok: false, error: `MSG91 HTTP ${status}`, retryable: status >= 500 || status === 429 }
    },
  }
}

const SUBJECT: Record<string, string> = { ops_alert: 'techcadd — system alert', password_reset: 'techcadd — reset your password', branch_welcome: 'techcadd — your login', settings_test: 'techcadd — test e-mail', birthday: 'Happy Birthday from techcadd! 🎉' }
const subjectOf = (m: Outgoing) => m.subject ?? SUBJECT[m.template] ?? 'techcadd — fee reminder'

/** Any SMTP mailbox (Gmail: use a Google "app password", not the account password). One transport per mailbox setting. */
const transports = new Map<string, import('nodemailer').Transporter>()
/** What a branch sees when its mail server fails: the kind of failure, never the server's own reply (no probing with it). */
function plainSmtpError(e: unknown): string {
  const { code, responseCode } = e as { code?: string; responseCode?: number }
  if (code === 'EAUTH') return 'The mail server refused the login: check the user and password (Gmail needs an app password)'
  if (code === 'ETLS') return 'The secure connection failed: check the security setting (SSL for port 465, STARTTLS for 587)'
  if (code && ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(code)) return 'Could not connect to the mail server: check the address, port and security'
  if (code === 'EENVELOPE') return 'The mail server refused the sender or recipient address'
  return responseCode ? `The mail server refused the message (code ${responseCode})` : 'The e-mail could not be sent'
}

function smtp(c: EmailConfig, password: string, name = 'smtp'): Provider {
  const branch = name === 'branch-smtp'
  return {
    name,
    async send(m: Outgoing): Promise<SendResult> {
      try {
        if (branch) await assertPublicHost(c.host) // checked again here: the name may point somewhere else since it was saved
        const id = JSON.stringify([c.host, c.port, c.security, c.user, password])
        let t = transports.get(id)
        if (!t) {
          const nodemailer = await import('nodemailer')
          t = nodemailer.createTransport({
            host: c.host, port: c.port, secure: c.security === 'ssl', requireTLS: c.security === 'starttls', ignoreTLS: c.security === 'none',
            auth: { user: c.user, pass: password }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
          })
          if (transports.size >= 50) transports.clear()
          transports.set(id, t)
        }
        const logo = await logoPng(), subject = subjectOf(m)
        const info = await t.sendMail({
          from: { name: c.fromName || 'techcadd', address: c.fromAddress || c.user }, ...(c.replyTo ? { replyTo: c.replyTo } : {}),
          to: m.to, subject, text: emailText(m.body), html: emailHtml({ ...m, subject }, !!logo),
          ...(logo ? { attachments: [{ filename: 'techcadd.png', content: logo, contentType: 'image/png', cid: LOGO_CID }] } : {}),
        })
        return { ok: true, ref: info.messageId }
      } catch (e) {
        const code = (e as { responseCode?: number }).responseCode
        // 5xx = rejected for good (bad address, bad login); anything else (network, 4xx) is worth retrying
        const error = branch ? plainSmtpError(e) : `SMTP: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
        return { ok: false, error, retryable: !(code && code >= 500) }
      }
    },
  }
}

/** The platform's own mailbox (environment: EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASS / MAIL_FROM), for orgs
 * that have not set up their own e-mail. Sends under MAIL_FROM_NAME (the org's name comes with Phase 3 branding). */
const platformSmtp: Provider | null = process.env.EMAIL_USER && process.env.EMAIL_PASS
  ? smtp({
      enabled: true, host: process.env.EMAIL_HOST ?? 'smtp.gmail.com', port: Number(process.env.EMAIL_PORT ?? 465),
      security: Number(process.env.EMAIL_PORT ?? 465) === 465 ? 'ssl' : 'starttls', user: process.env.EMAIL_USER,
      fromName: process.env.MAIL_FROM_NAME ?? '', fromAddress: process.env.MAIL_FROM ?? process.env.EMAIL_USER, replyTo: '', alertEmail: '',
    }, process.env.EMAIL_PASS, 'platform-smtp')
  : null

/** SendGrid transactional email (environment only: SENDGRID_API_KEY + MAIL_FROM), the platform's mailer when it has no SMTP. */
const sendgrid: Provider | null =
  process.env.SENDGRID_API_KEY && process.env.MAIL_FROM
    ? {
        name: 'sendgrid',
        async send(m) {
          const logo = await logoPng(), subject = subjectOf(m)
          const { status } = await post('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: m.to }] }], from: { email: process.env.MAIL_FROM, name: 'techcadd' }, subject,
              content: [{ type: 'text/plain', value: emailText(m.body) }, { type: 'text/html', value: emailHtml({ ...m, subject }, !!logo) }],
              ...(logo ? { attachments: [{ content: logo.toString('base64'), type: 'image/png', filename: 'techcadd.png', disposition: 'inline', content_id: LOGO_CID }] } : {}),
            }),
          })
          return status < 300 ? { ok: true } : { ok: false, error: `SendGrid HTTP ${status}`, retryable: status >= 500 || status === 429 }
        },
      }
    : null

/**
 * An org's provider for a channel, or null when that channel is not set up or switched off (messages then stay queued).
 * `branchId`: whose mail this is. E-mail then goes out from that branch's own server when it has one set up, else the
 * org's, else the platform's mailer. WhatsApp and SMS only ever use the org's own accounts.
 */
export async function providerFor(orgId: string, channel: Channel, branchId?: string | null): Promise<Provider | null> {
  if (channel === 'email') {
    if (branchId) {
      const b = await getBranchEmail(orgId, branchId)
      if (branchEmailReady(b)) return smtp(b.config, b.secrets.password!, 'branch-smtp')
    }
    const { config: c, secrets: s } = await getConfig(orgId, 'email')
    return c.enabled && c.host && c.user && s.password ? smtp(c, s.password) : platformMailer()
  }
  if (channel === 'whatsapp') {
    const { config: c, secrets: s } = await getConfig(orgId, 'whatsapp')
    if (!c.enabled) return null
    // a Meta setup saved before AiSensy was offered has no provider of its own and keeps working as it was
    const meta = c.provider === 'meta' || (!s.apiKey && !!s.token && !!c.phoneNumberId)
    if (meta) return c.phoneNumberId && s.token ? whatsapp(c, s.token) : null
    return s.apiKey ? aisensy(c, s.apiKey) : null
  }
  const { config: c, secrets: s } = await getConfig(orgId, 'sms')
  return c.enabled && c.templateId && s.authKey ? sms(c, s.authKey) : null
}

/** The platform's own mailer (sign-up codes, alerts to the platform), or null when the server has none set up. */
export const platformMailer = (): Provider | null => platformSmtp ?? sendgrid

/** The channels an org's fee reminders go out on (Settings → Reminders). */
export async function reminderChannels(orgId: string): Promise<Channel[]> {
  return (await getConfig(orgId, 'reminders')).config.channels
}
