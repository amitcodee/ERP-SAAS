'use client'
// Moving a student to another branch (transfer) or sending them to another branch for some classes (share):
// the two request forms, opened from a registration (its row or View popup) or from the Transfers / Shared Students
// pages, where a picker finds the student first.
import { useEffect, useState, useTransition } from 'react'
import { ArrowRightLeft, Search, Share2 } from 'lucide-react'
import { askShareAction, queryRegistrationsAction, requestTransferAction } from '@/app/actions'
import { Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { REG_STATUS_LABEL, type RegistrationStatus } from '@/modules/registrations/status'

type Branch = { id: string; name: string }
/** What the forms need of a registration. */
export type MoveRow = { id: string; branchId: string; regNo: string; name: string; status: RegistrationStatus; course?: string | null; phone?: string }

/** Who may be moved (active or on hold) and who may be shared (active only). */
export const movable = (kind: 'transfer' | 'share', r: { status: RegistrationStatus }) => kind === 'share' ? r.status === 'active' : r.status === 'active' || r.status === 'on_hold'

/** The branch a student leaves asks to move them; the other branch accepts it in Transfers, and only then does anything move. */
export function TransferForm({ row, branches, onClose, onDone }: { row: MoveRow; branches: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!to) return setError('Choose the branch the student moves to.')
    start(async () => {
      const res = await requestTransferAction({ registrationId: row.id, toBranchId: to, reason })
      if (!res.ok) return setError(res.error)
      onDone(`Transfer of ${row.regNo} sent to ${branches.find((b) => b.id === to)?.name}: it moves once they accept`)
    })
  }
  return (
    <Modal title={`Transfer ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name}. The other branch accepts it; until then the student stays here. On acceptance they get the student, the course, what is still to pay and the coming installments; payments and receipts made here stay here.</p>
      <form onSubmit={submit}>
        <div className="form-grid"><label>Move to branch<span className="required-mark">*</span><select value={to} required onChange={(e) => { setTo(e.target.value); setError('') }}><option value="" disabled>Select branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div>
        <label className="full-label">Reason<span className="required-mark">*</span><textarea value={reason} required onChange={(e) => { setReason(e.target.value); setError('') }} placeholder="e.g. Family moved to Phagwara" /></label>
        {error && <p role="alert" className="form-problem">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Sending…' : 'Ask for transfer'}</button></div>
      </form>
    </Modal>
  )
}

/** The student stays ours and also takes classes in another branch (some days there, or online); that branch accepts in Shared Students. */
export function ShareForm({ row, branches, onClose, onDone }: { row: MoveRow; branches: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [to, setTo] = useState('')
  const [mode, setMode] = useState<'classroom' | 'online'>('classroom')
  const [schedule, setSchedule] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!to) return setError('Choose the branch the student also goes to.')
    start(async () => {
      const res = await askShareAction({ registrationId: row.id, toBranchId: to, mode, schedule: schedule || null, note })
      if (!res.ok) return setError(res.error)
      onDone(`${row.regNo}: asked ${branches.find((b) => b.id === to)?.name} to take them for classes; they choose the batch when they accept`)
    })
  }
  return (
    <Modal title={`Classes in another branch — ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} stays a student of this branch (fees, certificate and records stay here). The other branch puts them in one of its batches; the attendance and marks there count here. They see only this student, never the fees.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Branch<span className="required-mark">*</span><select value={to} required onChange={(e) => { setTo(e.target.value); setError('') }}><option value="" disabled>Select branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>How<select value={mode} onChange={(e) => setMode(e.target.value as 'classroom' | 'online')}><option value="classroom">In the classroom</option><option value="online">Online</option></select></label>
          <label>Days / times<input value={schedule} maxLength={120} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. Tue, Thu, Sat 4–6 pm" /></label>
        </div>
        <label className="full-label">Why<span className="required-mark">*</span><textarea value={note} required onChange={(e) => { setNote(e.target.value); setError('') }} placeholder="e.g. Lives near Mohali; comes there three days a week" /></label>
        {error && <p role="alert" className="form-problem">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Sending…' : 'Ask the branch'}</button></div>
      </form>
    </Modal>
  )
}

/** The page's top button: find the student (name, phone or registration ID), then the transfer / share form. */
export function NewMoveButton({ kind, branches, onDone }: { kind: 'transfer' | 'share'; branches: Branch[]; onDone: () => void }) {
  const notify = useNotify()
  const [open, setOpen] = useState(false)
  const [row, setRow] = useState<MoveRow | null>(null)
  const close = () => { setOpen(false); setRow(null) }
  const done = (m: string) => { close(); notify(m); onDone() }
  const Icon = kind === 'transfer' ? ArrowRightLeft : Share2
  const others = row ? branches.filter((b) => b.id !== row.branchId) : []
  return (
    <>
      <button type="button" className="button primary" onClick={() => setOpen(true)}><Icon size={16} /> {kind === 'transfer' ? 'New transfer' : 'Share a student'}</button>
      {open && !row && <PickStudent kind={kind} onPick={setRow} onClose={close} />}
      {row && (kind === 'transfer'
        ? <TransferForm row={row} branches={others} onClose={close} onDone={done} />
        : <ShareForm row={row} branches={others} onClose={close} onDone={done} />)}
    </>
  )
}

function PickStudent({ kind, onPick, onClose }: { kind: 'transfer' | 'share'; onPick: (r: MoveRow) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<MoveRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const t = window.setTimeout(async () => {
      const res = await queryRegistrationsAction({ q: q.trim() || undefined }, 0)
      if (!live) return
      if (!res.ok) return setError(res.error)
      setError('')
      setRows(res.data!.rows)
    }, q ? 300 : 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [q])
  const why = kind === 'share' ? 'Only an active student can take classes in another branch.' : 'Only an active or on-hold student can be transferred.'
  return (
    <Modal title={kind === 'transfer' ? 'New transfer: choose the student' : 'Share a student: choose the student'} onClose={onClose}>
      <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label style={{ position: 'relative' }}>Student
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or registration ID" style={{ paddingLeft: 38 }} />
          <Search size={16} style={{ position: 'absolute', left: 14, bottom: 16, color: '#8b98aa' }} />
        </label>
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="move-pick" role="listbox" aria-label="Students">
        {rows === null ? <p className="section-hint">Loading…</p>
          : !rows.length ? <p className="section-hint">No student matches “{q}”.</p>
          : rows.map((r) => {
            const ok = movable(kind, r)
            return (
              <button key={r.id} type="button" role="option" aria-selected={false} disabled={!ok} title={ok ? undefined : why} onClick={() => onPick(r)}>
                <span><strong>{r.name}</strong><small>{r.regNo}{r.course ? ` · ${r.course}` : ''}{r.phone ? ` · ${r.phone}` : ''}</small></span>
                <em>{REG_STATUS_LABEL[r.status]}</em>
              </button>
            )
          })}
      </div>
      <p className="section-hint" style={{ margin: '10px 0 0' }}>{why}</p>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button></div>
    </Modal>
  )
}
