'use client'
// Message templates: each template with its placeholders (click one to put it in), a live preview with sample
// details, save, and "back to default". Below, the ready-made announcements to start a new announcement from.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { deleteAnnouncementTemplateAction, resetTemplateAction, saveAnnouncementTemplateAction, saveTemplateAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { useBrand } from '@/components/brand-context'
import type { AnnouncementTemplate, TemplateView } from '@/modules/templates/service'

const SAMPLE: Record<string, string> = {
  first_name: 'Asha', name: 'Asha Gill', branch: 'Model Town', age: '21', ticket_no: 'TKT-00042', reply: 'Your certificate is ready — collect it from the front desk.',
  trainer: 'Ravi Sharma', student: 'Asha Gill, Graphic Design (Model Town)', kind: 'Project help', request_no: 'HLP-00012', title: 'Logo for my portfolio',
  details: 'I need help choosing colours and fonts for my logo project.', course: 'Graphic Design', cert_no: 'TC/MOH/2026/0042',
}
/** Placeholders that go out as a button in the e-mail (the label it shows). */
const BUTTONS: Record<string, string> = { link: 'Open Project Help', certificate_link: 'View / download certificate', project_link: 'Project certificate', verify_link: 'Verify certificate' }
const fill = (t: string, institute: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k === 'institute' ? institute : SAMPLE[k]) ?? (BUTTONS[k] ? `[${BUTTONS[k]}]` : m))
/** The body as the e-mail shows it: text, with the link placeholders drawn as buttons. */
const preview = (t: string, institute: string) => t.split(/(\{\{\s*\w+\s*\}\})/).map((part, i) => {
  const k = /^\{\{\s*(\w+)\s*\}\}$/.exec(part)?.[1]
  return k && BUTTONS[k] ? <span key={i} style={{ display: 'inline-block', margin: '4px 6px 4px 0', padding: '7px 16px', background: 'var(--navy)', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13 }}>{BUTTONS[k]}</span> : fill(part, institute)
})
const fmt = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const SOURCE = { branch: ['This branch’s own', 'status-blue'], default: ['Head office default', 'status-slate'], 'built-in': ['Built-in', 'status-slate'] } as const

export function MessageTemplatesPanel({ data, branchName, isSuper }: {
  data: { scope: 'branch' | 'default'; templates: TemplateView[]; announcements: AnnouncementTemplate[] }; branchName: string; isSuper: boolean
}) {
  const [msg, setMsg] = useState('')
  const router = useRouter()
  const done = (m: string) => { setMsg(m); router.refresh() }
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Management / Message templates</p>
          <h1>Message templates</h1>
          <p className="subheading">
            {data.scope === 'default'
              ? 'You are editing the default for every branch. A branch manager can write their own version, which then wins in their branch. Pick a branch (top left) to edit just that branch.'
              : `You are editing ${branchName}’s own version. Until it has one, ${branchName} uses head office’s default.${isSuper ? ' Pick “All branches” (top left) to edit the default.' : ''}`}
          </p>
        </div>
      </div>
      {msg && <p className="fee-note" role="status">{msg}</p>}
      {data.templates.map((t) => <TemplateCard key={t.key} t={t} scope={data.scope} onDone={done} />)}
      <AnnouncementTemplates list={data.announcements} scope={data.scope} onDone={done} />
    </section>
  )
}

function TemplateCard({ t, scope, onDone }: { t: TemplateView; scope: 'branch' | 'default'; onDone: (m: string) => void }) {
  const brand = useBrand()
  const [subject, setSubject] = useState(t.subject)
  const [body, setBody] = useState(t.body)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const changed = subject !== t.subject || body !== t.body
  const canReset = scope === 'branch' ? t.source === 'branch' : t.source === 'default'
  function insert(v: string) {
    const el = bodyRef.current, token = `{{${v}}}`
    if (!el) return setBody((b) => b + token)
    const [a, z] = [el.selectionStart ?? body.length, el.selectionEnd ?? body.length]
    setBody(body.slice(0, a) + token + body.slice(z))
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length) })
  }
  const save = () => start(async () => {
    const r = await saveTemplateAction({ key: t.key, subject, body })
    if (!r.ok) return setError(r.error)
    setError(''); onDone(`${t.label} saved`)
  })
  const reset = () => start(async () => {
    const r = await resetTemplateAction(t.key)
    if (!r.ok) return setError(r.error)
    setSubject(t.fallback.subject); setBody(t.fallback.body); setError('')
    onDone(`${t.label}: back to ${scope === 'branch' ? 'head office’s default' : 'the built-in words'}`)
  })
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-header">
        <div><h2>{t.label}</h2><span>{t.about}</span></div>
        <span className={`status-badge ${SOURCE[t.source][1]}`}>{SOURCE[t.source][0]}{t.updatedBy ? ` · ${t.updatedBy}, ${fmt(t.updatedAt!)}` : ''}</span>
      </div>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div>
          <label className="full-label">{t.subjectLabel}<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="full-label">{t.bodyLabel}<textarea ref={bodyRef} rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }} aria-label="Placeholders">
            {Object.entries(t.vars).map(([k, label]) => <button key={k} type="button" className="filter-button" title={`Put ${label.toLowerCase()} here`} onClick={() => insert(k)}>{`{{${k}}}`} <small style={{ marginLeft: 4 }}>{label}</small></button>)}
          </div>
        </div>
        <div>
          <p className="eyebrow" style={{ margin: '0 0 6px' }}>Preview (sample details)</p>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: 'var(--tint)', minHeight: 160 }}>
            <strong style={{ display: 'block', marginBottom: 10 }}>{fill(subject, brand.name)}</strong>
            <div style={{ whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.55 }}>{preview(body, brand.name)}</div>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="fee-action-row" style={{ marginTop: 14 }}>
        <button type="button" className="button primary" disabled={pending || !changed} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
        {changed && <button type="button" className="button secondary" disabled={pending} onClick={() => { setSubject(t.subject); setBody(t.body) }}>Undo changes</button>}
        {canReset && <button type="button" className="button secondary" disabled={pending} onClick={reset} title={scope === 'branch' ? 'Use head office’s default again' : 'Use the built-in words again'}><RotateCcw size={14} /> {scope === 'branch' ? 'Use head office default' : 'Back to built-in'}</button>}
      </div>
    </div>
  )
}

function AnnouncementTemplates({ list, scope, onDone }: { list: AnnouncementTemplate[]; scope: 'branch' | 'default'; onDone: (m: string) => void }) {
  const [editing, setEditing] = useState<AnnouncementTemplate | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const mine = (a: AnnouncementTemplate) => (scope === 'branch' ? a.branchWide : !a.branchWide)
  const remove = (a: AnnouncementTemplate) => start(async () => {
    const r = await deleteAnnouncementTemplateAction(a.id!)
    if (!r.ok) return setError(r.error)
    onDone(`“${a.title}” removed`)
  })
  return (
    <div className="panel table-panel">
      <div className="panel-header">
        <div><h2>Ready-made announcements</h2><span>Shown under “Start from a template” when an announcement is written. {scope === 'branch' ? 'Head office’s ones are for every branch; you can add this branch’s own.' : 'These are for every branch; branches can add their own.'}</span></div>
        <button type="button" className="button primary" onClick={() => { setEditing({ id: null, title: '', body: '', branchWide: scope === 'branch' }); setError('') }}><Plus size={15} /> Add</button>
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="table-scroll"><table style={{ minWidth: 0 }}>
        <thead><tr><th>Name</th><th>Text</th><th>For</th><th /></tr></thead>
        <tbody>
          {list.map((a, i) => (
            <tr key={a.id ?? `d${i}`}>
              <td><strong>{a.title}</strong></td>
              <td style={{ maxWidth: 460, whiteSpace: 'pre-line' }}>{a.body}</td>
              <td>{a.branchWide ? 'This branch' : 'Every branch'}</td>
              <td>{mine(a) && <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="filter-button icon-only" title="Edit" aria-label={`Edit ${a.title}`} onClick={() => { setEditing(a); setError('') }}><Pencil size={14} /></button>
                {a.id && <button type="button" className="filter-button icon-only" title="Remove" aria-label={`Remove ${a.title}`} disabled={pending} onClick={() => remove(a)}><Trash2 size={14} /></button>}
              </div>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {editing && <AnnouncementForm a={editing} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); onDone(m) }} />}
    </div>
  )
}

function AnnouncementForm({ a, onClose, onDone }: { a: AnnouncementTemplate; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState(a.title)
  const [body, setBody] = useState(a.body)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    const r = await saveAnnouncementTemplateAction({ id: a.id, title, body })
    if (!r.ok) return setError(r.error)
    onDone(`“${title}” saved`)
  })
  return (
    <Modal title={a.id || a.title ? 'Edit ready-made announcement' : 'New ready-made announcement'} onClose={onClose}>
      <label className="full-label">Name<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Holiday notice" /></label>
      <label className="full-label">Text<textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Use [brackets] for what to fill in each time, e.g. [date]" /></label>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button></div>
    </Modal>
  )
}
