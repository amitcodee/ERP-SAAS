'use client'
// Students moving between branches. Out: asked by this branch, waiting for the other to accept (and cancellable while
// it waits). In: asked by another branch, accepted or turned down here. Accepting moves the student, the course, what
// is still to pay and the coming installments; until then the branch they leave keeps everything.
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { acceptTransferAction, cancelTransferAction, rejectTransferAction, transferPersonCheckAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { ExportButton } from '@/components/export-button'
import { NewMoveButton } from '@/components/student-move'
import type { PersonMatch, TransferRow } from '@/modules/registrations/transfer'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const STATUS: Record<TransferRow['status'], [string, string]> = {
  pending: ['Waiting', 'status-amber'], accepted: ['Transferred', 'status-green'], rejected: ['Turned down', 'status-red'], cancelled: ['Cancelled', 'status-slate'],
}

export function TransfersPanel({ rows, canAccept, canCancel, newBranches, scope }: { rows: TransferRow[]; canAccept: boolean; canCancel: boolean; newBranches: { id: string; name: string }[]; scope: string }) {
  const router = useRouter()
  const [view, setView] = useState<'all' | 'in' | 'out' | 'pending'>(rows.some((r) => r.status === 'pending') ? 'pending' : 'all')
  const [deciding, setDeciding] = useState<{ row: TransferRow; accept: boolean } | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  // accepting: who the student is in this branch (a record with the same mobile is used only if it is them)
  const [match, setMatch] = useState<PersonMatch | null>(null)
  const [same, setSame] = useState(false)
  useEffect(() => {
    setMatch(null); setSame(false)
    if (!deciding?.accept) return
    let live = true
    void transferPersonCheckAction(deciding.row.id).then((r) => { if (live) r.ok ? setMatch(r.data ?? null) : setError(r.error) })
    return () => { live = false }
  }, [deciding])
  const blocked = match?.kind === 'other' || match?.kind === 'login'
  const shown = rows.filter((r) => view === 'all' || (view === 'pending' ? r.status === 'pending' : r.direction === view || r.direction === 'both'))
  const count = (f: (r: TransferRow) => boolean) => rows.filter(f).length

  function decide() {
    if (!deciding) return
    const { row, accept } = deciding
    if (!accept && note.trim().length < 3) return setError('Say why the transfer is turned down.')
    if (accept && match?.kind === 'maybe' && !same) return setError('Confirm it is the same student first.')
    start(async () => {
      const res = accept ? await acceptTransferAction(row.id, note || null, same) : await rejectTransferAction(row.id, note)
      if (!res.ok) return setError(res.error)
      setDeciding(null); setNote(''); setError('')
      setMsg(accept ? `${row.name} is now ${(res.data as { regNo: string }).regNo} in ${row.toBranch}` : `Transfer of ${row.name} turned down`)
      router.refresh()
    })
  }
  function cancel(row: TransferRow) {
    start(async () => {
      const res = await cancelTransferAction(row.id)
      setMsg(res.ok ? `Transfer of ${row.name} cancelled` : res.error)
      router.refresh()
    })
  }

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admissions / Transfers</p>
          <h1>Student transfers</h1>
          <p className="subheading">Students moving between branches{scope ? ` · ${scope}` : ''}. The branch a student leaves asks (New transfer, or Registrations → transfer icon); the branch they go to accepts here. Until then the student stays where they are.</p>
        </div>
        <div className="heading-actions"><ExportButton list="transfers" />{newBranches.length > 0 && <NewMoveButton kind="transfer" branches={newBranches} onDone={() => router.refresh()} />}</div>
      </div>
      <div className="table-summary">
        <div><strong className="text-amber">{count((r) => r.status === 'pending')}</strong><span>Waiting</span></div>
        <div><strong>{count((r) => r.direction === 'in' && r.status === 'accepted')}</strong><span>Came in</span></div>
        <div><strong>{count((r) => r.direction === 'out' && r.status === 'accepted')}</strong><span>Went out</span></div>
      </div>
      {msg && <p className="fee-note" role="status">{msg}</p>}
      <div className="seg" role="tablist" style={{ marginBottom: 14 }}>
        {([['pending', 'Waiting'], ['in', 'Coming in'], ['out', 'Going out'], ['all', 'All']] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <div className="panel table-panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>From → to</th><th>Reason</th><th>Balance when asked</th><th>Asked</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => {
              const mineIn = r.direction === 'in' || r.direction === 'both', mineOut = r.direction === 'out' || r.direction === 'both'
              return (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong><small>{r.phone}{r.course ? ` · ${r.course}` : ''}</small></td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{r.fromBranch} <ArrowRight size={13} /> {r.toBranch}</span>
                    <small>{mineOut ? <a className="id-text" href={`/fees/${r.fromRegistrationId}`}>{r.fromRegNo}</a> : r.fromRegNo}{r.toRegNo && <> → {mineIn ? <a className="id-text" href={`/fees/${r.toRegistrationId}`}>{r.toRegNo}</a> : r.toRegNo}</>}</small>
                  </td>
                  <td style={{ maxWidth: 240 }}>{r.reason}</td>
                  <td>{r.balance > 0 ? inr(r.balance) : 'Cleared'}</td>
                  <td>{fmt(r.requestedAt)}<small>{r.requestedBy ?? '—'}</small></td>
                  <td><span className={`status-badge ${STATUS[r.status][1]}`}><span className="status-dot" />{STATUS[r.status][0]}</span>{r.decidedAt && <small>{r.decidedBy ?? '—'}, {fmt(r.decidedAt)}</small>}{r.decisionNote && <small>{r.decisionNote}</small>}</td>
                  <td>{r.status === 'pending' && <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {mineIn && canAccept && <><button type="button" className="filter-button" disabled={pending} onClick={() => { setDeciding({ row: r, accept: true }); setNote(''); setError('') }}>Accept</button>
                      <button type="button" className="filter-button" disabled={pending} onClick={() => { setDeciding({ row: r, accept: false }); setNote(''); setError('') }}>Turn down</button></>}
                    {mineOut && canCancel && <button type="button" className="filter-button" disabled={pending} onClick={() => cancel(r)}>Cancel</button>}
                  </div>}</td>
                </tr>
              )
            })}
            {!shown.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>No transfers here.</td></tr>}
          </tbody>
        </table></div>
      </div>
      {deciding && (
        <Modal title={`${deciding.accept ? 'Accept' : 'Turn down'} transfer — ${deciding.row.name}`} onClose={() => setDeciding(null)}>
          <p className="section-hint" style={{ margin: '-8px 0 14px' }}>
            {deciding.accept
              ? `${deciding.row.name} (${deciding.row.fromRegNo}) joins ${deciding.row.toBranch} with a new registration number, the same course and total fees, what was paid at ${deciding.row.fromBranch} written in, and ${deciding.row.balance > 0 ? `${inr(deciding.row.balance)} still to pay` : 'nothing left to pay'}. Their login moves too.`
              : `${deciding.row.name} stays at ${deciding.row.fromBranch}.`}
          </p>
          {deciding.accept && (!match
            ? <p className="section-hint">Checking the student&apos;s record in this branch…</p>
            : match.kind === 'none'
              ? <p className="section-hint">No record in this branch has this mobile: a new student record is made.</p>
              : (
                <div className={`review-card${blocked ? ' text-red' : ''}`} style={{ display: 'block', marginBottom: 12 }}>
                  <strong>{match.kind === 'same' ? 'Already in this branch' : blocked ? 'This mobile belongs to someone else here' : 'Is this the same student?'}</strong>
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    <div>Moving in: <b>{match.student.name}</b>{match.student.dob ? ` · born ${match.student.dob}` : ''}{match.student.email ? ` · ${match.student.email}` : ''}</div>
                    <div>Record here: <b>{match.existing.name}</b>{match.existing.dob ? ` · born ${match.existing.dob}` : ''}{match.existing.email ? ` · ${match.existing.email}` : ''}{match.existing.hasLogin ? ' · has a student login' : ''}</div>
                    <div style={{ marginTop: 4 }}>{match.kind === 'same' ? `The same student (${match.why}): the transfer is added to this record.` : blocked ? `Cannot accept: ${match.why}. Correct the mobile on one of the two records${match.kind === 'login' ? ', or ask head office' : ''}, then accept.` : `Not sure: ${match.why}.`}</div>
                  </div>
                  {match.kind === 'maybe' && <label style={{ display: 'flex', gap: 6, marginTop: 8, fontSize: 12 }}><input type="checkbox" checked={same} onChange={(e) => { setSame(e.target.checked); setError('') }} /> Yes, it is the same student: add the transfer to this record</label>}
                </div>
              ))}
          <label className="full-label">{deciding.accept ? 'Note (optional)' : 'Reason'}{!deciding.accept && <span className="required-mark">*</span>}<textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} placeholder={deciding.accept ? 'e.g. Joins the evening batch' : 'e.g. No seat in this course'} /></label>
          {error && <p role="alert" className="form-problem">{error}</p>}
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setDeciding(null)}>Cancel</button><button type="button" className="button primary" disabled={pending || (deciding.accept && (!match || blocked))} onClick={decide}>{pending ? 'Saving…' : deciding.accept ? 'Accept transfer' : 'Turn down'}</button></div>
        </Modal>
      )}
    </section>
  )
}
