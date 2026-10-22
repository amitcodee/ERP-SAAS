'use client'
// Settings, one topic per tab: Business rules · Certificates · Branch e-mail (the branch's own mail server) · E-mail · WhatsApp & SMS · WhatsApp campaigns (Bulk WhatsApp) · Numbering · Reminders · Scheduled jobs ·
// Admission form (the public /apply) · Integrations (webhooks for n8n / Zapier / Make) · API access (keys for Power BI, Excel, n8n). The tab sits in the
// address (?tab=). Head office only, except Business rules and Certificates. Your own password is under My account.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Award, BadgeCheck, BellRing, Check, ClipboardList, Clock3, Copy, CreditCard, Hash, KeyRound, Mail, Megaphone, MessageCircle, Plug, Plus, Send, SlidersHorizontal, Smartphone, Trash2, Wallet, Webhook, X } from 'lucide-react'
import {
  createApiKeyAction, createWebhookAction, deleteWebhookAction, revokeApiKeyAction, runJobNowAction, saveBranchEmailAction, saveEmailSettingsAction, saveJobsAction, saveNumberingAction, saveRemindersAction,
  saveAdmissionFormAction, saveGradesAction, savePaymentsSettingsAction, saveSmsSettingsAction, saveWhatsappSettingsAction, testBranchEmailAction, testEmailAction, testMessageAction, testWebhookAction, updateRuleAction, updateWebhookAction, webhookDeliveriesAction, webhookSecretAction, webLeadsSecretAction,
} from '@/app/actions'
import { IntegrationsPanel } from '@/components/integrations-panel'
import { WaCampaignsTab } from '@/components/wa-campaigns'
import type { CampaignRow } from '@/modules/notifications/broadcasts'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { useBrand } from '@/components/brand-context'
import type { AdmissionFormConfig, EmailConfig, JobsConfig, PaymentsConfig, RemindersConfig, SmsConfig, WhatsAppConfig } from '@/lib/config/store'
import type { OnlinePaymentRow } from '@/modules/fees/online'
import { DEFAULT_GRADES, gradesProblem, type GradesConfig } from '@/lib/grades'
import { waBody, WA_EVENT_KEYS, WA_KEYS, WA_MESSAGES } from '@/lib/notify/whatsapp'
import { DIAL_CODES } from '@/lib/countries'
import type { ApiKeyRow } from '@/modules/integrations/api'
import type { DeliveryRow, WebhookRow } from '@/modules/integrations/webhooks'
import type { IntegrationsData } from '@/modules/reports/integrations'
import type { RuleRow } from '@/modules/settings/service'
import type { NumberingRow } from '@/modules/settings/numbering'
import { BillingTab, type BillingTabData } from '@/components/billing-tab'
import { formatProblem, renderNumber } from '@/lib/number-format'
import { PasswordInput } from '@/components/password-input'

export type SettingsData = {
  rules: RuleRow[]; canEdit: boolean; integrations: IntegrationsData | null
  /** The acting branch's own mail server, for whoever may set it (branch manager, or head office inside a branch). */
  branchEmail: null | { branchName: string; config: EmailConfig; hasPassword: boolean; saved: boolean; updatedAt: string | null }
  admin: null | {
    email: { config: EmailConfig; hasPassword: boolean; saved: boolean; updatedAt: string | null }
    whatsapp: { config: WhatsAppConfig; hasToken: boolean; hasApiKey: boolean; saved: boolean; updatedAt: string | null }
    sms: { config: SmsConfig; hasAuthKey: boolean; saved: boolean; updatedAt: string | null }
    payments: { config: PaymentsConfig; hasKeySecret: boolean; hasWebhookSecret: boolean; saved: boolean; updatedAt: string | null; webhookUrl: string; recent: OnlinePaymentRow[] }
    campaigns: CampaignRow[]
    numbering: NumberingRow[]
    billing: BillingTabData
    reminders: RemindersConfig
    grades: GradesConfig
    admissionForm: AdmissionFormConfig
    jobs: JobsConfig
    jobInfo: Record<string, { label: string; what: string }>
    runs: { id: string; job: string; startedAt: string; finishedAt: string | null; ok: boolean | null; error: string | null; summary: Record<string, unknown> | null }[]
    cronSecretSet: boolean
    webhooks: WebhookRow[]
    events: { key: string; label: string; what: string }[]
    keys: ApiKeyRow[]
    datasets: { key: string; label: string; what: string; dateField: string; fields: { key: string; about: string }[] }[]
    branches: { id: string; name: string; code: string }[]
    origin: string
    /** The server has WEBLEADS_SECRET, so this org's websites can send their form leads. */
    webLeadsOn: boolean
  }
}

const TABS = [
  { key: 'rules', label: 'Business rules', icon: SlidersHorizontal, admin: false },
  { key: 'certificates', label: 'Certificates', icon: BadgeCheck, admin: false },
  { key: 'branch-email', label: 'Branch e-mail', icon: Mail, admin: false },
  { key: 'email', label: 'E-mail', icon: Mail, admin: true },
  { key: 'messaging', label: 'WhatsApp & SMS', icon: MessageCircle, admin: true },
  { key: 'campaigns', label: 'WhatsApp campaigns', icon: Megaphone, admin: true },
  { key: 'payments', label: 'Online payments', icon: Wallet, admin: true },
  { key: 'billing', label: 'Plan & billing', icon: CreditCard, admin: true },
  { key: 'numbering', label: 'Numbering', icon: Hash, admin: true },
  { key: 'reminders', label: 'Reminders', icon: BellRing, admin: true },
  { key: 'grades', label: 'Report cards', icon: Award, admin: true },
  { key: 'admission', label: 'Admission form', icon: ClipboardList, admin: true },
  { key: 'jobs', label: 'Scheduled jobs', icon: Clock3, admin: true },
  { key: 'integrations', label: 'Integrations', icon: Plug, admin: true },
  { key: 'api', label: 'API access', icon: KeyRound, admin: true },
] as const
type TabKey = (typeof TABS)[number]['key']

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—')
const Badge = ({ tone, children }: { tone: 'green' | 'slate' | 'amber' | 'red' | 'blue'; children: React.ReactNode }) => <span className={`status-badge status-${tone}`}><span className="status-dot" />{children}</span>

// the country a 10-digit mobile number belongs to: its dialling code goes in front (lib/countries.ts)
function CountrySelect({ value, set }: { value: string; set: (v: string) => void }) {
  const v = value?.replace(/\D/g, '') || '91'
  return (
    <select value={v} onChange={(e) => set(e.target.value)}>
      {!DIAL_CODES.some((c) => c.code === v) && <option value={v}>+{v}</option>}
      {DIAL_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
    </select>
  )
}

function Toggle({ label, value, set, hint }: { label: string; value: boolean; set: (v: boolean) => void; hint?: string }) {
  return (
    <div className="set-toggle">
      <button type="button" role="switch" aria-checked={value} className={value ? 'on' : ''} onClick={() => set(!value)} aria-label={label}><span /></button>
      <div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    </div>
  )
}

function CopyText({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="set-copy">
      <code>{text}</code>
      <button type="button" className="filter-button icon-only" title={label ?? 'Copy'} aria-label={label ?? 'Copy'} onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>{done ? <Check size={14} /> : <Copy size={14} />}</button>
    </span>
  )
}

function Section({ title, about, children, actions }: { title: string; about?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="panel set-card">
      <div className="set-card-head"><div><h2>{title}</h2>{about && <p>{about}</p>}</div>{actions && <div className="row-actions">{actions}</div>}</div>
      {children}
    </div>
  )
}

export function SettingsTabs({ tab, data, signatures }: { tab: string; data: SettingsData; signatures: React.ReactNode }) {
  const tabs = TABS.filter((t) => (!t.admin || data.admin) && (t.key !== 'certificates' || signatures) && (t.key !== 'branch-email' || data.branchEmail))
  const [current, setCurrent] = useState<TabKey>((tabs.find((t) => t.key === tab)?.key ?? 'rules') as TabKey)
  const go = (k: TabKey) => {
    setCurrent(k)
    try { const u = new URL(window.location.href); u.searchParams.set('tab', k); window.history.replaceState(null, '', u) } catch { /* ignore */ }
  }
  const active = TABS.find((t) => t.key === current)!
  return (
    <section className="page-container set-page">
      <div className="page-heading"><div><p className="eyebrow">Administration / Settings</p><h1>Settings</h1><p className="subheading">How the panel works for every branch. Pick a topic below. Your own password and profile are under My account.</p></div></div>
      <div className="set-tabs" role="tablist" aria-label="Settings">
        {tabs.map((t) => <button key={t.key} type="button" role="tab" aria-selected={current === t.key} className={current === t.key ? 'on' : ''} onClick={() => go(t.key)}><t.icon size={15} /> {t.label}</button>)}
      </div>
      <div className="set-body" aria-label={active.label}>
        {current === 'rules' && <RulesTab rules={data.rules} canEdit={data.canEdit} />}
        {current === 'certificates' && signatures}
        {current === 'branch-email' && data.branchEmail && <EmailTab key={`branch-${data.branchEmail.branchName}`} d={data.branchEmail} branch={data.branchEmail.branchName} />}
        {current === 'email' && data.admin && <EmailTab key="central" d={data.admin.email} />}
        {current === 'messaging' && data.admin && <MessagingTab wa={data.admin.whatsapp} sms={data.admin.sms} />}
        {current === 'campaigns' && data.admin && <WaCampaignsTab list={data.admin.campaigns} whatsappOn={data.admin.whatsapp.config.enabled} />}
        {current === 'payments' && data.admin && <PaymentsTab d={data.admin.payments} />}
        {current === 'billing' && data.admin && <BillingTab d={data.admin.billing} />}
        {current === 'numbering' && data.admin && <NumberingTab rows={data.admin.numbering} />}
        {current === 'reminders' && data.admin && <RemindersTab cfg={data.admin.reminders} ready={{ email: data.admin.email.config.enabled, whatsapp: data.admin.whatsapp.config.enabled, sms: data.admin.sms.config.enabled }} goJobs={() => go('jobs')} goChannels={() => go('messaging')} />}
        {current === 'grades' && data.admin && <GradesTab cfg={data.admin.grades} />}
        {current === 'admission' && data.admin && <AdmissionTab cfg={data.admin.admissionForm} origin={data.admin.origin} branches={data.admin.branches} />}
        {current === 'jobs' && data.admin && <JobsTab cfg={data.admin.jobs} info={data.admin.jobInfo} runs={data.admin.runs} cronSecretSet={data.admin.cronSecretSet} origin={data.admin.origin} />}
        {current === 'integrations' && data.admin && <IntegrationsTab status={data.integrations} hooks={data.admin.webhooks} events={data.admin.events} origin={data.admin.origin} webLeadsOn={data.admin.webLeadsOn} />}
        {current === 'api' && data.admin && <ApiTab keys={data.admin.keys} datasets={data.admin.datasets} branches={data.admin.branches} origin={data.admin.origin} />}
      </div>
    </section>
  )
}

// ---- Report cards

/** The grade bands and the pass mark the report cards use (lib/grades.ts). */
function GradesTab({ cfg }: { cfg: GradesConfig }) {
  const notify = useNotify()
  const router = useRouter()
  const [g, setG] = useState<GradesConfig>({ ...cfg, bands: [...cfg.bands].sort((a, b) => b.min - a.min) })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const why = gradesProblem(g)
  const band = (i: number, v: Partial<GradesConfig['bands'][number]>) => setG({ ...g, bands: g.bands.map((b, k) => (k === i ? { ...b, ...v } : b)) })
  const save = () => start(async () => {
    const r = await saveGradesAction(g)
    if (!r.ok) return setError(r.error)
    setError(''); notify('Report card grades saved'); router.refresh()
  })
  return (
    <Section title="Grades on report cards" about="A student's overall result is their total marks over the total of the maximums, across marked tests and assignments. Each grade starts at the percent shown and runs up to the next one.">
      <div className="set-rules">
        {g.bands.map((b, i) => (
          <div key={i} className="set-rule">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={b.grade} maxLength={4} onChange={(e) => band(i, { grade: e.target.value })} aria-label="Grade" style={{ width: 70 }} />
              <input value={b.label} maxLength={40} onChange={(e) => band(i, { label: e.target.value })} aria-label="Grade wording" placeholder="e.g. Excellent" style={{ width: 220 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="section-hint" style={{ margin: 0 }}>from</span>
              <input type="number" min={0} max={100} value={b.min} onChange={(e) => band(i, { min: Number(e.target.value) })} aria-label={`${b.grade} starts at`} style={{ width: 80 }} /><span className="section-hint" style={{ margin: 0 }}>%</span>
              <button type="button" className="filter-button icon-only" title="Remove this grade" aria-label={`Remove ${b.grade}`} disabled={g.bands.length < 2} onClick={() => setG({ ...g, bands: g.bands.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="row-actions" style={{ margin: '10px 0', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="filter-button" disabled={g.bands.length >= 12} onClick={() => setG({ ...g, bands: [...g.bands, { min: 0, grade: '', label: '' }] })}><Plus size={14} /> Add a grade</button>
        <button type="button" className="filter-button" onClick={() => setG(DEFAULT_GRADES)}>Back to the standard grades</button>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>Pass mark <input type="number" min={0} max={100} value={g.passPct} onChange={(e) => setG({ ...g, passPct: Number(e.target.value) })} aria-label="Pass mark" style={{ width: 80 }} />%</span>
      </div>
      <Err msg={error || why || ''} />
      <div className="modal-actions"><button type="button" className="button primary" disabled={pending || !!why} onClick={save}>{pending ? 'Saving…' : 'Save grades'}</button></div>
    </Section>
  )
}

// ---- Admission form

/** The public admission form (/apply, and inside the institute's website): on or off, its wording, the links. */
function AdmissionTab({ cfg, origin, branches }: { cfg: AdmissionFormConfig; origin: string; branches: { id: string; name: string; code: string }[] }) {
  const notify = useNotify()
  const router = useRouter()
  const [c, setC] = useState(cfg)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    const r = await saveAdmissionFormAction(c)
    if (!r.ok) return setError(r.error)
    setError(''); notify('Admission form saved'); router.refresh()
  })
  const link = `${origin}/apply`
  const snippet = `<script src="${origin}/apply/embed.js" async></script>`
  return (
    <>
      <Section title="Online admission form" about="A form anyone can fill in: their name, mobile, the centre and the course. Each form sent becomes a Lead of the centre they chose (see Web Leads), with the ad or post that brought them, and they get your usual thank-you message."
        actions={<>{c.enabled ? <Badge tone="green">Open</Badge> : <Badge tone="slate">Off</Badge>}{cfg.enabled && <a className="filter-button" href={link} target="_blank" rel="noreferrer">Open the form</a>}</>}>
        <Toggle label="Take admission forms online" value={c.enabled} set={(v) => setC({ ...c, enabled: v })} hint="Off: the form says admissions are not open online." />
        <div className="wl-form">
          <label className="wide">Heading<input value={c.heading} maxLength={80} onChange={(e) => setC({ ...c, heading: e.target.value })} placeholder="Apply for admission" /></label>
          <label className="wide">A few words above the form <small>(optional)</small><textarea rows={3} value={c.intro} maxLength={600} onChange={(e) => setC({ ...c, intro: e.target.value })} placeholder="e.g. New batches start every Monday. Fill in the form and our counsellor will call you." /></label>
          <label className="wide">After sending<textarea rows={2} value={c.thanks} maxLength={300} onChange={(e) => setC({ ...c, thanks: e.target.value })} /></label>
        </div>
        <p className="section-hint" style={{ margin: '6px 0' }}>Besides name, mobile, centre and course, also ask for:</p>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Toggle label="E-mail" value={c.askEmail} set={(v) => setC({ ...c, askEmail: v })} />
          <Toggle label="Area or city" value={c.askLocation} set={(v) => setC({ ...c, askLocation: v })} />
          <Toggle label="A question" value={c.askMessage} set={(v) => setC({ ...c, askMessage: v })} />
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save admission form'}</button></div>
      </Section>
      <Section title="Where to put it" about="Share the link, or place the form in your own website. Every form sent is counted for the ad or post it came from.">
        <p className="section-hint" style={{ margin: '0 0 6px' }}>The link (for Instagram, Facebook, Google ads, WhatsApp, a QR code on a poster):</p>
        <CopyText text={link} label="Copy the link" />
        <p className="section-hint" style={{ margin: '14px 0 6px' }}>In your website: paste this where the form should appear (WordPress: a Custom HTML block).</p>
        <CopyText text={snippet} label="Copy the website code" />
        <details className="set-help"><summary>Counting ads and choosing the centre</summary><ul>
          <li>Add <code>utm_source</code>, <code>utm_medium</code> and <code>utm_campaign</code> to the link in each ad, e.g. <code>{link}?utm_source=instagram&amp;utm_medium=paid&amp;utm_campaign=summer-batch</code>. Web Leads and the lead's history show it. On your website, the ad's address is remembered for the visit even if they open another page first.</li>
          <li>One centre's own page or ad: add <code>?branch=CODE</code> to the link, or <code>data-branch=&quot;CODE&quot;</code> to the website code, to choose it already.{branches.length > 0 && <> Codes: {branches.map((b) => `${b.code} (${b.name})`).join(', ')}.</>}</li>
          <li>Facebook and Google also add <code>fbclid</code> / <code>gclid</code> themselves: these are kept with the form as sent.</li>
        </ul></details>
      </Section>
    </>
  )
}

// ---- Online payments

const rupees = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const PAY_STATUS: Record<string, { label: string; tone: 'green' | 'slate' | 'amber' | 'red' | 'blue' }> = {
  paid: { label: 'Paid', tone: 'green' }, pending: { label: 'Not paid yet', tone: 'slate' }, review: { label: 'Paid: needs the office', tone: 'red' },
}

/** Students paying their fees online into the institute's own Razorpay account, and the payments made so far. */
function PaymentsTab({ d }: { d: NonNullable<SettingsData['admin']>['payments'] }) {
  const notify = useNotify()
  const router = useRouter()
  const [c, setC] = useState(d.config)
  const [keySecret, setKeySecret] = useState('')
  const [hookSecret, setHookSecret] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const ready = !!(c.keyId && (d.hasKeySecret || keySecret))
  const save = () => start(async () => {
    const r = await savePaymentsSettingsAction(c, keySecret || null, hookSecret || null)
    if (!r.ok) return setError(r.error)
    setError(''); setKeySecret(''); setHookSecret(''); notify('Online payment settings saved'); router.refresh()
  })
  return (
    <>
      <Section title="Online fee payments" about="Students pay what is due now (the next installment, or the balance) from their portal: UPI, cards, net banking and wallets, on Razorpay's own payment page. The money goes straight to your Razorpay account; the payment is recorded with a receipt, as at the desk."
        actions={<>{!c.enabled ? <Badge tone="slate">Off</Badge> : ready ? <Badge tone="green">On</Badge> : <Badge tone="amber">Needs keys</Badge>}</>}>
        <Toggle label="Students can pay online" value={c.enabled} set={(v) => setC({ ...c, enabled: v })} hint="Off: the portal says to pay at the branch office." />
        <div className="wl-form">
          <label>Key ID<input value={c.keyId} onChange={(e) => setC({ ...c, keyId: e.target.value.trim() })} placeholder="rzp_live_…" autoComplete="off" /></label>
          <label>Key secret{d.hasKeySecret ? ' (saved; type to change)' : ''}<PasswordInput value={keySecret} onChange={(e) => setKeySecret(e.target.value)} placeholder={d.hasKeySecret ? '••••••••' : ''} autoComplete="off" /></label>
          <label className="wide">Webhook secret{d.hasWebhookSecret ? ' (saved; type to change)' : ' (recommended)'}<PasswordInput value={hookSecret} onChange={(e) => setHookSecret(e.target.value)} placeholder={d.hasWebhookSecret ? '••••••••' : ''} autoComplete="off" /></label>
        </div>
        <p className="section-hint" style={{ margin: '4px 0 8px' }}>Webhook address (Razorpay → Settings → Webhooks, event <code>payment_link.paid</code>): <CopyText text={d.webhookUrl} label="Copy the webhook address" /></p>
        {c.enabled && !ready && <p className="section-hint" style={{ margin: '0 0 8px', color: '#92400e' }}>Without your Razorpay keys, students cannot pay online{process.env.NODE_ENV !== 'production' ? ' (here, outside production, a test payment page stands in)' : ''}.</p>}
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save online payments'}</button></div>
        <details className="set-help"><summary>How to set it up in Razorpay</summary><ol>
          <li>Sign in to <b>dashboard.razorpay.com</b> with the institute's account (KYC done, live mode on).</li>
          <li><b>Account &amp; Settings → API keys</b>: generate a key. Paste the <b>Key ID</b> and the <b>Key secret</b> above.</li>
          <li><b>Account &amp; Settings → Webhooks → Add new webhook</b>: the address above, a secret of your choice (paste it above too), and the event <i>payment_link.paid</i>.</li>
          <li>Save and switch on. A student's payment then appears below and as a receipt on their fees.</li>
        </ol></details>
      </Section>
      <Section title="Recent online payments" about="The newest first. “Needs the office”: the money was taken but could not be recorded as it was (e.g. the fee was paid at the desk meanwhile): refund it in Razorpay, or record it on the student's fees.">
        {!d.recent.length ? <p className="section-hint" style={{ margin: 0 }}>No online payments yet.</p> : (
          <div className="table-scroll"><table className="data-table">
            <thead><tr><th>When</th><th>Student</th><th>Branch</th><th>Amount</th><th>Status</th><th>Receipt / note</th></tr></thead>
            <tbody>{d.recent.map((p) => (
              <tr key={p.id}>
                <td>{when(p.createdAt)}</td><td>{p.name}<small style={{ display: 'block', color: 'var(--muted)' }}>{p.regNo}</small></td><td>{p.branch}</td><td>{rupees(p.amount)}</td>
                <td><Badge tone={PAY_STATUS[p.status]?.tone ?? 'slate'}>{PAY_STATUS[p.status]?.label ?? p.status}</Badge></td>
                <td>{p.receiptNo ? <a href={`/receipts/${encodeURIComponent(p.receiptNo)}`} target="_blank" rel="noreferrer">{p.receiptNo}</a> : p.note ?? '—'}{p.providerPaymentId && <small style={{ display: 'block', color: 'var(--muted)' }}>{p.providerPaymentId}</small>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </>
  )
}

// ---- Business rules

function RulesTab({ rules, canEdit }: { rules: RuleRow[]; canEdit: boolean }) {
  const notify = useNotify()
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(rules.map((r) => [r.key, String(r.value)])))
  const [pending, start] = useTransition()
  return (
    <Section title="Business rules" about="These apply to every branch. The panel reads them each time, so a change here takes effect at once.">
      <div className="set-rules">
        {rules.map((r) => (
          <div key={r.key} className="set-rule">
            <div><strong>{r.label}</strong><small>Allowed: {r.min} to {r.max}</small></div>
            <div className="row-actions">
              <input type="number" min={r.min} max={r.max} disabled={!canEdit} value={vals[r.key]} onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))} aria-label={r.label} />
              {canEdit && String(r.value) !== vals[r.key] && <button className="button primary small" disabled={pending} onClick={() => start(async () => { const res = await updateRuleAction(r.key, Number(vals[r.key])); notify(res.ok ? 'Rule updated' : res.error) })}>Save</button>}
            </div>
          </div>
        ))}
      </div>
      {!canEdit && <p className="section-hint" style={{ margin: '10px 0 0' }}>Only head office changes these.</p>}
    </Section>
  )
}

// ---- Numbering

function NumberingTab({ rows }: { rows: NumberingRow[] }) {
  const notify = useNotify()
  const router = useRouter()
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.kind, r.format ?? ''])))
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const changed = rows.some((r) => (r.format ?? '') !== vals[r.kind])
  return (
    <Section title="Number formats" about={<>How each number the panel gives out looks. Leave one blank for the default. A new format applies from the next number; numbers already given keep theirs. A branch’s own registration format (Branches) comes first for that branch.</>}>
      <div className="set-rules">
        {rows.map((r) => {
          const f = vals[r.kind].trim() || r.defaultFormat
          const why = vals[r.kind].trim() ? formatProblem(r.kind, f) : null
          return (
            <div key={r.kind} className="set-rule">
              <div><strong>{r.label}</strong><small>{r.perBranch ? 'Each branch counts its own.' : 'Counted for the whole institute.'} {why ? <span style={{ color: '#b91c1c' }}>{why}</span> : <>Next looks like <code>{renderNumber(f, r.perBranch ? 'MAIN' : '', 1)}</code></>}</small></div>
              <div className="row-actions"><input value={vals[r.kind]} placeholder={r.defaultFormat} maxLength={40} onChange={(e) => setVals((v) => ({ ...v, [r.kind]: e.target.value }))} aria-label={`${r.label} number format`} /></div>
            </div>
          )
        })}
      </div>
      <p className="section-hint" style={{ margin: '10px 0 0' }}>Parts: <code>{'{n}'}</code> the running number, <code>{'{nnnn}'}</code> the same with 4 digits (one n per digit), <code>{'{yyyy}'}</code> / <code>{'{yy}'}</code> the year, <code>{'{FY}'}</code> the financial year (2026-27), <code>{'{code}'}</code> the branch code. A year starts the count again each year, <code>{'{FY}'}</code> each financial year. Receipts always hold the branch and <code>{'{FY}'}</code> and end with the number.</p>
      <Err msg={error} />
      {changed && <div className="modal-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { setVals(Object.fromEntries(rows.map((r) => [r.kind, r.format ?? '']))); setError('') }}>Undo</button><button type="button" className="button primary" disabled={pending} onClick={() => start(async () => { const res = await saveNumberingAction(vals); if (!res.ok) return setError(res.error); setError(''); notify('Number formats saved'); router.refresh() })}>{pending ? 'Saving…' : 'Save formats'}</button></div>}
    </Section>
  )
}

// ---- E-mail

const PRESETS: { name: string; host: string; port: number; security: EmailConfig['security']; note: string }[] = [
  { name: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, security: 'ssl', note: 'Use a Google “app password” (Google account → Security → 2-Step Verification → App passwords), not the normal password.' },
  { name: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls', note: 'SMTP sending must be allowed for the mailbox in Microsoft 365 admin.' },
  { name: 'Zoho Mail (India)', host: 'smtp.zoho.in', port: 465, security: 'ssl', note: 'Use an app-specific password if two-factor sign-in is on.' },
  { name: 'Hostinger', host: 'smtp.hostinger.com', port: 465, security: 'ssl', note: 'The full mailbox address is the login.' },
]

/** The central mail server, or (with `branch`) that branch's own: then its students' and staff's mail goes out from it. */
function EmailTab({ d, branch }: { d: NonNullable<SettingsData['admin']>['email']; branch?: string }) {
  const brand = useBrand()
  const notify = useNotify()
  const router = useRouter()
  const [c, setC] = useState<EmailConfig>(d.config)
  const [password, setPassword] = useState('')
  const [to, setTo] = useState(d.config.alertEmail || '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const set = (p: Partial<EmailConfig>) => setC({ ...c, ...p })
  const save = () => start(async () => { setError(''); const r = await (branch ? saveBranchEmailAction : saveEmailSettingsAction)(c, password || null); if (!r.ok) return setError(r.error); setPassword(''); notify('E-mail settings saved'); router.refresh() })
  const test = () => start(async () => { setError(''); const r = await (branch ? testBranchEmailAction : testEmailAction)(to); if (!r.ok) return setError(r.error); notify(`Test e-mail sent to ${to} (${r.data})`) })
  const source = d.saved ? `Saved here ${when(d.updatedAt)}` : branch ? 'Not set up yet: this branch’s mail goes out from the central (head office) mail server' : c.enabled ? 'Taken from the server settings (environment)' : 'Not set up'
  return (
    <>
      <Section title={branch ? `Branch e-mail — ${branch}` : 'E-mail (outgoing mail server)'}
        about={branch
          ? 'This branch’s own mailbox. Once it is on, mail for this branch — student and staff logins, fee reminders — goes out from it instead of the central one. Sign-in codes and “forgot password” links still come from head office.'
          : 'Used for staff and student logins, “forgot password” links, sign-in codes, alerts and (when chosen) fee reminders. A branch that sets up its own mailbox (Settings → Branch e-mail) sends its mail from that instead.'}
        actions={<>{c.enabled && (d.hasPassword || password) ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}</>}>
        <p className="section-hint" style={{ margin: '0 0 12px' }}>{source}.</p>
        <Toggle label={branch ? 'Send this branch’s e-mail from this mailbox' : 'Send e-mail'} value={c.enabled} set={(v) => set({ enabled: v })} hint={branch ? 'Off: the central mail server is used instead.' : 'Off: nothing is e-mailed (logins then show on screen once instead).'} />
        <div className="set-presets"><span>Quick fill:</span>{PRESETS.map((p) => <button key={p.name} type="button" className="filter-button" onClick={() => { set({ host: p.host, port: p.port, security: p.security }); notify(p.note) }}>{p.name}</button>)}</div>
        <div className="wl-form">
          <label>Mail server (SMTP host)<input value={c.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp.gmail.com" /></label>
          <label>Port<input type="number" value={c.port} onChange={(e) => set({ port: Number(e.target.value) })} /></label>
          <label>Security<select value={c.security} onChange={(e) => set({ security: e.target.value as EmailConfig['security'] })}><option value="ssl">SSL/TLS (usually port 465)</option><option value="starttls">STARTTLS (usually port 587)</option><option value="none">None (not recommended)</option></select></label>
          <label>Login (username)<input value={c.user} onChange={(e) => set({ user: e.target.value })} placeholder="office@yourinstitute.com" autoComplete="off" /></label>
          <label className="wide">Password{d.hasPassword && <span className="set-saved"> · saved — leave empty to keep it</span>}<PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={d.hasPassword ? '••••••••••' : 'The mailbox or app password'} autoComplete="new-password" /></label>
          <label>Sender name<input value={c.fromName} onChange={(e) => set({ fromName: e.target.value })} placeholder={branch ? `${brand.name} ${branch}` : brand.name} /></label>
          <label>Sender address<input value={c.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} placeholder="Same as the login if empty" /></label>
          <label>Reply-to (optional)<input value={c.replyTo} onChange={(e) => set({ replyTo: e.target.value })} placeholder="admissions@yourinstitute.com" /></label>
          {!branch && <label>Alert e-mail (optional)<input value={c.alertEmail} onChange={(e) => set({ alertEmail: e.target.value })} placeholder="Gets an e-mail when a daily job fails" /></label>}
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save e-mail settings'}</button></div>
      </Section>
      <Section title="Send a test e-mail" about="Save first, then send a test to check the server, login and sender address work.">
        <div className="set-inline"><input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" aria-label="Test e-mail address" /><button type="button" className="button secondary" disabled={pending || !to} onClick={test}><Send size={14} /> Send test</button></div>
      </Section>
    </>
  )
}

// ---- WhatsApp & SMS

function MessagingTab({ wa, sms }: { wa: NonNullable<SettingsData['admin']>['whatsapp']; sms: NonNullable<SettingsData['admin']>['sms'] }) {
  const brand = useBrand()
  const notify = useNotify()
  const router = useRouter()
  const [w, setW] = useState<WhatsAppConfig>(wa.config)
  const [token, setToken] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [s, setS] = useState<SmsConfig>(sms.config)
  const [authKey, setAuthKey] = useState('')
  const [waTo, setWaTo] = useState('')
  const [smsTo, setSmsTo] = useState('')
  const [error, setError] = useState<{ wa?: string; sms?: string }>({})
  const [pending, start] = useTransition()
  const saveWa = () => start(async () => { const r = await saveWhatsappSettingsAction(w, { token: token || null, apiKey: apiKey || null }); setError({ ...error, wa: r.ok ? '' : r.error }); if (r.ok) { setToken(''); setApiKey(''); notify(r.data ? 'WhatsApp is on: fee reminders now go on WhatsApp too' : 'WhatsApp settings saved'); router.refresh() } })
  const saveSms = () => start(async () => { const r = await saveSmsSettingsAction(s, authKey || null); setError({ ...error, sms: r.ok ? '' : r.error }); if (r.ok) { setAuthKey(''); notify('SMS settings saved'); router.refresh() } })
  const test = (ch: 'whatsapp' | 'sms', to: string) => start(async () => { const r = await testMessageAction(ch, to); if (!r.ok) return setError({ ...error, [ch === 'whatsapp' ? 'wa' : 'sms']: r.error }); notify(`Test sent to ${to} (${r.data})`) })
  const aisensy = w.provider !== 'meta'
  const waOn = w.enabled && (aisensy ? wa.hasApiKey || !!apiKey : !!w.phoneNumberId && (wa.hasToken || !!token))
  const smsOn = s.enabled && !!s.templateId && (sms.hasAuthKey || !!authKey)
  return (
    <>
      <Section title="WhatsApp" about="Sends fee reminders, and a message on a new lead or call, a visit, a registration and an issued certificate. Until it is switched on, fee reminders wait in the queue and event messages are not made."
        actions={waOn ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}>
        <Toggle label="Send on WhatsApp" value={w.enabled} set={(v) => setW({ ...w, enabled: v })} />
        <div className="wl-form">
          <label>Sent through<select value={w.provider} onChange={(e) => setW({ ...w, provider: e.target.value as WhatsAppConfig['provider'] })}>
            <option value="aisensy">AiSensy (API campaigns)</option><option value="meta">Meta WhatsApp Cloud API (direct)</option>
          </select></label>
          <label>Country of the mobile numbers<CountrySelect value={w.countryCode} set={(v) => setW({ ...w, countryCode: v })} /></label>
          {aisensy ? <>
            <label className="wide">AiSensy API key{wa.hasApiKey && <span className="set-saved"> · saved — leave empty to keep it</span>}<PasswordInput value={apiKey} onChange={(e) => { setApiKey(e.target.value); if (!wa.hasApiKey && e.target.value.trim()) setW({ ...w, enabled: true }) }} placeholder={wa.hasApiKey ? '••••••••••' : 'AiSensy → Developer → API Campaign Key'} autoComplete="new-password" /></label>
            {WA_KEYS.map((k) => <label key={k}>{WA_MESSAGES[k].label}: API campaign<input value={w.campaigns?.[k] ?? ''} onChange={(e) => setW({ ...w, campaigns: { ...w.campaigns, [k]: e.target.value.trim() } })} placeholder={WA_MESSAGES[k].campaign} /></label>)}
          </> : <>
            <label>Phone number ID<input value={w.phoneNumberId} onChange={(e) => setW({ ...w, phoneNumberId: e.target.value.trim() })} placeholder="e.g. 123456789012345" /></label>
            <label>WhatsApp Business account ID<input value={w.businessAccountId} onChange={(e) => setW({ ...w, businessAccountId: e.target.value.trim() })} placeholder="e.g. 102938475610293" /></label>
            <label className="wide">Access token{wa.hasToken && <span className="set-saved"> · saved — leave empty to keep it</span>}<PasswordInput value={token} onChange={(e) => setToken(e.target.value)} placeholder={wa.hasToken ? '••••••••••' : 'A permanent token of a System User'} autoComplete="new-password" /></label>
            <label>Fee reminder template name<input value={w.reminderTemplate} onChange={(e) => setW({ ...w, reminderTemplate: e.target.value.trim() })} placeholder="fee_reminder" /></label>
            <label>Template language<input value={w.language} onChange={(e) => setW({ ...w, language: e.target.value.trim() })} placeholder="en" /></label>
            <label>Graph API version<input value={w.apiVersion} onChange={(e) => setW({ ...w, apiVersion: e.target.value.trim() })} placeholder="v20.0" /></label>
          </>}
        </div>
        <div style={{ marginTop: 12 }}>
          <b>Messages on events</b>
          {WA_EVENT_KEYS.map((k) => (WA_MESSAGES[k] as { optIn?: boolean }).optIn
            // a message that is off until switched on (its template is new): `on` lists it
            ? <Toggle key={k} label={WA_MESSAGES[k].label} hint={WA_MESSAGES[k].when} value={!!w.on?.includes(k)}
              set={(v) => setW({ ...w, on: v ? [...(w.on ?? []).filter((x) => x !== k), k] : (w.on ?? []).filter((x) => x !== k) })} />
            : <Toggle key={k} label={WA_MESSAGES[k].label} hint={WA_MESSAGES[k].when} value={!w.off?.includes(k)}
              set={(v) => setW({ ...w, off: v ? (w.off ?? []).filter((x) => x !== k) : [...(w.off ?? []), k] })} />)}
        </div>
        <Err msg={error.wa ?? ''} />
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={saveWa}>Save WhatsApp settings</button></div>
        <div className="set-inline" style={{ marginTop: 10 }}><input value={waTo} onChange={(e) => setWaTo(e.target.value)} placeholder="Mobile number for a test, e.g. 98xxxxxxxx" aria-label="WhatsApp test number" /><button type="button" className="button secondary" disabled={pending || !waTo} onClick={() => test('whatsapp', waTo)}><Send size={14} /> Send test</button></div>
        {aisensy ? <details className="set-help"><summary>How to set it up in AiSensy</summary><ol>
          <li>In <b>AiSensy → Manage → Template Message</b>, create each template below exactly as shown (category, name, language <i>English</i>, body) and wait for it to be <b>Approved</b>.</li>
          <li>In <b>Campaigns → Launch → API campaign</b>, create a campaign with the name shown, choose its template and set it <b>Live</b>. The name must match the box above (empty = the name shown).</li>
          <li>In <b>Developer → API Campaign Key</b>, copy the key and paste it above. One key serves the whole AiSensy project: regenerating it stops every other system that uses the old one.</li>
          <li>Save, switch on, and send a test to your own number. The fee reminder wording is set in Settings → Reminders and fills its {'{{1}}'}.</li>
          {WA_KEYS.map((k) => { const m = WA_MESSAGES[k]; return <li key={k}><b>{m.label}</b> — campaign <code>{m.campaign}</code>, template <code>{m.template.name}</code> ({m.template.category}, English):<pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{waBody(k, brand.name)}</pre></li> })}
        </ol></details> : <details className="set-help"><summary>How to get these from Meta</summary><ol>
          <li>In <b>Meta Business Suite → WhatsApp Manager</b>, add and verify the institute’s phone number.</li>
          <li>In <b>developers.facebook.com → your app → WhatsApp → API Setup</b>, copy the <b>Phone number ID</b> and the <b>WhatsApp Business account ID</b>.</li>
          <li>In <b>Business Settings → Users → System users</b>, add a system user with the <i>whatsapp_business_messaging</i> permission and generate a <b>permanent token</b>. Paste it as the access token.</li>
          <li>In <b>WhatsApp Manager → Message templates</b>, create a <i>Utility</i> template whose body is one variable, e.g. <code>{'{{1}}'}</code>. The reminder text (Settings → Reminders) fills it. When it is approved, put its name above.</li>
          <li>Save, switch on, and send a test to your own number.</li>
        </ol></details>}
      </Section>
      <Section title="SMS (MSG91)" about="Sends fee reminders by SMS. Indian SMS needs a DLT-approved template." actions={smsOn ? <Badge tone="green">On</Badge> : <Badge tone="slate">Off</Badge>}>
        <Toggle label="Send by SMS" value={s.enabled} set={(v) => setS({ ...s, enabled: v })} />
        <div className="wl-form">
          <label className="wide">MSG91 auth key{sms.hasAuthKey && <span className="set-saved"> · saved — leave empty to keep it</span>}<PasswordInput value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder={sms.hasAuthKey ? '••••••••••' : 'MSG91 → API → Auth key'} autoComplete="new-password" /></label>
          <label>Flow template ID<input value={s.templateId} onChange={(e) => setS({ ...s, templateId: e.target.value.trim() })} placeholder="DLT-approved flow ID" /></label>
          <label>Sender ID (optional)<input value={s.senderId} onChange={(e) => setS({ ...s, senderId: e.target.value.trim().toUpperCase() })} placeholder="TCADD" /></label>
          <label>Country of the mobile numbers<CountrySelect value={s.countryCode} set={(v) => setS({ ...s, countryCode: v })} /></label>
        </div>
        <Err msg={error.sms ?? ''} />
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={saveSms}>Save SMS settings</button></div>
        <div className="set-inline" style={{ marginTop: 10 }}><input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="Mobile number for a test" aria-label="SMS test number" /><button type="button" className="button secondary" disabled={pending || !smsTo} onClick={() => test('sms', smsTo)}><Send size={14} /> Send test</button></div>
      </Section>
    </>
  )
}

// ---- Reminders

const SAMPLE = { name: 'Aman Gill', first_name: 'Aman', amount: '₹5,000', due_date: '15 Nov 2026', reg_no: 'REG-2026-MOH-0042', branch: 'Mohali', institute: 'Your institute' }
const fillSample = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (SAMPLE as Record<string, string>)[k] ?? m)
const FILLINS = ['first_name', 'name', 'amount', 'due_date', 'reg_no', 'branch', 'institute']
const CHANNELS = [
  { key: 'sms', label: 'SMS', icon: Smartphone, note: 'MSG91, DLT template' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, note: 'AiSensy, approved template' },
  { key: 'email', label: 'E-mail', icon: Mail, note: 'Your mail server' },
] as const

/** Days as removable chips, with a small box to add one. */
function DayChips({ values, set, tone, unit }: { values: number[]; set: (v: number[]) => void; tone: 'soon' | 'late'; unit: string }) {
  const [draft, setDraft] = useState('')
  const add = () => { const n = Number(draft); if (Number.isInteger(n) && n > 0 && n <= 120 && !values.includes(n)) set([...values, n].sort((a, b) => a - b)); setDraft('') }
  return (
    <div className="rem-chips">
      {values.map((d) => <span key={d} className={`rem-chip ${tone}`}>{d} {d === 1 ? 'day' : 'days'} {unit}<button type="button" onClick={() => set(values.filter((x) => x !== d))} aria-label={`Remove ${d} days ${unit}`}><X size={12} /></button></span>)}
      <span className="rem-add"><input inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder="days" aria-label={`Add days ${unit}`} /><button type="button" onClick={add} disabled={!draft}><Plus size={13} /> Add</button></span>
    </div>
  )
}

function RemindersTab({ cfg, ready, goJobs, goChannels }: { cfg: RemindersConfig; ready: Record<string, boolean>; goJobs: () => void; goChannels: () => void }) {
  const notify = useNotify()
  const router = useRouter()
  const [c, setC] = useState(cfg)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const dirty = JSON.stringify(c) !== JSON.stringify(cfg)
  const toggle = (ch: RemindersConfig['channels'][number]) => setC({ ...c, channels: c.channels.includes(ch) ? c.channels.filter((x) => x !== ch) : [...c.channels, ch] })
  const save = () => start(async () => { const r = await saveRemindersAction(c); if (!r.ok) return setError(r.error); setError(''); notify('Reminder settings saved'); router.refresh() })
  const steps = [
    ...[...c.daysBefore].sort((a, b) => b - a).map((d) => ({ key: `b${d}`, tone: 'soon', top: `${d} day${d === 1 ? '' : 's'}`, bottom: 'before' })),
    ...(c.onDueDay ? [{ key: 'due', tone: 'due', top: 'Due date', bottom: 'same day' }] : []),
    ...[...c.overdueDays].sort((a, b) => a - b).map((d) => ({ key: `a${d}`, tone: 'late', top: `${d} day${d === 1 ? '' : 's'}`, bottom: 'overdue' })),
  ]
  const notReady = c.channels.filter((ch) => !ready[ch])
  return (
    <div className="rem">
      <div className="panel rem-hero">
        <div className="rem-hero-icon"><BellRing size={22} /></div>
        <div>
          <h2>Fee reminders</h2>
          <p>Every installment that is coming up or overdue gets a reminder at each step below, once. They go out every day at the time set under <button type="button" className="link-button" onClick={goJobs}>Scheduled jobs</button>. Students on hold or discontinued get none.</p>
        </div>
        <div className="rem-hero-stat"><strong>{steps.length * Math.max(c.channels.length, 1)}</strong><span>message{steps.length * c.channels.length === 1 ? '' : 's'} per installment at most</span></div>
      </div>

      <div className="panel set-card">
        <div className="rem-step-head"><span className="rem-num">1</span><div><h2>Send by</h2><p>Tick one or more. A message goes on each ticked channel.</p></div></div>
        <div className="rem-channels">
          {CHANNELS.map((ch) => {
            const on = c.channels.includes(ch.key)
            return (
              <button key={ch.key} type="button" className={`rem-channel${on ? ' on' : ''}`} onClick={() => toggle(ch.key)} aria-pressed={on}>
                <span className="rem-channel-icon"><ch.icon size={18} /></span>
                <span className="rem-channel-text"><strong>{ch.label}</strong><small>{ch.note}</small></span>
                <span className="rem-channel-state">{ready[ch.key] ? <Badge tone="green">Set up</Badge> : <Badge tone="amber">Not set up</Badge>}<span className={`rem-tick${on ? ' on' : ''}`}>{on && <Check size={13} />}</span></span>
              </button>
            )
          })}
        </div>
        {notReady.length > 0 && <p className="rem-warn">{notReady.map((x) => CHANNELS.find((k) => k.key === x)!.label).join(' and ')} {notReady.length === 1 ? 'is' : 'are'} not set up yet: those reminders wait in the queue and go once {notReady.length === 1 ? 'it is' : 'they are'} set up. <button type="button" className="link-button" onClick={goChannels}>Set up now</button></p>}
        {!c.channels.length && <p className="rem-warn">No channel ticked: no reminder will be sent.</p>}
      </div>

      <div className="panel set-card">
        <div className="rem-step-head"><span className="rem-num">2</span><div><h2>When</h2><p>The steps each installment goes through. Add or remove days.</p></div></div>
        <div className="rem-timeline">
          {steps.length ? steps.map((s, i) => (
            <div key={s.key} className={`rem-dot ${s.tone}`}>
              <span className="rem-bullet" />{i < steps.length - 1 && <span className="rem-line" />}
              <strong>{s.top}</strong><small>{s.bottom}</small>
            </div>
          )) : <p className="section-hint" style={{ margin: 0 }}>No step: nothing will be sent.</p>}
        </div>
        <div className="rem-when">
          <div><h3>Before the due date</h3><DayChips values={c.daysBefore} set={(v) => setC({ ...c, daysBefore: v })} tone="soon" unit="before" /></div>
          <div><h3>On the due date</h3><Toggle label="Remind on the day it is due" value={c.onDueDay} set={(v) => setC({ ...c, onDueDay: v })} /></div>
          <div><h3>After it is overdue</h3><DayChips values={c.overdueDays} set={(v) => setC({ ...c, overdueDays: v })} tone="late" unit="overdue" /></div>
        </div>
      </div>

      <div className="panel set-card">
        <div className="rem-step-head"><span className="rem-num">3</span><div><h2>Wording</h2><p>Click a fill-in to add it where the cursor is. SMS must match your DLT template word for word.</p></div></div>
        <div className="rem-messages">
          {([['soon', 'Before the due date', 'soon'], ['today', 'On the due date', 'due'], ['overdue', 'Overdue', 'late']] as const).map(([k, label, tone]) => (
            <div key={k} className={`rem-msg ${tone}`}>
              <div className="rem-msg-head"><span className={`rem-pill ${tone}`}>{label}</span><small>{c.texts[k].length} characters</small></div>
              <textarea id={`rem-${k}`} rows={4} value={c.texts[k]} onChange={(e) => setC({ ...c, texts: { ...c.texts, [k]: e.target.value } })} aria-label={`${label} message`} />
              <div className="rem-fillins">
                {FILLINS.map((f) => (
                  <button key={f} type="button" onClick={() => {
                    const el = document.getElementById(`rem-${k}`) as HTMLTextAreaElement | null
                    const t = c.texts[k], at = el?.selectionStart ?? t.length, ins = `{{${f}}}`
                    setC({ ...c, texts: { ...c.texts, [k]: t.slice(0, at) + ins + t.slice(el?.selectionEnd ?? at) } })
                  }}>{f}</button>
                ))}
              </div>
              <div className="rem-bubble"><small>Preview</small><p>{fillSample(c.texts[k])}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div className={`rem-savebar${dirty ? ' dirty' : ''}`}>
        <span>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <Err msg={error} />
        <div className="row-actions">
          {dirty && <button type="button" className="button secondary" onClick={() => { setC(cfg); setError('') }}>Undo changes</button>}
          <button type="button" className="button primary" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save reminder settings'}</button>
        </div>
      </div>
    </div>
  )
}

// ---- Scheduled jobs

function JobsTab({ cfg, info, runs, cronSecretSet, origin }: { cfg: JobsConfig; info: Record<string, { label: string; what: string }>; runs: NonNullable<SettingsData['admin']>['runs']; cronSecretSet: boolean; origin: string }) {
  const notify = useNotify()
  const router = useRouter()
  const [c, setC] = useState<JobsConfig>({ ...cfg, purge: cfg.purge ?? { enabled: true, time: '03:00' } })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => { const r = await saveJobsAction(c); if (!r.ok) return setError(r.error); setError(''); notify('Schedule saved'); router.refresh() })
  const runNow = (job: 'reminders' | 'reconcile' | 'purge' | 'escalations') => start(async () => { const r = await runJobNowAction(job); notify(r.ok ? `${info[job].label}: done — ${Object.entries(r.data ?? {}).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k} ${v}`).join(', ')}` : r.error); router.refresh() })
  const last = (job: string) => runs.find((r) => r.job === job)
  return (
    <>
      <Section title="Who runs the jobs">
        <div className="set-checks">
          <label className={`set-check${c.scheduler === 'panel' ? ' on' : ''}`}><input type="radio" name="sched" checked={c.scheduler === 'panel'} onChange={() => setC({ ...c, scheduler: 'panel' })} /><span><b>The panel itself</b> (recommended) — at the times below, India time. Nothing to set up outside.</span></label>
          <label className={`set-check${c.scheduler === 'external' ? ' on' : ''}`}><input type="radio" name="sched" checked={c.scheduler === 'external'} onChange={() => setC({ ...c, scheduler: 'external' })} /><span><b>An outside scheduler</b> (Coolify Scheduled Task or cron) calls the job addresses below.</span></label>
        </div>
      </Section>
      {(['reminders', 'reconcile', 'purge', 'escalations'] as const).map((job) => {
        const l = last(job)
        return (
          <Section key={job} title={info[job].label} about={info[job].what}
            actions={<>{l ? (l.ok === false ? <Badge tone="red">Last run failed</Badge> : l.ok ? <Badge tone="green">Last run OK</Badge> : <Badge tone="amber">Running</Badge>) : <Badge tone="slate">Never run</Badge>}<button type="button" className="filter-button" disabled={pending} onClick={() => runNow(job)}>Run now</button></>}>
            <div className="set-job">
              <Toggle label="Run every day" value={c[job].enabled} set={(v) => setC({ ...c, [job]: { ...c[job], enabled: v } })} />
              <label>At (India time)<input type="time" value={c[job].time} onChange={(e) => setC({ ...c, [job]: { ...c[job], time: e.target.value } })} disabled={c.scheduler !== 'panel'} /></label>
              <div className="set-last"><small>Last run</small><strong>{l ? when(l.startedAt) : '—'}</strong>{l?.error && <small className="text-red">{l.error}</small>}</div>
            </div>
            {c.scheduler === 'external' && <div className="set-code"><small>Call once a day (needs CRON_SECRET on the server{cronSecretSet ? ', which is set' : ' — not set yet'}):</small><CopyText text={`wget -qO- --header="Authorization: Bearer $CRON_SECRET" --post-data='' ${origin}/api/jobs/${job}`} /></div>}
          </Section>
        )
      })}
      <Err msg={error} />
      <div className="modal-actions" style={{ marginBottom: 14 }}><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save schedule'}</button></div>
      <Section title="Recent runs" about="Every run, by the panel, Run now or an outside scheduler. Webhooks are sent every minute and keep their own log (Integrations).">
        <div className="table-scroll"><table>
          <thead><tr><th>Job</th><th>Started</th><th>Result</th><th>Details</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td><strong>{info[r.job]?.label ?? r.job}</strong></td><td>{when(r.startedAt)}</td>
                <td>{r.ok === false ? <Badge tone="red">Failed</Badge> : r.ok ? <Badge tone="green">OK</Badge> : <Badge tone="amber">Running</Badge>}</td>
                <td className="set-summary">{r.error ?? Object.entries(r.summary ?? {}).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No run yet.</td></tr>}
          </tbody>
        </table></div>
      </Section>
    </>
  )
}

// ---- Integrations: status, and webhooks for n8n / Zapier / Make

function IntegrationsTab({ status, hooks, events, origin, webLeadsOn }: { status: IntegrationsData | null; hooks: WebhookRow[]; events: { key: string; label: string; what: string }[]; origin: string; webLeadsOn: boolean }) {
  const notify = useNotify()
  const router = useRouter()
  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null)
  const [log, setLog] = useState<{ hook: WebhookRow; rows: DeliveryRow[] } | null>(null)
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const label = (k: string) => (k === '*' ? 'Every event' : events.find((e) => e.key === k)?.label ?? k)
  return (
    <>
      <Section title="Webhooks — n8n, Zapier, Make and others" about="When something happens in the panel, it sends the details to your tool’s webhook address, within a minute. Use it to add leads to Google Sheets, message the team, start a follow-up flow, fill a CRM…"
        actions={<button type="button" className="button primary small" onClick={() => setEditing('new')}><Plus size={14} /> Add webhook</button>}>
        {!hooks.length && <p className="section-hint" style={{ margin: 0 }}>No webhook yet. Add one with the address your tool gives you (see “How to connect” below).</p>}
        <div className="set-hooks">
          {hooks.map((h) => (
            <div key={h.id} className="set-hook">
              <div className="set-hook-main">
                <div className="set-hook-title"><Webhook size={15} /><strong>{h.name}</strong>{h.isActive ? <Badge tone="green">On</Badge> : <Badge tone="slate">Paused</Badge>}{h.lastStatus != null && (h.lastStatus < 300 ? <Badge tone="blue">Last: {h.lastStatus}</Badge> : <Badge tone="red">Last: {h.lastStatus}</Badge>)}</div>
                <small className="set-url">{h.url}</small>
                <div className="doc-chips">{h.events.map((e) => <span key={e} className="doc-chip done">{label(e)}</span>)}</div>
                <small>Sent {h.sent} · waiting {h.pending} · failed {h.failed}{h.lastDeliveryAt ? ` · last ${when(h.lastDeliveryAt)}` : ''}{h.lastError ? ` · ${h.lastError}` : ''}</small>
              </div>
              <div className="row-actions">
                <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await testWebhookAction(h.id); notify(r.ok ? (r.data!.ok ? `Test delivered (HTTP ${r.data!.status})` : `Test failed: ${r.data!.error}`) : r.error); router.refresh() })}><Send size={13} /> Test</button>
                <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await webhookDeliveriesAction(h.id); if (r.ok) setLog({ hook: h, rows: r.data! }); else notify(r.error) })}>Log</button>
                <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await webhookSecretAction(h.id); if (r.ok && r.data) setSecret({ name: h.name, value: r.data }); else notify(r.ok ? 'Secret unreadable' : r.error) })}>Secret</button>
                <button type="button" className="filter-button" onClick={() => setEditing(h)}>Edit</button>
                {confirm === h.id
                  ? <button type="button" className="button wl-danger-fill small" disabled={pending} onClick={() => start(async () => { const r = await deleteWebhookAction(h.id); notify(r.ok ? 'Webhook deleted' : r.error); setConfirm(null); router.refresh() })}>Delete for good</button>
                  : <button type="button" className="filter-button icon-only" title="Delete" aria-label={`Delete ${h.name}`} onClick={() => setConfirm(h.id)}><Trash2 size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Website forms" about="Your websites send the leads from their enquiry forms here; they arrive under Web Leads. Send them from the website’s server, never from the browser: the secret must stay private.">
        {webLeadsOn ? <>
          <div className="set-code"><small>Address (POST, JSON)</small><CopyText text={`${origin}/api/webhooks/web-leads`} /></div>
          <div className="set-params">
            <div><code>Authorization: Bearer YOUR_SECRET</code><small>Your institute’s own secret (below).</small></div>
            <div><code>{'{ "site", "name", "phone", "email", "course", "message", "externalId" }'}</code><small>One lead, or an array of up to 500. The same site and <code>externalId</code> sent again adds nothing.</small></div>
          </div>
          <button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await webLeadsSecretAction(); if (r.ok && r.data) setSecret({ name: 'website forms', value: r.data }); else notify(r.ok ? 'Secret unreadable' : r.error) })}><KeyRound size={13} /> Show secret</button>
        </> : <p className="section-hint" style={{ margin: 0 }}>Not switched on for this server yet: the platform needs <code>WEBLEADS_SECRET</code> set.</p>}
      </Section>
      <Section title="Events" about="What each event sends. Every delivery is a JSON POST: { event, id, occurredAt, data }.">
        <div className="set-events">{events.map((e) => <div key={e.key}><code>{e.key}</code><strong>{e.label}</strong><small>{e.what}</small></div>)}</div>
      </Section>
      <Section title="How to connect">
        <details className="set-help" open><summary>n8n</summary><ol>
          <li>Add a <b>Webhook</b> node, method <b>POST</b>; copy its <b>Production URL</b>.</li>
          <li>Here, <b>Add webhook</b> with that URL and pick the events. Activate the workflow in n8n, then press <b>Test</b> here.</li>
          <li>The data is under <code>body.data</code> (e.g. <code>{'{{$json.body.data.phone}}'}</code>). Add a Google Sheets, Slack, WhatsApp or HTTP node after it.</li>
        </ol></details>
        <details className="set-help"><summary>Zapier</summary><ol><li>Make a Zap with trigger <b>Webhooks by Zapier → Catch Hook</b> and copy the hook URL.</li><li>Add it here, press <b>Test</b>, then in Zapier “Test trigger” to pick up the sample.</li></ol></details>
        <details className="set-help"><summary>Make (Integromat)</summary><ol><li>Add the <b>Webhooks → Custom webhook</b> module, copy the address.</li><li>Add it here and press <b>Test</b> so Make learns the data structure.</li></ol></details>
        <details className="set-help"><summary>Checking it really came from the panel (optional)</summary><p>Each request has <code>X-Signature: sha256=…</code>, an HMAC-SHA256 of the raw body using the webhook’s <b>Secret</b>. Compute the same and compare. Also sent: <code>X-Event</code> and <code>X-Delivery</code>.</p><p>Failed deliveries are retried after 1 min, 5 min, 30 min, 2 h and 6 h.</p></details>
      </Section>
      {status && <Section title="Connection status" about="Each outside service, whether it is working, and how to set it up."><IntegrationsPanel data={status} isSuper embedded /></Section>}
      {editing && <WebhookForm hook={editing === 'new' ? null : editing} events={events} onClose={() => setEditing(null)} onDone={(m, s) => { setEditing(null); notify(m); if (s) setSecret(s); router.refresh() }} />}
      {log && (
        <Modal title={`Deliveries — ${log.hook.name}`} onClose={() => setLog(null)}>
          <div className="table-scroll" style={{ maxHeight: 420 }}><table>
            <thead><tr><th>When</th><th>Event</th><th>Result</th><th>Tries</th></tr></thead>
            <tbody>
              {log.rows.map((d) => <tr key={d.id} title={JSON.stringify(d.payload, null, 2)}><td>{when(d.createdAt)}</td><td><code>{d.event}</code></td><td>{d.status === 'sent' ? <Badge tone="green">Sent{d.responseStatus ? ` ${d.responseStatus}` : ''}</Badge> : d.status === 'failed' ? <Badge tone="red">{d.error ?? 'Failed'}</Badge> : <Badge tone="amber">{d.error ? `Retrying: ${d.error}` : 'Waiting'}</Badge>}</td><td>{d.attempts}</td></tr>)}
              {!log.rows.length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>Nothing sent yet.</td></tr>}
            </tbody>
          </table></div>
          <p className="section-hint">Point at a row to see what was sent.</p>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setLog(null)}>Close</button></div>
        </Modal>
      )}
      {secret && (
        <Modal title={secret.name === 'website forms' ? 'Website forms secret' : `Signing secret — ${secret.name}`} onClose={() => setSecret(null)}>
          <p className="section-hint" style={{ margin: '-6px 0 10px' }}>{secret.name === 'website forms' ? 'Put it in your website’s server settings. Keep it private.' : 'Only needed if your tool checks the signature. Keep it private.'}</p>
          <CopyText text={secret.value} label="Copy secret" />
          <div className="modal-actions"><button type="button" className="button primary" onClick={() => setSecret(null)}>Done</button></div>
        </Modal>
      )}
    </>
  )
}

function WebhookForm({ hook, events, onClose, onDone }: { hook: WebhookRow | null; events: { key: string; label: string; what: string }[]; onClose: () => void; onDone: (m: string, secret?: { name: string; value: string }) => void }) {
  const [name, setName] = useState(hook?.name ?? '')
  const [url, setUrl] = useState(hook?.url ?? '')
  const [picked, setPicked] = useState<string[]>(hook?.events ?? ['lead.created'])
  const [active, setActive] = useState(hook?.isActive ?? true)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const all = picked.includes('*')
  const flip = (k: string) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked.filter((x) => x !== '*'), k])
  return (
    <Modal title={hook ? `Edit webhook — ${hook.name}` : 'Add webhook'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        if (hook) { const r = await updateWebhookAction(hook.id, { name, url, events: picked, isActive: active }); if (!r.ok) return setError(r.error); onDone('Webhook saved') }
        else { const r = await createWebhookAction({ name, url, events: picked }); if (!r.ok) return setError(r.error); onDone('Webhook added: press Test to check it', { name, value: r.data!.secret }) }
      }) }}>
        <div className="wl-form">
          <label className="wide">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. n8n — new leads to Google Sheet" required /></label>
          <label className="wide">Webhook address (URL)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://n8n.yourdomain.com/webhook/…" required /></label>
        </div>
        <h3 className="set-sub">Send these events</h3>
        <div className="set-checks col">
          <label className={`set-check${all ? ' on' : ''}`}><input type="checkbox" checked={all} onChange={() => setPicked(all ? [] : ['*'])} /><span><b>Every event</b> (also ones added later)</span></label>
          {events.map((e) => <label key={e.key} className={`set-check${picked.includes(e.key) || all ? ' on' : ''}`}><input type="checkbox" disabled={all} checked={all || picked.includes(e.key)} onChange={() => flip(e.key)} /><span><b>{e.label}</b> <code>{e.key}</code><small>{e.what}</small></span></label>)}
        </div>
        {hook && <Toggle label="Active" value={active} set={setActive} hint="Paused webhooks get nothing (events are not kept for them)." />}
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : hook ? 'Save' : 'Add webhook'}</button></div>
      </form>
    </Modal>
  )
}

// ---- API access

function ApiTab({ keys, datasets, branches, origin }: { keys: ApiKeyRow[]; datasets: NonNullable<SettingsData['admin']>['datasets']; branches: { id: string; name: string; code: string }[]; origin: string }) {
  const notify = useNotify()
  const router = useRouter()
  const [making, setMaking] = useState(false)
  const [made, setMade] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const base = `${origin}/api/v1`
  const live = keys.filter((k) => !k.revokedAt)
  return (
    <>
      <Section title="API keys" about="Read-only keys for business tools: Power BI, Excel, Google Looker Studio, Metabase, n8n, your own scripts. Each key reads only the data you tick, optionally for one branch."
        actions={<button type="button" className="button primary small" onClick={() => setMaking(true)}><Plus size={14} /> New API key</button>}>
        <div className="table-scroll"><table>
          <thead><tr><th>Name</th><th>Key</th><th>Can read</th><th>Branch</th><th>Last used</th><th>Status</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => {
              const expired = !!k.expiresAt && new Date(k.expiresAt) < new Date()
              return (
                <tr key={k.id}>
                  <td><strong>{k.name}</strong><small>Made {when(k.createdAt)}</small></td>
                  <td><code>{k.prefix}…</code></td>
                  <td><div className="doc-chips">{k.scopes.map((s) => <span key={s} className="doc-chip done">{s}</span>)}</div></td>
                  <td>{k.branch ?? 'All branches'}</td>
                  <td>{k.lastUsedAt ? <>{when(k.lastUsedAt)}<small>{k.useCount} calls{k.lastUsedIp ? ` · ${k.lastUsedIp}` : ''}</small></> : 'Never'}</td>
                  <td>{k.revokedAt ? <Badge tone="slate">Revoked</Badge> : expired ? <Badge tone="amber">Expired</Badge> : <Badge tone="green">Active</Badge>}{k.expiresAt && !k.revokedAt && <small>until {when(k.expiresAt)}</small>}</td>
                  <td>{!k.revokedAt && (confirm === k.id
                    ? <button type="button" className="button wl-danger-fill small" disabled={pending} onClick={() => start(async () => { const r = await revokeApiKeyAction(k.id); notify(r.ok ? 'Key revoked: it stops working at once' : r.error); setConfirm(null); router.refresh() })}>Revoke for good</button>
                    : <button type="button" className="filter-button" onClick={() => setConfirm(k.id)}>Revoke</button>)}</td>
                </tr>
              )
            })}
            {!keys.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No API key yet.</td></tr>}
          </tbody>
        </table></div>
        {live.length > 0 && <p className="section-hint" style={{ margin: '8px 0 0' }}>A lost key cannot be shown again: revoke it and make a new one.</p>}
      </Section>

      <Section title="How to call it" about="One address per dataset. All are GET requests and return JSON (or CSV with format=csv).">
        <div className="set-code"><small>Base address</small><CopyText text={base} /></div>
        <div className="set-params">
          <div><code>Authorization: Bearer tc_live_…</code><small>The key (or send it as <code>X-API-Key</code>).</small></div>
          <div><code>from=2026-04-01&amp;to=2026-04-30</code><small>Dates (YYYY-MM-DD) on each dataset’s main date.</small></div>
          <div><code>branch=MOH</code><small>One branch by its code (keys made for one branch always get only that branch).</small></div>
          <div><code>limit=1000&amp;offset=0</code><small>Up to 5000 rows per call; the answer’s <code>next</code> gives the next offset.</small></div>
          <div><code>format=csv</code><small>A CSV file instead of JSON (amounts in rupees).</small></div>
        </div>
        <div className="set-code"><small>Example</small><CopyText text={`curl -H "Authorization: Bearer tc_live_YOUR_KEY" "${base}/registrations?from=2026-04-01&format=csv"`} /></div>
      </Section>

      <Section title="Datasets" about="Click one to see its fields.">
        {datasets.map((d) => (
          <details key={d.key} className="set-help">
            <summary><code>/{d.key}</code> — {d.label} <small>({d.what} Dates filter on <code>{d.dateField}</code>.)</small></summary>
            <div className="set-fields">{d.fields.map((f) => <div key={f.key}><code>{f.key}</code><small>{f.about}</small></div>)}</div>
            <CopyText text={`${base}/${d.key}?format=csv`} />
          </details>
        ))}
      </Section>

      <Section title="Connect a tool">
        <details className="set-help" open><summary>Power BI Desktop</summary><ol>
          <li><b>Get data → Web → Advanced</b>.</li>
          <li>URL parts: <code>{`${base}/payments?format=csv&limit=5000`}</code></li>
          <li>HTTP request header: <b>Authorization</b> = <code>Bearer tc_live_YOUR_KEY</code>. OK → Load.</li>
          <li>Repeat for other datasets; join them on <code>reg_no</code>. In Power BI Service, set the data source credentials to <b>Anonymous</b> (the key is in the header) to schedule refresh.</li>
        </ol></details>
        <details className="set-help"><summary>Excel</summary><ol><li><b>Data → From Web → Advanced</b>, URL as above with <code>format=csv</code>.</li><li>Add the header <b>Authorization</b> = <code>Bearer tc_live_YOUR_KEY</code>. Refresh any time with <b>Data → Refresh All</b>.</li></ol></details>
        <details className="set-help"><summary>n8n</summary><ol><li><b>HTTP Request</b> node, GET <code>{`${base}/leads?from={{$today.minus(1,'day').toFormat('yyyy-MM-dd')}}`}</code></li><li>Authentication: <b>Generic → Header Auth</b>, name <code>Authorization</code>, value <code>Bearer tc_live_YOUR_KEY</code>. Use a Schedule trigger for daily pulls.</li></ol></details>
        <details className="set-help"><summary>Google Sheets / Looker Studio</summary><p>Sheets’ IMPORTDATA cannot send a header, so pull with n8n (or Apps Script <code>UrlFetchApp.fetch(url, {'{ headers: { Authorization: "Bearer …" } }'})</code>) into a sheet, and point Looker Studio at that sheet.</p></details>
      </Section>
      {making && <ApiKeyForm datasets={datasets} branches={branches} onClose={() => setMaking(false)} onDone={(key) => { setMaking(false); setMade(key); router.refresh() }} />}
      {made && (
        <Modal title="Your new API key" onClose={() => setMade(null)}>
          <p className="section-hint" style={{ margin: '-6px 0 10px' }}><b>Copy it now.</b> For safety it is not kept and cannot be shown again.</p>
          <CopyText text={made} label="Copy key" />
          <div className="modal-actions"><button type="button" className="button primary" onClick={() => setMade(null)}>I have copied it</button></div>
        </Modal>
      )}
    </>
  )
}

function ApiKeyForm({ datasets, branches, onClose, onDone }: { datasets: NonNullable<SettingsData['admin']>['datasets']; branches: { id: string; name: string; code: string }[]; onClose: () => void; onDone: (key: string) => void }) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [branchId, setBranchId] = useState('')
  const [expires, setExpires] = useState(0)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title="New API key" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await createApiKeyAction({ name, scopes, branchId: branchId || null, expiresInDays: expires }); if (!r.ok) return setError(r.error); onDone(r.data!) }) }}>
        <div className="wl-form">
          <label className="wide">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Power BI — head office dashboard" required /></label>
          <label>Branch<select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></label>
          <label>Expires<select value={expires} onChange={(e) => setExpires(Number(e.target.value))}><option value={0}>Never</option><option value={30}>In 30 days</option><option value={90}>In 90 days</option><option value={365}>In a year</option></select></label>
        </div>
        <h3 className="set-sub">May read</h3>
        <div className="set-checks col">
          {datasets.map((d) => <label key={d.key} className={`set-check${scopes.includes(d.key) ? ' on' : ''}`}><input type="checkbox" checked={scopes.includes(d.key)} onChange={() => setScopes(scopes.includes(d.key) ? scopes.filter((x) => x !== d.key) : [...scopes, d.key])} /><span><b>{d.label}</b> <code>/{d.key}</code><small>{d.what}</small></span></label>)}
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Making…' : 'Make key'}</button></div>
      </form>
    </Modal>
  )
}
