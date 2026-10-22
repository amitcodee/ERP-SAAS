'use client'
// Bulk WhatsApp: 1. the campaign (and what to type for it), 2. who gets it, 3. check who and how it reads, then send.
// Below, the sends so far with how many went out. The campaigns come from Settings → WhatsApp campaigns.
import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, Send, Users } from 'lucide-react'
import { broadcastFailuresAction, previewBroadcastAction, sendBroadcastAction, testWaCampaignAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { DateInput } from '@/components/date-input'
import { WA_AUDIENCES, WA_FIELDS } from '@/lib/notify/whatsapp'
import type { AudienceInput, AudiencePreview, BroadcastRow, CampaignRow } from '@/modules/notifications/broadcasts'

type Opt = { id: string; name: string }
type Props = {
  campaigns: CampaignRow[]; broadcasts: BroadcastRow[]; departments: Opt[]; courses: { id: string; title: string; department_id: string }[]; categories: Opt[]
  branches: Opt[] | null; branchName: string; canSend: boolean; isSuper: boolean; whatsappOn: boolean; max: number; category: string | null
}
type StudentStatus = 'active' | 'on_hold' | 'completed' | 'discontinued'
type LeadType = 'call' | 'lead' | 'visited'
const STATUSES: [StudentStatus, string][] = [['active', 'Active'], ['on_hold', 'On hold'], ['completed', 'Completed'], ['discontinued', 'Discontinued']]
const TYPES: [LeadType, string, string][] = [['call', 'Random calls', 'Not made into an enquiry yet'], ['lead', 'Leads', 'Have not visited yet'], ['visited', 'Visited enquiries', 'Came to the branch']]
const fmt = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const flip = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x])

export function BulkWhatsApp(p: Props) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [campaignId, setCampaignId] = useState(p.campaigns[0]?.id ?? '')
  const c = p.campaigns.find((x) => x.id === campaignId)
  const asks = c?.params.filter((x) => x.field === 'text') ?? []
  const [texts, setTexts] = useState<string[]>([])
  const [testTo, setTestTo] = useState('')

  const [kind, setKind] = useState<'students' | 'leads'>(p.category ? 'leads' : 'students')
  const allowed = (k: 'students' | 'leads') => !c || c.audience === 'any' || c.audience === k
  const k = allowed(kind) ? kind : kind === 'students' ? 'leads' : 'students'
  const [branchId, setBranchId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [statuses, setStatuses] = useState<StudentStatus[]>(['active'])
  const [fee, setFee] = useState<'any' | 'due' | 'overdue'>('any')
  const [types, setTypes] = useState<LeadType[]>(['call', 'lead', 'visited'])
  const [categoryIds, setCategoryIds] = useState<string[]>(p.category ? [p.category] : [])
  const [interestedOnly, setInterestedOnly] = useState(false)
  const [notRegistered, setNotRegistered] = useState(true)
  const [preview, setPreview] = useState<AudiencePreview | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [failures, setFailures] = useState<{ row: BroadcastRow; list: { to: string; error: string | null }[] } | null>(null)

  const audience: AudienceInput = useMemo(() => {
    const common = { branchId: branchId || null, departmentId: departmentId || null, courseId: courseId || null, from: from || null, to: to || null }
    return k === 'students' ? { kind: 'students', statuses, fee, ...common } : { kind: 'leads', types, categoryIds, interestedOnly, notRegistered, ...common }
  }, [k, branchId, departmentId, courseId, from, to, statuses, fee, types, categoryIds, interestedOnly, notRegistered])
  const changed = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null) }
  const courses = p.courses.filter((x) => !departmentId || x.department_id === departmentId)

  const check = () => start(async () => {
    const r = await previewBroadcastAction(campaignId, audience, texts)
    if (!r.ok) return setError(r.error)
    setError(''); setPreview(r.data!)
  })
  const send = () => start(async () => {
    const r = await sendBroadcastAction(campaignId, audience, texts)
    setConfirm(false)
    if (!r.ok) return setError(r.error)
    setError(''); setPreview(null)
    notify(`${r.data!.queued.toLocaleString('en-IN')} messages queued: they go out over the next few minutes`)
    router.refresh()
  })
  const test = () => start(async () => {
    const r = await testWaCampaignAction(campaignId, testTo, texts)
    if (!r.ok) return setError(r.error)
    setError(''); notify(`Test sent to ${testTo} (${r.data})`)
  })
  const showFailures = (row: BroadcastRow) => start(async () => {
    const r = await broadcastFailuresAction(row.id)
    if (!r.ok) return setError(r.error)
    setFailures({ row, list: r.data! })
  })
  const missingText = asks.some((_, i) => !texts[i]?.trim())

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Setup / WhatsApp campaigns</p>
          <h1>Bulk WhatsApp</h1>
          <p className="subheading">Send a WhatsApp campaign to students or leads{p.branches ? ' of every branch, or one' : ` of ${p.branchName}`}. Pick the campaign, pick who gets it, check the list and send. Messages go out through AiSensy within minutes; one per mobile number.</p>
        </div>
      </div>
      {!p.whatsappOn && <p className="fee-note" role="status"><AlertTriangle size={14} /> WhatsApp is not switched on yet{p.isSuper ? <> (<Link href="/settings?tab=messaging">Settings → WhatsApp &amp; SMS</Link>)</> : ': ask head office'}. You can look at the lists, but nothing can be sent.</p>}
      {!p.campaigns.length && <p className="fee-note" role="status">No campaigns yet. {p.isSuper ? <>Make a template and an API campaign in AiSensy, then list it in <Link href="/settings?tab=campaigns">Settings → WhatsApp campaigns</Link>.</> : 'Head office lists them in Settings → WhatsApp campaigns.'}</p>}

      {c && <>
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><div><h2>1. Campaign</h2><span>Made in AiSensy on an approved template. The details in {'{{1}}, {{2}}…'} are filled in for each person.</span></div></div>
          <div className="wl-form">
            <label>Campaign<select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); setTexts([]); setPreview(null) }}>
              {p.campaigns.map((x) => <option key={x.id} value={x.id}>{x.label} ({WA_AUDIENCES[x.audience]})</option>)}
            </select></label>
            <label>AiSensy campaign<input value={c.campaign} disabled /></label>
            {asks.map((a, i) => <label key={i} className="wide">{a.label}<span className="required-mark">*</span><input value={texts[i] ?? ''} maxLength={900} onChange={(e) => { const t = [...texts]; t[i] = e.target.value; setTexts(t); setPreview(null) }} placeholder="The same for everyone" /></label>)}
          </div>
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {c.body ? <div style={{ whiteSpace: 'pre-line', border: '1px solid var(--line)', borderRadius: 12, padding: 14, background: 'var(--tint)' }}>{c.body}</div> : <p className="section-hint">No template text was pasted for this campaign: the preview shows its details only.</p>}
            <p className="section-hint" style={{ marginTop: 8 }}>{c.params.map((x, i) => `{{${i + 1}}} = ${x.field === 'text' ? `typed: ${x.label}` : WA_FIELDS[x.field].label}`).join(' · ') || 'No parameters'}{c.mediaUrl ? ' · with media' : ''}</p>
          </div>
          {p.canSend && p.whatsappOn && <div className="fee-action-row" style={{ marginTop: 10 }}>
            <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Your mobile number" style={{ maxWidth: 220 }} aria-label="Test number" />
            <button type="button" className="button secondary" disabled={pending || testTo.replace(/\D/g, '').length < 10} onClick={test}><Send size={14} /> Send a test (sample details)</button>
          </div>}
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><div><h2>2. Who gets it</h2><span>People without a mobile number are left out; a number that appears twice gets one message.</span></div></div>
          <div className="seg" style={{ marginBottom: 14 }}>
            {(['students', 'leads'] as const).map((x) => <button key={x} type="button" className={k === x ? 'on' : ''} aria-pressed={k === x} disabled={!allowed(x)} title={allowed(x) ? undefined : `This campaign is for ${WA_AUDIENCES[c.audience].toLowerCase()} only`} onClick={() => changed(setKind)(x)}>{x === 'students' ? 'Students' : 'Leads & enquiries'}</button>)}
          </div>
          {k === 'students' ? <>
            <h3 className="set-sub">Status</h3>
            <div className="set-checks">{STATUSES.map(([s, l]) => <label key={s} className={`set-check${statuses.includes(s) ? ' on' : ''}`}><input type="checkbox" checked={statuses.includes(s)} onChange={() => changed(setStatuses)(flip(statuses, s))} /><span><b>{l}</b></span></label>)}</div>
          </> : <>
            <h3 className="set-sub">Who</h3>
            <div className="set-checks">{TYPES.map(([t, l, h]) => <label key={t} className={`set-check${types.includes(t) ? ' on' : ''}`}><input type="checkbox" checked={types.includes(t)} onChange={() => changed(setTypes)(flip(types, t))} /><span><b>{l}</b><small>{h}</small></span></label>)}</div>
            <h3 className="set-sub">Lead category <small style={{ fontWeight: 400 }}>(none ticked = every category, and those with none)</small></h3>
            <div className="set-checks">{p.categories.map((x) => <label key={x.id} className={`set-check${categoryIds.includes(x.id) ? ' on' : ''}`}><input type="checkbox" checked={categoryIds.includes(x.id)} onChange={() => changed(setCategoryIds)(flip(categoryIds, x.id))} /><span><b>{x.name}</b></span></label>)}
              {!p.categories.length && <span className="section-hint">No lead categories yet.</span>}</div>
            <div className="set-checks" style={{ marginTop: 10 }}>
              <label className={`set-check${interestedOnly ? ' on' : ''}`}><input type="checkbox" checked={interestedOnly} onChange={() => changed(setInterestedOnly)(!interestedOnly)} /><span><b>Interested only</b></span></label>
              <label className={`set-check${notRegistered ? ' on' : ''}`}><input type="checkbox" checked={notRegistered} onChange={() => changed(setNotRegistered)(!notRegistered)} /><span><b>Not registered yet</b><small>Leave out people who already joined</small></span></label>
            </div>
          </>}
          <div className="wl-form" style={{ marginTop: 14 }}>
            {p.branches && <label>Branch<select value={branchId} onChange={(e) => changed(setBranchId)(e.target.value)}><option value="">Every branch</option>{p.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            {k === 'students' && <label>Fees<select value={fee} onChange={(e) => changed(setFee)(e.target.value as typeof fee)}><option value="any">Anyone</option><option value="due">Fee still due</option><option value="overdue">An installment is overdue</option></select></label>}
            <label>Course category<select value={departmentId} onChange={(e) => { changed(setDepartmentId)(e.target.value); setCourseId('') }}><option value="">Any</option>{p.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Course<select value={courseId} onChange={(e) => changed(setCourseId)(e.target.value)}><option value="">Any</option>{courses.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
            <label>{k === 'students' ? 'Registered from' : 'Added from'}<DateInput type="date" value={from} onChange={(e) => changed(setFrom)(e.target.value)} /></label>
            <label>To<DateInput type="date" value={to} onChange={(e) => changed(setTo)(e.target.value)} /></label>
          </div>
          {error && <p role="alert" className="form-problem">{error}</p>}
          <div className="fee-action-row" style={{ marginTop: 14 }}>
            <button type="button" className="button secondary" disabled={pending || !campaignId} onClick={check}><Users size={14} /> {pending && !preview ? 'Counting…' : 'Check who gets it'}</button>
          </div>
        </div>

        {preview && <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header"><div><h2>3. {preview.total.toLocaleString('en-IN')} {preview.total === 1 ? 'person' : 'people'}</h2><span>{preview.summary}</span></div></div>
          {preview.total > p.max && <p className="form-problem">One send can go to at most {p.max.toLocaleString('en-IN')}: narrow the filter.</p>}
          {preview.sample.length > 0 && <div className="table-scroll"><table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Branch</th><th>Course</th><th>Message</th></tr></thead>
            <tbody>{preview.sample.map((s, i) => <tr key={i}><td>{s.name}</td><td>{s.phone}</td><td>{s.branch}</td><td>{s.course ?? '—'}</td><td style={{ whiteSpace: 'pre-line', minWidth: 280, fontSize: 12.5 }}>{s.text}</td></tr>)}</tbody>
          </table></div>}
          {preview.total > preview.sample.length && <p className="section-hint" style={{ marginTop: 8 }}>The first {preview.sample.length} shown.</p>}
          {p.canSend && <div className="fee-action-row" style={{ marginTop: 14 }}>
            <button type="button" className="button primary" disabled={pending || !p.whatsappOn || !preview.total || preview.total > p.max || missingText} onClick={() => setConfirm(true)}><Send size={14} /> Send to {preview.total.toLocaleString('en-IN')}</button>
            {missingText && <span className="section-hint">Fill in the campaign’s typed details first.</span>}
          </div>}
        </div>}
      </>}

      <div className="panel table-panel">
        <div className="panel-header" style={{ padding: '16px 18px 0' }}><div><h2>Sent</h2><span>The latest 30 sends{p.branches ? ' of every branch' : ''}. “Waiting” go out within minutes (or once WhatsApp is switched on).</span></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>When</th><th>Campaign</th><th>Who</th><th>By</th><th>To</th><th>Sent</th><th>Waiting</th><th>Not sent</th><th>Actions</th></tr></thead>
          <tbody>
            {p.broadcasts.map((b) => <tr key={b.id}>
              <td>{fmt(b.at)}</td><td><strong>{b.label}</strong><small>{b.campaign}</small></td><td style={{ minWidth: 220 }}>{b.summary}</td><td>{b.by ?? '—'}</td>
              <td>{b.total.toLocaleString('en-IN')}</td><td>{b.sent.toLocaleString('en-IN')}</td><td>{b.queued.toLocaleString('en-IN')}</td>
              <td>{b.failed + b.skipped ? <span className="status-badge status-red"><span className="status-dot" />{(b.failed + b.skipped).toLocaleString('en-IN')}</span> : '0'}</td>
              <td>{b.failed + b.skipped > 0 && <button type="button" className="filter-button" disabled={pending} onClick={() => showFailures(b)}><Eye size={13} /> Why</button>}</td>
            </tr>)}
            {!p.broadcasts.length && <tr><td colSpan={9} className="section-hint">Nothing sent yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {confirm && preview && c && <Modal title="Send this campaign?" onClose={() => setConfirm(false)}>
        <p style={{ fontSize: 14, lineHeight: 1.6 }}><strong>{c.label}</strong> goes to <strong>{preview.total.toLocaleString('en-IN')}</strong> {preview.total === 1 ? 'person' : 'people'} on WhatsApp: {preview.summary}.</p>
        <p className="section-hint">AiSensy charges per message (marketing templates cost more). It cannot be undone.</p>
        <div className="fee-action-row" style={{ marginTop: 16 }}>
          <button type="button" className="button primary" disabled={pending} onClick={send}>{pending ? 'Sending…' : `Yes, send to ${preview.total.toLocaleString('en-IN')}`}</button>
          <button type="button" className="button secondary" disabled={pending} onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      </Modal>}
      {failures && <Modal title={`Not sent: ${failures.row.label}`} onClose={() => setFailures(null)} wide>
        <div className="table-scroll"><table>
          <thead><tr><th>Mobile</th><th>Why</th></tr></thead>
          <tbody>{failures.list.map((f, i) => <tr key={i}><td>{f.to}</td><td>{(f.error ?? '—').replace(/^\[\d+\]\s*/, '')}</td></tr>)}</tbody>
        </table></div>
      </Modal>}
    </section>
  )
}
