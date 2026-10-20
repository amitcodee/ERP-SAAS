'use client'

import { Modal } from '@/components/modal'
import { useEffect, useState, useTransition } from 'react'
import { Eye, X } from 'lucide-react'
import { applyDiscountAction, changeTotalFeeAction, decideFeeChangeAction, feeScheduleAction, queryFeesAction, setFeePlanAction } from '@/app/actions'
import { FeePlanEditor, newPlanState, planPayload, planStateProblem, type PlanState } from '@/components/fee-plan-editor'
import { planLabel, planLimits } from '@/modules/fees/plan'
import { ListToolbar, opts, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { usePagedList } from '@/components/use-paged-list'
import type { Summaries } from '@/modules/reports/service'
import type { FeeChangeRequestRow, FeeRemarkRow, FeeRow, InstallmentRow, MonthDue } from '@/modules/fees/service'
import { FeeRemarks } from '@/components/fee-remarks'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const val = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null }
const toPaise = (v: string | null) => (v ? Math.round(Number(v) * 100) : 0)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 'overdue' or 'YYYY-MM' -> 'Overdue' / 'Nov 2026'. */
const monthName = (key: string) => (key === 'overdue' ? 'Overdue' : `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`)

/** Dues still to collect, month by month (overdue first); a click filters the list to that month. */
function DueMonths({ dues, active, pick }: { dues: MonthDue[]; active: string | null; pick: (key: string) => void }) {
  return (
    <div className="due-months" role="group" aria-label="Dues by month">
      {dues.map((m, i) => (
        <button key={m.key} type="button" className={`due-month${m.key === 'overdue' ? ' overdue' : ''}${active === m.key ? ' on' : ''}`} aria-pressed={active === m.key} onClick={() => pick(active === m.key ? '' : m.key)}
          title={active === m.key ? 'Show every student again' : `Show the students with fees due ${m.key === 'overdue' ? 'and overdue' : 'in ' + monthName(m.key)}`}>
          <span>{m.key === 'overdue' ? 'Overdue' : i === 1 ? `This month · ${monthName(m.key)}` : i === 2 ? `Next month · ${monthName(m.key)}` : monthName(m.key)}</span>
          <strong>{inr(m.amount)}</strong>
          <small>{m.students ? `${m.students} student${m.students === 1 ? '' : 's'}` : 'Nothing due'}</small>
        </button>
      ))}
    </div>
  )
}


/** A form's frame: a pop-up, or (inline) straight in the page. */
function Frame({ inline, title, onClose, children }: { inline?: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return inline ? <div className="inline-form">{children}</div> : <Modal title={title} onClose={onClose}>{children}</Modal>
}

export function FeesPanel({
  rows, total, summary, departments, requests, remarks = [], canFix = false, dues, canCollect, canEdit = canCollect, notify,
}: {
  /** Fee changes asked for by admissions, waiting for accounts. */
  requests: FeeChangeRequestRow[]
  /** Accounts' remarks still open. */
  remarks?: FeeRemarkRow[]
  canFix?: boolean
  /** Dues by month: overdue, this month and the next five. */
  dues: MonthDue[]
  rows: FeeRow[]
  total: number
  summary: Summaries['fees']
  departments: { id: string; name: string }[]
  canCollect: boolean
  /** changes total fees and plans, decides requests */
  canEdit?: boolean
  canDiscount: boolean
  notify: (m: string) => void
}) {
  const list = usePagedList({ rows, total }, queryFeesAction)
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Management / Fees</p><h1>Fee management</h1><p className="subheading">Balance is always calculated from the ledger, never typed in.</p></div>
      </div>
      <div className="table-summary">
        <div><strong className="text-green">{inr(summary.collected)}</strong><span>Collected</span></div>
        <div><strong className="text-amber">{inr(summary.pending)}</strong><span>Pending dues</span></div>
        <div><strong className="text-red">{summary.overdue}</strong><span>Overdue installments</span></div>
        <div><strong>{summary.registrations.toLocaleString('en-IN')}</strong><span>Registrations</span></div>
      </div>
      {remarks.length > 0 && <FeeRemarks remarks={remarks} canFix={canFix} showStudent notify={notify} />}
      {requests.length > 0 && <FeeRequests requests={requests} canDecide={canEdit} notify={notify} />}
      <DueMonths dues={dues} active={list.filter('month') || null} pick={(k) => list.setFilter('month', k)} />
      <div className="panel table-panel">
        <ListToolbar list={list} exportList={'fees'} placeholder="Search by registration ID, name or phone…" dateLabel="Next due" dateFuture
          filters={[
            { key: 'month', label: 'Due in', options: dues.map((m) => ({ value: m.key, label: monthName(m.key) })) },
            { key: 'balance', label: 'Balance', options: [{ value: 'due', label: 'Has dues' }, { value: 'overdue', label: 'Overdue' }, { value: 'cleared', label: 'Cleared' }] },
            { key: 'status', label: 'Registration', options: [{ value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'discontinued', label: 'Discontinued' }, { value: 'completed', label: 'Completed' }, { value: 'transferred', label: 'Transferred' }] },
            { key: 'dept', label: 'Department', options: opts(departments, (d) => d.id, (d) => d.name) },
          ]}
          sorts={[
            { key: 'due', label: 'Next due, soonest', dir: 'asc' }, { key: 'balance', label: 'Balance, highest', dir: 'desc' }, { key: 'balance', label: 'Balance, lowest', dir: 'asc' },
            { key: 'paid', label: 'Paid, highest', dir: 'desc' }, { key: 'total', label: 'Total, highest', dir: 'desc' },
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'reg', label: 'Registration ID', dir: 'asc' }, { key: 'enrolled', label: 'Enrolled, latest', dir: 'desc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="reg">Registration ID</SortTh><SortTh list={list} k="name">Student</SortTh><th>Course</th><SortTh list={list} k="total" first="desc">Total</SortTh><SortTh list={list} k="paid" first="desc">Paid</SortTh><SortTh list={list} k="balance" first="desc">Balance</SortTh><SortTh list={list} k="due">Next installment</SortTh><th /></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.registrationId}>
                  <td><a className="id-text" href={`/fees/${r.registrationId}`} title="Open this student's fees page"><strong>{r.regNo}</strong></a></td>
                  <td><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.phone}</span></div></td>
                  <td>{r.course}<small>{planLabel(r.plan)}{r.plan && r.scheduled > 0 ? ` · ${r.scheduled} to come` : ''}</small></td>
                  <td>{inr(r.charged - r.discounted)}{r.discounted > 0 && <small>after {inr(r.discounted)} discount</small>}</td>
                  <td>{inr(r.paid)}</td>
                  <td><strong className={r.balance > 0 ? 'text-amber' : 'text-green'}>{r.balance > 0 ? inr(r.balance) : 'Cleared'}</strong></td>
                  <td>{r.nextDue ? <span className={r.daysOverdue > 0 ? 'due-text' : ''}>{fmt(r.nextDue)} · {inr(r.nextDueAmount ?? 0)}{r.daysOverdue > 0 ? ` · ${r.daysOverdue}d overdue` : ''}</span> : '—'}
                    {list.filter('month') && r.monthDue ? <small className="month-due">{list.filter('month') === 'overdue' ? 'Overdue in all' : `Due in ${monthName(list.filter('month'))}`}: <strong>{inr(r.monthDue)}</strong></small> : null}</td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <a className="filter-button icon-only" href={`/fees/${r.registrationId}`} title="View this student's fees: payments, plan, receipts and changes" aria-label={`View fees of ${r.name}`}><Eye size={15} /></a>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'Nothing matches these filters.' : 'No registrations to collect fees from yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="registrations" />
      </div>
    </section>
  )
}

/** Fee changes asked for by admissions: accounts approves (the total fees change) or rejects with a reason. */
function FeeRequests({ requests, canDecide, notify }: { requests: FeeChangeRequestRow[]; canDecide: boolean; notify: (m: string) => void }) {
  const [busy, setBusy] = useState('')
  const [rejecting, setRejecting] = useState<FeeChangeRequestRow | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  async function decide(q: FeeChangeRequestRow, approve: boolean, why?: string) {
    setBusy(q.id); setError('')
    const res = await decideFeeChangeAction({ requestId: q.id, approve, note: why })
    setBusy('')
    if (!res.ok) return setError(res.error)
    setRejecting(null); setNote('')
    notify(approve ? `Total fees of ${q.regNo} changed to ${inr(q.newTotal)}` : `Fee change for ${q.regNo} rejected`)
  }
  return (
    <div className="panel fee-requests">
      <div className="panel-header"><div><h2>Fee update requests</h2><span>Sent by admissions. Approving changes the student&apos;s total fees; the coming installments are adjusted.</span></div></div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="table-scroll">
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>Registration ID</th><th>Student</th><th>Total now</th><th>Asked for</th><th>Reason</th><th>Asked by</th><th /></tr></thead>
          <tbody>{requests.map((q) => (
            <tr key={q.id}>
              <td><a className="id-text" href={`/fees/${q.registrationId}`}><strong>{q.regNo}</strong></a></td><td>{q.name}</td><td>{inr(q.currentTotal)}</td>
              <td>{q.newTotal === q.currentTotal ? <span>Same total</span> : <><strong className={q.newTotal < q.currentTotal ? 'text-green' : 'text-amber'}>{inr(q.newTotal)}</strong><small>{q.newTotal < q.currentTotal ? `${inr(q.currentTotal - q.newTotal)} less` : `${inr(q.newTotal - q.currentTotal)} more`}</small></>}{q.plan && <small>New plan: {planLabel(q.plan)}</small>}</td>
              <td style={{ maxWidth: 260 }}>{q.reason}</td><td>{q.requestedBy ?? '—'}<small>{fmt(q.requestedAt)}</small></td>
              <td>{canDecide && <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="filter-button" disabled={busy === q.id} onClick={() => decide(q, true)}>Approve</button>
                <button className="filter-button" disabled={busy === q.id} onClick={() => { setRejecting(q); setNote(''); setError('') }}>Reject</button>
              </div>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {rejecting && (
        <Modal title={`Reject fee change — ${rejecting.regNo}`} onClose={() => setRejecting(null)}>
          <label className="full-label">Reason<span className="required-mark">*</span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the fees stay as they are" /></label>
          {error && <p role="alert" className="form-problem">{error}</p>}
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRejecting(null)}>Cancel</button><button type="button" className="button primary" disabled={!!busy} onClick={() => (note.trim().length < 3 ? setError('Say why the request is rejected.') : decide(rejecting, false, note))}>Reject request</button></div>
        </Modal>
      )}
    </div>
  )
}

/** Accounts sets how the rest of the fee is paid: in full, or in installments on a schedule. */
export function PlanForm({ row, onClose, onDone, inline }: { row: FeeRow; onClose: () => void; onDone: (m: string) => void; inline?: boolean }) {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const [plan, setPlan] = useState<PlanState>(() => (row.plan ? { ...newPlanState(row.nextDue ?? today), type: row.plan.type, pattern: row.plan.pattern === 'custom' ? 'monthly' : row.plan.pattern, count: String(Math.max(2, row.scheduled || row.plan.count)) } : newPlanState(row.nextDue ?? today)))
  const [now, setNow] = useState<InstallmentRow[] | null>(null)
  const limits = planLimits(row.courseStart, row.courseEnd, today)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => { feeScheduleAction(row.registrationId).then((r) => r.ok && r.data && setNow(r.data.installments)) }, [row.registrationId])
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = planStateProblem(plan, row.balance, limits)
    if (problem) return setError(problem)
    start(async () => {
      const res = await setFeePlanAction({ registrationId: row.registrationId, plan: planPayload(plan, row.balance) })
      if (!res.ok) return setError(res.error)
      onDone(`Payment plan of ${row.regNo} saved`)
    })
  }
  return (
    <Frame inline={inline} title={`Payment plan — ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · still to pay <strong>{inr(row.balance)}</strong> · now: {planLabel(row.plan)}. The new plan replaces the installments that are still to come.</p>
      {now && now.length > 0 && (
        <ol className="plan-lines" style={{ marginBottom: 16 }}>{now.map((i, k) => <li className="plan-line" key={i.id}><i>{k + 1}</i><span>{i.status === 'paid' ? 'Paid' : 'To pay (now)'}</span><span>{fmt(i.dueDate)}</span><strong>{inr(i.amount)}</strong></li>)}</ol>
      )}
      <form onSubmit={submit} noValidate>
        <FeePlanEditor total={row.balance} value={plan} limits={limits} onChange={(s) => { setPlan(s); setError('') }} />
        {error && <p role="alert" className="form-problem">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save plan'}</button></div>
      </form>
    </Frame>
  )
}

/** Accounts changes a student's total fees (admissions can only ask for it). */
export function TotalForm({ row, onClose, onDone, inline }: { row: FeeRow; onClose: () => void; onDone: (m: string) => void; inline?: boolean }) {
  const total = row.charged - row.discounted
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const next = amount ? Number(amount) * 100 : 0
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next <= 0) return setError('Enter the new total fees.')
    if (reason.trim().length < 3) return setError('Say why the fees are changed.')
    start(async () => {
      const res = await changeTotalFeeAction({ registrationId: row.registrationId, newTotal: next, reason })
      if (!res.ok) return setError(res.error)
      onDone(`Total fees of ${row.regNo} changed to ${inr(next)}`)
    })
  }
  return (
    <Frame inline={inline} title={`Change total fees — ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · total fees now <strong>{inr(total)}</strong>, paid {inr(row.paid)}, balance {inr(Math.max(row.balance, 0))}. The coming installments are adjusted to the new balance.</p>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>New total fees (₹)<span className="required-mark">*</span><input inputMode="numeric" value={amount} autoComplete="off" onChange={(e) => { setAmount(e.target.value.replace(/\D/g, '').slice(0, 8)); setError('') }} />
            {next > 0 && next !== total && <small style={{ display: 'block', marginTop: 6, color: 'var(--muted)', fontWeight: 400 }}>{next > total ? `${inr(next - total)} more` : `${inr(total - next)} less`} · balance becomes {inr(row.balance + next - total)}</small>}
          </label>
        </div>
        <label className="full-label">Reason<span className="required-mark">*</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the total fees are changed" /></label>
        {error && <p role="alert" className="form-problem">{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Change total fees'}</button></div>
      </form>
    </Frame>
  )
}

export function DiscountForm({ row, onClose, onDone, inline }: { row: FeeRow; onClose: () => void; onDone: (m: string) => void; inline?: boolean }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const res = await applyDiscountAction({ registrationId: row.registrationId, amount: toPaise(val(fd, 'amount')), reason: val(fd, 'reason') ?? '' })
      if (!res.ok) return setError(res.error)
      onDone('Discount applied')
    })
  }
  return (
    <Frame inline={inline} title={`Discount — ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · outstanding <strong>{inr(row.balance)}</strong>. Give what the student needs, with a reason.</p>
      <form onSubmit={submit}>
        <div className="form-grid"><label>Discount amount (₹)<span className="required-mark">*</span><input name="amount" type="number" min="1" step="0.01" required /></label></div>
        <label className="full-label">Reason<span className="required-mark">*</span><textarea name="reason" required minLength={3} /></label>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Apply discount'}</button></div>
      </form>
    </Frame>
  )
}
