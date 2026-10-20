'use client'
// Accounts checks the fees admissions collects: its remarks on what is wrong, and the form to raise one. Whoever
// collects fees fixes the entry (a new payment plan, a total, or a reversal by the branch head) and marks it fixed.
import { useState, useTransition } from 'react'
import { fixFeeRemarkAction, raiseFeeRemarkAction } from '@/app/actions'
import type { FeeRemarkRow } from '@/modules/fees/service'

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** Remarks from accounts; `showStudent` on the fees list, where they come from many students. */
export function FeeRemarks({ remarks, canFix, showStudent, notify }: { remarks: FeeRemarkRow[]; canFix: boolean; showStudent?: boolean; notify: (m: string) => void }) {
  const [fixing, setFixing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const open = remarks.filter((q) => q.status === 'open').length
  function fix(q: FeeRemarkRow) {
    if (note.trim().length < 3) return setError('Say what was fixed.')
    start(async () => {
      const res = await fixFeeRemarkAction({ remarkId: q.id, note })
      if (!res.ok) return setError(res.error)
      setFixing(null); setNote(''); setError('')
      notify(`Remark on ${q.regNo} marked fixed`)
    })
  }
  return (
    <div className="panel fee-requests">
      <div className="panel-header"><div>
        <h2>Remarks from accounts{open ? ` · ${open} open` : ''}</h2>
        <span>{canFix ? 'Accounts found something wrong in these fees. Correct it, then mark it fixed saying what was done.' : 'Sent to whoever collects fees. They correct it and mark it fixed.'}</span>
      </div></div>
      <div className="table-scroll">
        <table style={{ minWidth: 0 }}>
          <thead><tr>{showStudent && <th>Student</th>}<th>Remark</th><th>Receipt</th><th>Raised by</th><th>Status</th><th /></tr></thead>
          <tbody>{remarks.map((q) => (
            <tr key={q.id}>
              {showStudent && <td><a className="id-text" href={`/fees/${q.registrationId}`}><strong>{q.regNo}</strong></a><small>{q.name}</small></td>}
              <td style={{ maxWidth: 320 }}>{q.note}</td>
              <td>{q.receiptNo ?? <span style={{ color: 'var(--faint)' }}>Whole fees</span>}</td>
              <td>{q.raisedBy ?? '—'}<small>{fmt(q.raisedAt)}</small></td>
              <td>{q.status === 'open'
                ? <span className="status-badge status-amber"><span className="status-dot" />Open</span>
                : <><span className="status-badge status-green"><span className="status-dot" />Fixed</span><small>{q.fixedBy ?? '—'}, {fmt(q.fixedAt)}</small>{q.fixNote && <small>{q.fixNote}</small>}</>}</td>
              <td>{q.status === 'open' && canFix && fixing !== q.id && <button type="button" className="filter-button" onClick={() => { setFixing(q.id); setNote(''); setError('') }}>Mark fixed</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {fixing && (() => {
        const q = remarks.find((x) => x.id === fixing)!
        return (
          <div style={{ marginTop: 14 }}>
            <label className="full-label">What was fixed ({q.regNo})<span className="required-mark">*</span><textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} placeholder="e.g. Payment plan corrected to 3 installments" /></label>
            {error && <p role="alert" className="form-problem">{error}</p>}
            <div className="fee-action-row" style={{ marginTop: 10 }}>
              <button type="button" className="button primary" disabled={pending} onClick={() => fix(q)}>{pending ? 'Saving…' : 'Mark fixed'}</button>
              <button type="button" className="button secondary" disabled={pending} onClick={() => setFixing(null)}>Cancel</button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

/** Accounts: a remark on this student's fees, or on one receipt. */
export function RaiseRemarkForm({ registrationId, receipts, notify }: { registrationId: string; receipts: { receiptNo: string; label: string }[]; notify: (m: string) => void }) {
  const [receiptNo, setReceiptNo] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (note.trim().length < 5) return setError('Write what is wrong (at least a few words).')
    start(async () => {
      const res = await raiseFeeRemarkAction({ registrationId, receiptNo: receiptNo || null, note })
      if (!res.ok) return setError(res.error)
      setNote(''); setReceiptNo('')
      notify('Remark sent: admissions will fix it')
    })
  }
  return (
    <form onSubmit={submit}>
      <label className="full-label">About
        <select value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)}>
          <option value="">The student&apos;s fees in general</option>
          {receipts.map((r) => <option key={r.receiptNo} value={r.receiptNo}>{r.label}</option>)}
        </select>
      </label>
      <label className="full-label">What is wrong<span className="required-mark">*</span><textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} placeholder="e.g. Amount on receipt does not match the bank statement" /></label>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="fee-action-row" style={{ marginTop: 14 }}><button className="button primary" disabled={pending}>{pending ? 'Sending…' : 'Send remark'}</button></div>
    </form>
  )
}
