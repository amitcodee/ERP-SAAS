'use client'
// Shared students: a student of one branch (home) also takes classes in another (host) — some days there, or online.
// Sending: asked by this branch, waiting for the other (cancellable while it waits). Hosting: asked by another branch,
// accepted here into one of this branch's batches, or turned down. Either side ends an accepted share. The host sees
// only that student in its batch; the fees, certificate and records stay at home, where the classes there count.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { acceptShareAction, declineShareAction, endShareAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { NewMoveButton } from '@/components/student-move'
import type { ShareRow } from '@/modules/registrations/shares'

type HostBatch = { id: string; name: string; course: string | null; members: number; capacity: number | null }
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const STATUS: Record<ShareRow['status'], [string, string]> = {
  pending: ['Waiting', 'status-amber'], accepted: ['Attending', 'status-green'], declined: ['Turned down', 'status-red'], cancelled: ['Cancelled', 'status-slate'], ended: ['Ended', 'status-slate'],
}
type Deciding = { row: ShareRow; kind: 'accept' | 'decline' | 'cancel' | 'end' }
const TITLE: Record<Deciding['kind'], string> = { accept: 'Accept', decline: 'Turn down', cancel: 'Cancel request', end: 'End classes' }

export function SharedStudentsPanel({ rows, batches, canHost, canAsk, newBranches, scope }: { rows: ShareRow[]; batches: HostBatch[]; canHost: boolean; canAsk: boolean; newBranches: { id: string; name: string }[]; scope: string }) {
  const router = useRouter()
  const [view, setView] = useState<'all' | 'in' | 'out' | 'pending' | 'accepted'>(rows.some((r) => r.status === 'pending') ? 'pending' : 'accepted')
  const [deciding, setDeciding] = useState<Deciding | null>(null)
  const [batchId, setBatchId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  const shown = rows.filter((r) => view === 'all' || (view === 'pending' || view === 'accepted' ? r.status === view : r.direction === view || r.direction === 'both'))
  const count = (f: (r: ShareRow) => boolean) => rows.filter(f).length
  const open = (row: ShareRow, kind: Deciding['kind']) => { setDeciding({ row, kind }); setNote(''); setBatchId(''); setError('') }

  function decide() {
    if (!deciding) return
    const { row, kind } = deciding
    if (kind === 'accept' && !batchId) return setError('Choose the batch the student joins.')
    if (kind !== 'accept' && note.trim().length < 3) return setError('Say why.')
    start(async () => {
      const res = kind === 'accept' ? await acceptShareAction(row.id, batchId, note || null)
        : kind === 'end' ? await endShareAction(row.id, note)
        : await declineShareAction(row.id, note)
      if (!res.ok) return setError(res.error)
      setDeciding(null)
      setMsg(kind === 'accept' ? `${row.name} joins ${batches.find((b) => b.id === batchId)?.name}` : kind === 'end' ? `${row.name} no longer attends at ${row.toBranch}` : kind === 'cancel' ? `Request for ${row.name} cancelled` : `Request for ${row.name} turned down`)
      router.refresh()
    })
  }

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admissions / Shared Students</p>
          <h1>Shared students</h1>
          <p className="subheading">Students who also take classes in another branch{scope ? ` · ${scope}` : ''}. Their own branch asks (Share a student, or Registrations → share icon); the other branch accepts here into one of its batches. Fees, certificate and records stay with their own branch, where the classes taken here count.</p>
        </div>
        {newBranches.length > 0 && <div className="heading-actions"><NewMoveButton kind="share" branches={newBranches} onDone={() => router.refresh()} /></div>}
      </div>
      <div className="table-summary">
        <div><strong className="text-amber">{count((r) => r.status === 'pending')}</strong><span>Waiting</span></div>
        <div><strong>{count((r) => r.direction !== 'out' && r.status === 'accepted')}</strong><span>Hosted here</span></div>
        <div><strong>{count((r) => r.direction !== 'in' && r.status === 'accepted')}</strong><span>Ours elsewhere</span></div>
      </div>
      {msg && <p className="fee-note" role="status">{msg}</p>}
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        {([['pending', 'Waiting'], ['accepted', 'Attending'], ['in', 'Hosted here'], ['out', 'Ours elsewhere'], ['all', 'All']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <div className="panel table-panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>Home → classes at</th><th>How / when</th><th>Why</th><th>Asked</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const host = r.direction === 'in' || r.direction === 'both', home = r.direction === 'out' || r.direction === 'both'
              return (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong><small>{r.regNo}{r.course ? ` · ${r.course}` : ''}</small>{r.phone && <small>{r.phone}</small>}</td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{r.fromBranch} <ArrowRight size={13} /> {r.toBranch}</span>{r.batch && <small>Batch: {r.batch}</small>}</td>
                  <td>{r.mode === 'online' ? 'Online' : 'Classroom'}{r.schedule && <small>{r.schedule}</small>}</td>
                  <td style={{ maxWidth: 240 }}>{r.note}</td>
                  <td>{fmt(r.requestedAt)}<small>{r.requestedBy ?? '—'}</small></td>
                  <td><span className={`status-badge ${STATUS[r.status][1]}`}><span className="status-dot" />{STATUS[r.status][0]}</span>{r.decidedAt && <small>{r.decidedBy ?? '—'}, {fmt(r.decidedAt)}</small>}{r.endedAt && <small>Ended {fmt(r.endedAt)}</small>}{r.decisionNote && <small>{r.decisionNote}</small>}</td>
                  <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {r.status === 'pending' && host && canHost && <><button type="button" className="filter-button" disabled={pending} onClick={() => open(r, 'accept')}>Accept</button>
                      <button type="button" className="filter-button" disabled={pending} onClick={() => open(r, 'decline')}>Turn down</button></>}
                    {r.status === 'pending' && home && !host && canAsk && <button type="button" className="filter-button" disabled={pending} onClick={() => open(r, 'cancel')}>Cancel</button>}
                    {r.status === 'accepted' && (canAsk || canHost) && <button type="button" className="filter-button" disabled={pending} onClick={() => open(r, 'end')}>End</button>}
                  </div></td>
                </tr>
              )
            })}
            {!shown.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>No shared students here.</td></tr>}
          </tbody>
        </table></div>
      </div>
      {deciding && (
        <Modal title={`${TITLE[deciding.kind]} — ${deciding.row.name}`} onClose={() => setDeciding(null)}>
          <p className="section-hint" style={{ margin: '-8px 0 14px' }}>
            {deciding.kind === 'accept' ? `${deciding.row.name} (${deciding.row.regNo}, ${deciding.row.fromBranch}) joins the batch you choose. You see this student only: their attendance and marks here count for their certificate at ${deciding.row.fromBranch}; fees stay there.`
              : deciding.kind === 'end' ? `${deciding.row.name} leaves the batch at ${deciding.row.toBranch}. The attendance and marks already taken there stay on their record.`
              : `${deciding.row.name} keeps taking classes at ${deciding.row.fromBranch} only.`}
          </p>
          {deciding.kind === 'accept' && (
            <div className="form-grid"><label>Batch<span className="required-mark">*</span><select value={batchId} required onChange={(e) => { setBatchId(e.target.value); setError('') }}>
              <option value="" disabled>Select batch</option>
              {batches.map((b) => <option key={b.id} value={b.id} disabled={!!b.capacity && b.members >= b.capacity}>{b.name}{b.course ? ` · ${b.course}` : ''} ({b.members}{b.capacity ? `/${b.capacity}` : ''})</option>)}
            </select></label></div>
          )}
          <label className="full-label">{deciding.kind === 'accept' ? 'Note (optional)' : 'Reason'}{deciding.kind !== 'accept' && <span className="required-mark">*</span>}<textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} placeholder={deciding.kind === 'accept' ? 'e.g. Joins the Tue/Thu evening batch' : 'e.g. No seat in this course'} /></label>
          {error && <p role="alert" className="form-problem">{error}</p>}
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDeciding(null)}>Back</button><button type="button" className="button primary" disabled={pending} onClick={decide}>{pending ? 'Saving…' : TITLE[deciding.kind]}</button></div>
        </Modal>
      )}
    </section>
  )
}
