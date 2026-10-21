'use client'
// Settings → WhatsApp campaigns: the AiSensy API campaigns staff may send from Bulk WhatsApp, with what fills each
// {{n}} of the template (lib/notify/whatsapp.ts WA_FIELDS). Head office only.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { saveWaCampaignAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { WA_AUDIENCES, WA_FIELD_KEYS, WA_FIELDS, type WaAudience, type WaCampaignParam } from '@/lib/notify/whatsapp'
import type { CampaignRow } from '@/modules/notifications/broadcasts'

const Badge = ({ on }: { on: boolean }) => <span className={`status-badge ${on ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{on ? 'On' : 'Off'}</span>
export const paramWords = (ps: WaCampaignParam[]) => ps.map((p, i) => `{{${i + 1}}} ${p.field === 'text' ? `typed: ${p.label}` : WA_FIELDS[p.field].label}`).join(' · ')

export function WaCampaignsTab({ list, whatsappOn }: { list: CampaignRow[]; whatsappOn: boolean }) {
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null)
  return (
    <div className="panel set-card">
      <div className="set-card-head">
        <div><h2>WhatsApp campaigns</h2><p>Campaigns made in AiSensy that staff can send to many students or leads at once from <Link href="/whatsapp">Bulk WhatsApp</Link>. Each one is an approved template and a live API campaign in AiSensy; here you say what fills its {'{{1}}, {{2}}…'}.</p></div>
        <div className="row-actions"><button type="button" className="button primary" onClick={() => setEditing('new')}><Plus size={14} /> Add campaign</button></div>
      </div>
      {!whatsappOn && <p className="fee-note">WhatsApp is switched off (WhatsApp &amp; SMS tab): campaigns can be listed, but nothing goes out until it is on.</p>}
      <div className="table-scroll"><table>
        <thead><tr><th>Name</th><th>AiSensy campaign</th><th>For</th><th>Parameters</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {list.map((c) => <tr key={c.id}>
            <td><strong>{c.label}</strong>{c.mediaUrl && <small>with media</small>}</td><td><code>{c.campaign}</code></td><td>{WA_AUDIENCES[c.audience]}</td>
            <td style={{ fontSize: 12 }}>{paramWords(c.params) || '—'}</td><td><Badge on={c.isActive} /></td>
            <td><button type="button" className="filter-button" onClick={() => setEditing(c)}><Pencil size={13} /> Edit</button></td>
          </tr>)}
          {!list.length && <tr><td colSpan={6} className="section-hint">No campaigns yet: add the first one.</td></tr>}
        </tbody>
      </table></div>
      <details className="set-help"><summary>How to make a campaign in AiSensy</summary><ol>
        <li>AiSensy → Manage → Template Message → New: write the message with <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>… where the details go (your institute’s name as it is written) and submit it. Offers and announcements are <b>Marketing</b>; updates are <b>Utility</b>. Wait for <b>Approved</b>.</li>
        <li>AiSensy → Campaigns → Launch → <b>API campaign</b>: pick that template and set it <b>Live</b>. A template with an image / video / document header needs the file’s public https:// link.</li>
        <li>Here: <b>Add campaign</b>, type the API campaign’s name exactly, paste the template text, and say what fills each <code>{'{{n}}'}</code>.</li>
        <li>Open <Link href="/whatsapp">Bulk WhatsApp</Link>, send a test to your own number, then send it to the students or leads you pick.</li>
      </ol></details>
      {editing && <CampaignForm c={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function CampaignForm({ c, onClose }: { c: CampaignRow | null; onClose: () => void }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [label, setLabel] = useState(c?.label ?? '')
  const [campaign, setCampaign] = useState(c?.campaign ?? '')
  const [audience, setAudience] = useState<WaAudience>(c?.audience ?? 'any')
  const [body, setBody] = useState(c?.body ?? '')
  const [params, setParams] = useState<WaCampaignParam[]>(c?.params ?? [])
  const [mediaUrl, setMediaUrl] = useState(c?.mediaUrl ?? '')
  const [mediaName, setMediaName] = useState(c?.mediaName ?? '')
  const [isActive, setIsActive] = useState(c?.isActive ?? true)
  const fresh = (n: number): WaCampaignParam => (n === 0 ? { field: 'first_name' } : { field: 'text', label: '' })
  // a pasted template brings a parameter row for each of its {{n}} (the first is usually the first name)
  const syncBody = (v: string) => {
    setBody(v)
    const n = Math.max(0, ...[...v.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))
    if (n > params.length && n <= 10) setParams([...params, ...Array.from({ length: n - params.length }, (_, i) => fresh(params.length + i))])
  }
  const setParam = (i: number, v: WaCampaignParam) => setParams(params.map((p, j) => (j === i ? v : p)))
  const save = () => start(async () => {
    const r = await saveWaCampaignAction(c?.id ?? null, { label, campaign, audience, body, params: params.map((p) => (p.field === 'text' ? p : { field: p.field })), mediaUrl, mediaName, isActive })
    if (!r.ok) return setError(r.error)
    notify(c ? 'Campaign saved' : 'Campaign added: send a test from Bulk WhatsApp'); router.refresh(); onClose()
  })
  return (
    <Modal title={c ? `Edit ${c.label}` : 'Add a WhatsApp campaign'} onClose={onClose} wide>
      <div className="wl-form">
        <label>Name staff see<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Diwali offer" /></label>
        <label>AiSensy API campaign name<input value={campaign} onChange={(e) => setCampaign(e.target.value.trim())} placeholder="Exactly as in AiSensy → Campaigns" /></label>
        <label>For<select value={audience} onChange={(e) => setAudience(e.target.value as WaAudience)}>{(Object.keys(WA_AUDIENCES) as WaAudience[]).map((k) => <option key={k} value={k}>{WA_AUDIENCES[k]}</option>)}</select></label>
        <label>Status<select value={isActive ? 'on' : 'off'} onChange={(e) => setIsActive(e.target.value === 'on')}><option value="on">On: staff can send it</option><option value="off">Off: hidden from Bulk WhatsApp</option></select></label>
        <label className="wide">Template text <small style={{ fontWeight: 400 }}>(paste it from AiSensy, with {'{{1}}'}…: used for the preview and the message log)</small>
          <textarea rows={5} value={body} onChange={(e) => syncBody(e.target.value)} placeholder={'Hello {{1}},\n\nThis Diwali get {{2}} off on every course at our {{3}} branch…'} /></label>
      </div>
      <h3 className="set-sub">Parameters</h3>
      {params.map((p, i) => <div key={i} className="wl-form" style={{ marginBottom: 8, alignItems: 'end' }}>
        <label>{`{{${i + 1}}}`} is<select value={p.field} onChange={(e) => setParam(i, { field: e.target.value as WaCampaignParam['field'], label: p.label })}>{WA_FIELD_KEYS.map((k) => <option key={k} value={k}>{WA_FIELDS[k].label}</option>)}</select></label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          {p.field === 'text' && <label style={{ flex: 1 }}>Ask staff for<input value={p.label ?? ''} onChange={(e) => setParam(i, { ...p, label: e.target.value })} placeholder="e.g. Offer (like 20%)" /></label>}
          {i === params.length - 1 && <button type="button" className="filter-button icon-only" title="Remove the last parameter" aria-label="Remove the last parameter" onClick={() => setParams(params.slice(0, -1))}><Trash2 size={14} /></button>}
        </div>
      </div>)}
      {params.length < 10 && <button type="button" className="filter-button" onClick={() => setParams([...params, fresh(params.length)])}><Plus size={13} /> Add {`{{${params.length + 1}}}`}</button>}
      <h3 className="set-sub">Media header <small style={{ fontWeight: 400 }}>(only when the template has an image, video or document)</small></h3>
      <div className="wl-form">
        <label>Public link (https://)<input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value.trim())} placeholder="https://…/diwali.jpg" /></label>
        <label>File name<input value={mediaName} onChange={(e) => setMediaName(e.target.value)} placeholder="diwali.jpg" /></label>
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="fee-action-row" style={{ marginTop: 16 }}>
        <button type="button" className="button primary" disabled={pending || !label.trim() || !campaign} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  )
}
