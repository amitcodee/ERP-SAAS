'use client'
// A course's syllabus: modules and their topics, in teaching order, plus an optional syllabus file (PDF).
// Trainers tick topics off it as they teach; students of every branch see it with what is done. It is shared by all
// branches: an academic manager or branch manager sends a change for head office to approve (only then does it go
// live); head office's own edits apply at once, and head office reviews the waiting change here.
import { useEffect, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, Check, Clock, FileText, Plus, Trash2, Upload, X } from 'lucide-react'
import { decideSyllabusChangeAction, removeSyllabusFileAction, saveSyllabusAction, syllabusAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import type { Syllabus, SyllabusChange } from '@/modules/teaching/service'

type Row = { key: string; id: string | null; module: string; title: string }
let seq = 0
const blank = (module = ''): Row => ({ key: `n${++seq}`, id: null, module, title: '' })

export function SyllabusEditor({ courseId, course, canEdit, fresh, onClose, onSaved }: {
  courseId: string; course: string; canEdit: boolean; fresh?: boolean; onClose: () => void; onSaved: (m: string) => void
}) {
  const [data, setData] = useState<Syllabus | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [file, setFile] = useState<File | null>(null)
  const load = () => syllabusAction(courseId).then((r) => {
    if (!r.ok) return setError(r.error)
    setData(r.data!)
    // the author goes on from their waiting change; everyone else starts from what is live
    const src = r.data!.pending?.mine && r.data!.pending.topics ? r.data!.pending.topics : r.data!.topics
    setRows(src.length ? src.map((t, i) => ({ key: t.id ?? `p${i}`, id: t.id, module: t.module ?? '', title: t.title })) : [blank('Module 1')])
  })
  useEffect(() => { void load() }, [courseId]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= rows.length) return; const n = [...rows]; [n[i], n[j]] = [n[j], n[i]]; setRows(n) }
  const save = () => start(async () => {
    setError('')
    const list = rows.filter((r) => r.title.trim())
    const r = await saveSyllabusAction(courseId, list.map((x) => ({ id: x.id, module: x.module || null, title: x.title, details: null })))
    if (!r.ok) return setError(r.error)
    if (file) {
      const fd = new FormData(); fd.set('what', 'syllabus'); fd.set('courseId', courseId); fd.set('file', file)
      const u = await fetch('/api/teaching', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The file could not be sent' }))
      if (!u.ok) return setError(u.error)
    }
    onSaved(r.data!.pending
      ? `Syllabus change sent to head office for approval (${list.length} topic${list.length === 1 ? '' : 's'}). It reaches every branch once approved.`
      : `Syllabus saved for every branch: ${list.length} topic${list.length === 1 ? '' : 's'}`)
  })
  const decide = (approve: boolean, note: string | null) => start(async () => {
    setError('')
    const r = await decideSyllabusChangeAction(data!.pending!.id, approve, note)
    if (!r.ok) return setError(r.error)
    onSaved(approve ? 'Syllabus change approved: it is live for every branch' : data!.headOffice ? 'Syllabus change turned down' : 'Your syllabus change was withdrawn')
  })
  const blocked = !!data?.pending && !data.pending.mine && !data.headOffice // someone else's change waits: wait for head office
  const modules = [...new Set(rows.map((r) => r.module).filter(Boolean))]
  return (
    <Modal title={`Syllabus — ${course}`} onClose={onClose}>
      {fresh && <p className="section-hint" style={{ margin: '-8px 0 12px' }}>Course added. Now set its syllabus: trainers tick these topics as they teach, and students see their progress.</p>}
      {data?.pending && <PendingBanner c={data.pending} live={data.topics} headOffice={data.headOffice} busy={pending} onDecide={decide} />}
      {!data ? <p className="section-hint">Loading…</p> : !canEdit || blocked ? (
        <div className="syl-view">
          {data.topics.length ? data.topics.map((t, i) => <div key={t.id}>{(i === 0 || data.topics[i - 1].module !== t.module) && t.module && <h4>{t.module}</h4>}<p><b>{i + 1}.</b> {t.title}</p></div>) : <p className="section-hint">No syllabus set yet.</p>}
          {data.file && <a className="filter-button" href={`/api/syllabus/${courseId}`}><FileText size={14} /> {data.file.name}</a>}
        </div>
      ) : (
        <>
          <datalist id="syl-modules">{modules.map((m) => <option key={m} value={m} />)}</datalist>
          <div className="syl-rows">
            <div className="syl-head"><span>#</span><span>Module (optional)</span><span>Topic</span><span /></div>
            {rows.map((r, i) => (
              <div key={r.key} className="syl-row">
                <span className="syl-no">{i + 1}</span>
                <input list="syl-modules" value={r.module} placeholder="e.g. Module 1: Basics" onChange={(e) => set(i, { module: e.target.value })} aria-label={`Module of topic ${i + 1}`} />
                <input value={r.title} placeholder="Topic taught in a class" autoFocus={!r.id && i === rows.length - 1 && rows.length > 1}
                  onChange={(e) => set(i, { title: e.target.value })} aria-label={`Topic ${i + 1}`}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setRows([...rows.slice(0, i + 1), blank(r.module), ...rows.slice(i + 1)]) } }} />
                <span className="syl-act">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [blank()])} aria-label="Remove topic"><Trash2 size={13} /></button>
                </span>
              </div>
            ))}
          </div>
          <div className="syl-tools">
            <button type="button" className="filter-button" onClick={() => setRows([...rows, blank(rows[rows.length - 1]?.module ?? '')])}><Plus size={14} /> Add topic</button>
            <span className="section-hint" style={{ margin: 0 }}>Enter in a topic adds the next one. A topic with an empty title is left out.</span>
          </div>
          <div className="syl-file">
            <FileText size={16} />
            {data.file && !file ? <span>Syllabus file: <a href={`/api/syllabus/${courseId}`}>{data.file.name}</a> <button type="button" className="link-button" onClick={() => start(async () => { const r = await removeSyllabusFileAction(courseId); if (!r.ok) return setError(r.error); await load() })}>remove</button></span>
              : <span>{file ? file.name : 'A syllabus file (PDF) students and trainers can download — optional'}</span>}
            <label className="filter-button" style={{ marginLeft: 'auto', cursor: 'pointer' }}><Upload size={14} /> {data.file || file ? 'Replace' : 'Upload'}<input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          </div>
          <Err msg={error} />
          <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{fresh ? 'Later' : 'Cancel'}</button><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : data.headOffice ? 'Save for every branch' : data.pending?.mine ? 'Update the change sent' : 'Send for approval'}</button></div>
          {!data.headOffice && <p className="section-hint" style={{ margin: '8px 0 0', textAlign: 'right' }}>The syllabus is shared by every branch: head office approves a change before it goes live.</p>}
        </>
      )}
      {(!canEdit || blocked) && <div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Close</button></div>}
    </Modal>
  )
}

/** What a waiting change does to the live list: topics added, removed, renamed, and whether the order moved. */
function diff(live: Syllabus['topics'], next: NonNullable<SyllabusChange['topics']>) {
  const ids = new Set(live.map((t) => t.id))
  const added = next.filter((t) => !t.id || !ids.has(t.id))
  const kept = next.filter((t) => t.id && ids.has(t.id))
  const removed = live.filter((t) => !next.some((n) => n.id === t.id))
  const renamed = kept.filter((t) => { const l = live.find((x) => x.id === t.id)!; return l.title !== t.title || (l.module ?? '') !== (t.module ?? '') })
    .map((t) => ({ from: live.find((x) => x.id === t.id)!, to: t }))
  const order = live.filter((t) => kept.some((k) => k.id === t.id)).map((t) => t.id).join() !== kept.map((t) => t.id).join()
  return { added, removed, renamed, order }
}

function PendingBanner({ c, live, headOffice, busy, onDecide }: { c: SyllabusChange; live: Syllabus['topics']; headOffice: boolean; busy: boolean; onDecide: (approve: boolean, note: string | null) => void }) {
  const [note, setNote] = useState('')
  const [refusing, setRefusing] = useState(false)
  const d = c.topics ? diff(live, c.topics) : null
  const when = new Date(c.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const who = `${c.mine ? 'You' : c.by ?? 'Someone'}${c.branch ? ` (${c.branch})` : ''}`
  return (
    <div className="fee-note" style={{ marginBottom: 14, display: 'grid', gap: 8 }}>
      <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Clock size={15} /> {headOffice ? `${who} sent a syllabus change for approval · ${when}` : c.mine ? `Your change is waiting for head office approval · ${when}` : `${who} has a change waiting for head office approval · ${when}. You can edit once it is decided.`}</strong>
      {d && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {d.added.map((t, i) => <li key={`a${i}`} style={{ color: '#047857' }}>Added: {t.module ? `${t.module} — ` : ''}{t.title}</li>)}
          {d.removed.map((t) => <li key={`r${t.id}`} style={{ color: '#b91c1c' }}>Removed: {t.title}</li>)}
          {d.renamed.map((x) => <li key={`n${x.from.id}`}>Changed: “{x.from.title}” → “{x.to.title}”{(x.from.module ?? '') !== (x.to.module ?? '') ? ` (module: ${x.to.module ?? 'none'})` : ''}</li>)}
          {d.order && <li>The order of the topics is changed</li>}
          {!d.added.length && !d.removed.length && !d.renamed.length && !d.order && <li>No change to the topics</li>}
        </ul>
      )}
      {c.file && <div>Syllabus file: {c.file.action === 'remove' ? 'to be removed' : `new file “${c.file.name}”`}</div>}
      {headOffice && (refusing ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it is turned down (the author sees this)" rows={2} />
          <div style={{ display: 'flex', gap: 8 }}><button type="button" className="button secondary" disabled={busy} onClick={() => setRefusing(false)}>Back</button><button type="button" className="button primary" disabled={busy || note.trim().length < 3} onClick={() => onDecide(false, note)}>Turn down</button></div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="button primary" disabled={busy} onClick={() => onDecide(true, null)}><Check size={15} /> Approve for every branch</button>
          <button type="button" className="button secondary" disabled={busy} onClick={() => setRefusing(true)}><X size={15} /> Turn down</button>
        </div>
      ))}
      {!headOffice && c.mine && <div><button type="button" className="link-button" disabled={busy} onClick={() => onDecide(false, null)}>Withdraw my change</button></div>}
    </div>
  )
}
