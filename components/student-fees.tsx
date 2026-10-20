'use client'
// One student's fees on a page of its own: what is charged, paid and still due, the installments, receipts and
// history, and everything that can be done about them. Whoever collects fees works them here; accounts checks them
// and raises remarks for them to fix.
import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Banknote, CalendarRange, CircleDollarSign, FilePenLine, History, IdCard, LayoutList, MessageSquareWarning, Paperclip, Percent, ReceiptText, Send, SlidersHorizontal, Undo2, FileImage, Printer, X } from 'lucide-react'
import { decideFeeChangeAction, requestFeeChangeAction, reversePaymentAction } from '@/app/actions'
import { Err, Modal, OnPage } from '@/components/modal'
import { FeePlanEditor, newPlanState, planPayload, planStateProblem, type PlanState } from '@/components/fee-plan-editor'
import { FeeRemarks, RaiseRemarkForm } from '@/components/fee-remarks'
import { DiscountForm, PlanForm, TotalForm } from '@/components/fees-panel'
import { PaymentForm } from '@/components/payment-form'
import { MIN_FIRST_PAYMENT, paymentChannel, planLabel, planLimits } from '@/modules/fees/plan'
import type { StudentFees } from '@/modules/fees/service'

const inr = (paise: number | null) => (paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN'))
const fmt = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const LEDGER: Record<string, string> = { charge: 'Fee charged', discount: 'Discount', payment: 'Payment', refund: 'Refund', adjustment: 'Adjustment', transfer: 'Moved to another branch' }
// How each kind of entry is drawn in the fee history: its name, colour and icon.
const LEDGER_LOOK: Record<string, [string, string, typeof Banknote]> = {
  charge: ['Fee charged', 'indigo', ReceiptText], discount: ['Discount', 'violet', Percent], payment: ['Payment received', 'green', Banknote],
  refund: ['Refund', 'red', Undo2], adjustment: ['Adjustment', 'amber', SlidersHorizontal], transfer: ['Moved to another branch', 'slate', SlidersHorizontal],
}
const fmtTime = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const REQ: Record<string, [string, string]> = { pending: ['Waiting with accounts', 'status-amber'], approved: ['Approved', 'status-green'], rejected: ['Rejected', 'status-red'] }
const REG: Record<string, string> = { active: 'Active', on_hold: 'On hold', discontinued: 'Discontinued', completed: 'Completed' }

export function StudentFeesPage({ d, paymentModes, canCollect, canEdit = canCollect, canDiscount, canRequest, canReverse = false, canRemark = false, canFix = false, backHref, notify }: {
  d: StudentFees
  paymentModes: { id: string; value: string }[]
  /** Takes payments (admissions). */
  canCollect: boolean
  /** Changes the total and the plan, decides requests. */
  canEdit?: boolean
  canDiscount: boolean
  /** Admissions: may ask accounts for a change. */
  canRequest: boolean
  /** Branch manager / head office: reverses a wrong payment or records a refund. */
  canReverse?: boolean
  /** Accounts: raises a remark on these fees. */
  canRemark?: boolean
  /** Fixes accounts' remarks (whoever collects fees). */
  canFix?: boolean
  backHref: string
  notify: (m: string) => void
}) {
  const r = d.row
  const total = r.charged - r.discounted
  // the ledger is in the order it was written, so the balance after each entry is the sum so far
  const history = d.ledger.map((l, k) => ({ ...l, balance: d.ledger.slice(0, k + 1).reduce((sum, x) => sum + x.amount, 0) }))
  // The page is worked through tabs (also reachable as /fees/<id>?tab=pay): nothing opens in a pop-up.
  const tabs = ([
    ['overview', 'Overview', LayoutList, true], ['pay', 'Record payment', CircleDollarSign, canCollect], ['plan', 'Payment plan', CalendarRange, canEdit],
    ['total', 'Change total fees', FilePenLine, canEdit], ['discount', 'Discount', Percent, canDiscount], ['request', 'Request fee update', Send, !canEdit && canRequest],
    ['remark', 'Raise a remark', MessageSquareWarning, canRemark], ['history', 'Receipts and history', History, true],
  ] as const).filter((t) => t[3])
  type Tab = (typeof tabs)[number][0]
  const asked = useSearchParams().get('tab')
  const [tab, setTab] = useState<Tab>(() => tabs.find((t) => t[0] === asked)?.[0] ?? 'overview')
  const [ver, setVer] = useState(0) // a saved form starts empty again
  const [preview, setPreview] = useState<{ r: StudentFees['receipts'][number]; show: 'receipt' | 'proof' } | null>(null) // a receipt or proof, shown in a small pop-up
  const [reversing, setReversing] = useState<StudentFees['receipts'][number] | null>(null)
  const pending = d.requests.find((q) => q.status === 'pending')
  const openRemarks = d.remarks.filter((q) => q.status === 'open')
  const inactive = r.status === 'active' && total - r.balance < MIN_FIRST_PAYMENT
  const router = useRouter()
  // after any save the page reloads its figures (balance, plan, history) at once: no manual refresh
  const done = (m: string) => { setVer((v) => v + 1); notify(m); router.refresh() }
  const paid = (m: string) => { notify(m); router.refresh() } // the payment form keeps its "received" screen with the receipt

  return (
    <section className="page-container fee-page">
      <a className="fee-back" href={backHref}><ArrowLeft size={15} /> Back</a>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Fees / {r.regNo}</p>
          <h1>{r.name}</h1>
          <p className="subheading">{r.course} · {d.branch} · registered {fmt(d.enrollmentDate)} · {r.phone}</p>
        </div>
        <div className="heading-actions">
          <span className={`status-badge ${inactive ? 'status-slate' : r.status === 'active' ? 'status-green' : 'status-amber'}`}><span className="status-dot" />{inactive ? 'Inactive (no fee yet)' : REG[r.status] ?? r.status}</span>
          <a className="button secondary" href={`/registrations/${r.registrationId}/id-card`} target="_blank" rel="noreferrer"><IdCard size={16} /> ID card</a>
        </div>
      </div>

      <div className="table-summary">
        <div><strong>{inr(total)}</strong><span>Total fees{r.discounted > 0 ? ` (after ${inr(r.discounted)} off)` : ''}</span></div>
        <div><strong className="text-green">{inr(r.paid)}</strong><span>Paid</span></div>
        <div><strong className={r.balance > 0 ? 'text-amber' : 'text-green'}>{r.balance > 0 ? inr(r.balance) : 'Cleared'}</strong><span>Balance</span></div>
        <div><strong className={r.daysOverdue > 0 ? 'text-red' : ''}>{r.nextDue ? inr(r.nextDueAmount ?? 0) : '—'}</strong><span>{r.nextDue ? `Next due ${fmt(r.nextDue)}${r.daysOverdue > 0 ? ` · ${r.daysOverdue}d overdue` : ''}` : 'Nothing scheduled'}</span></div>
      </div>
      {inactive && <p className="fee-note">This student is not active yet. They become active once at least {inr(MIN_FIRST_PAYMENT)} of the fee is received.</p>}

      {pending && <PendingRequest q={pending} total={total} canDecide={canEdit} notify={done} />}
      {openRemarks.length > 0 && <FeeRemarks remarks={openRemarks} canFix={canFix} notify={done} />}

      <div className="fee-tabs" role="tablist" aria-label="Fees">
        {tabs.map(([k, label, Icon]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon size={16} /> {label}</button>)}
      </div>

      {tab === 'overview' && (
        <>
      <div className="fee-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Fee details</h2><span>How the fee was arrived at.</span></div></div>
          <dl className="detail-list">
            <div><dt>Total fees (before offer)</dt><dd>{inr(d.listFee)}</dd></div>
            <div><dt>Discount given</dt><dd>{d.listFee != null && d.listFee > d.totalFee ? inr(d.listFee - d.totalFee) : 'None'}</dd></div>
            <div><dt>Fees to pay</dt><dd>{inr(d.totalFee)}</dd></div>
            <div><dt>of which GST</dt><dd>{d.gstAmount != null ? inr(d.gstAmount) : '—'}</dd></div>
            <div><dt>Payment plan</dt><dd>{planLabel(r.plan)}</dd></div>
            <div><dt>Installments to come</dt><dd>{r.scheduled}</dd></div>
          </dl>
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Installments</h2><span>{r.plan ? planLabel(r.plan) : 'No plan set: the next installment is asked for with each payment.'}</span></div></div>
          {d.installments.length ? (
            <ol className="plan-lines">{d.installments.map((i, k) => (
              <li className={`plan-line ${i.status}`} key={i.id}><i>{k + 1}</i><span>{i.status === 'paid' ? 'Paid' : i.dueDate < today() ? 'Overdue' : 'To pay'}</span><span>{fmt(i.dueDate)}</span><strong>{inr(i.amount)}</strong></li>
            ))}</ol>
          ) : <p className="section-hint" style={{ margin: 0 }}>No installments yet.</p>}
        </div>
      </div>

        </>
      )}

      {tab === 'pay' && (
        <div className="panel">
          <div className="panel-header"><div><h2>Record payment</h2><span>Outstanding <strong>{inr(Math.max(r.balance, 0))}</strong>. Choose how the money came in: what to fill in and the kind of receipt follow from it.</span></div></div>
          <PaymentForm key={ver} row={r} modes={paymentModes} enrolledOn={d.enrollmentDate} onDone={paid} />
        </div>
      )}
      {tab === 'plan' && (
        <div className="panel">
          <div className="panel-header"><div><h2>Payment plan</h2><span>How the rest of the fee is paid: in full or in installments. The new plan replaces the installments still to come.</span></div></div>
          {r.balance > 0 ? <PlanForm key={ver} inline row={r} onClose={() => setTab('overview')} onDone={done} /> : <p className="section-hint" style={{ margin: 0 }}>Nothing is left to pay, so there is nothing to plan.</p>}
        </div>
      )}
      {tab === 'total' && (
        <div className="panel">
          <div className="panel-header"><div><h2>Change total fees</h2><span>Raises or lowers what this student has to pay in all. The coming installments are adjusted.</span></div></div>
          <TotalForm key={ver} inline row={r} onClose={() => setTab('overview')} onDone={done} />
        </div>
      )}
      {tab === 'discount' && (
        <div className="panel">
          <div className="panel-header"><div><h2>Discount</h2><span>Takes an amount off the balance, with a reason.</span></div></div>
          {r.balance > 0 ? <DiscountForm key={ver} inline row={r} onClose={() => setTab('overview')} onDone={done} /> : <p className="section-hint" style={{ margin: 0 }}>Nothing is left to pay, so no discount can be given.</p>}
        </div>
      )}
      {tab === 'request' && (pending
        ? <p className="fee-note">A request is already waiting with accounts (shown above). A new one can be sent once it is decided.</p>
        : <RequestForm key={ver} d={d} notify={done} />)}
      {tab === 'remark' && (
        <div className="panel">
          <div className="panel-header"><div><h2>Raise a remark</h2><span>Something wrong in these fees or a receipt? Say what; whoever collects fees corrects it and marks it fixed.</span></div></div>
          <RaiseRemarkForm key={ver} registrationId={r.registrationId} receipts={d.receipts.map((x) => ({ receiptNo: x.receiptNo, label: `${x.receiptNo} · ${inr(x.amount)} · ${fmt(x.paidAt)}${x.reversal ? ' (cancelled)' : ''}` }))} notify={done} />
        </div>
      )}

      {tab === 'history' && (
        <>
      <div className="panel table-panel">
        <div className="panel-header"><div><h2>Receipts</h2><span>Every payment with its receipt (uploaded paper slip, e-receipt or printed receipt) and the proof of payment. The student sees only the receipt.</span></div></div>
        <div className="table-scroll"><table style={{ minWidth: 0 }}>
          <thead><tr><th>No.</th><th>Date</th><th>Mode</th><th>Receipt</th><th>Proof of payment</th><th>Received by</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
          <tbody>
            {d.receipts.map((x) => {
              const channel = paymentChannel(x.mode)
              const online = channel === 'online'
              const proofs = x.proofs.filter((pf) => !pf.slip)
              return (
                <tr key={x.receiptNo}>
                  <td><strong className="id-text">{x.receiptNo}</strong><small>{x.paperSlip ? 'Slip ID' : online ? 'E-receipt no.' : 'Receipt no.'}</small></td>
                  <td>{fmt(x.paidAt)}</td>
                  <td>{x.mode}<small>{online ? 'Online' : 'Offline'}{x.txnRef ? ` · ${x.txnRef}` : ''}</small></td>
                  {/* what the student holds: the uploaded paper slip, the e-receipt (online) or the printed receipt */}
                  <td>
                    <button type="button" className="filter-button" onClick={() => setPreview({ r: x, show: 'receipt' })}>{x.paperSlip ? <><FileImage size={14} /> Uploaded receipt</> : online ? <><ReceiptText size={14} /> E-receipt</> : <><Printer size={14} /> Receipt</>}</button>
                    <small>{x.paperSlip ? 'Paper slip, as uploaded' : online ? 'Made automatically' : 'To print and sign'}</small>
                  </td>
                  <td>
                    {proofs.length
                      ? proofs.map((pf) => <button key={pf.id} type="button" className="filter-button" title={pf.fileName} onClick={() => setPreview({ r: x, show: 'proof' })}><Paperclip size={14} /> View proof</button>)
                      : <span style={{ color: 'var(--faint)' }}>{channel === 'cash' ? 'Not needed (cash)' : 'Not uploaded'}</span>}
                  </td>
                  <td>{x.receivedBy ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{x.reversal ? <s style={{ color: 'var(--faint)' }}>{inr(x.amount)}</s> : <strong>{inr(x.amount)}</strong>}</td>
                  <td>{x.reversal
                    ? <span className="status-badge status-red" title={`${x.reversal.reason}${x.reversal.by ? ` · by ${x.reversal.by}` : ''} · ${fmt(x.reversal.at)}`}><span className="status-dot" />{x.reversal.kind === 'refund' ? 'Refunded' : 'Cancelled'}</span>
                    : canReverse && <button type="button" className="filter-button" title="Wrong entry or refund: the receipt stays, marked cancelled, and the amount goes back on the balance" onClick={() => setReversing(x)}><Undo2 size={14} /> Reverse</button>}</td>
                </tr>
              )
            })}
            {!d.receipts.length && <tr><td colSpan={8} style={{ padding: 18, color: '#8b98aa' }}>No payment received yet.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {d.oldPayments.length > 0 && (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Payments in the old system</h2><span>Brought over from the old records{d.legacyRegNo ? ` (${d.legacyRegNo})` : ''}, with their old receipt numbers. They count in the balance above; no new receipt is made for them.</span></div></div>
          <div className="table-scroll"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Old receipt</th><th>Date</th><th>Mode</th><th>Book no.</th><th>Note</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {d.oldPayments.map((x, i) => (
                <tr key={`${x.receiptNo}-${i}`}>
                  <td><strong className="id-text">{x.receiptNo ?? '—'}</strong></td>
                  <td>{fmt(x.paidOn)}</td>
                  <td>{x.mode ?? '—'}</td>
                  <td>{x.bookNo && x.bookNo !== '0' ? x.bookNo : '—'}</td>
                  <td>{x.note ?? ''}</td>
                  <td style={{ textAlign: 'right' }}><strong>{inr(x.amount)}</strong></td>
                </tr>
              ))}
              <tr><td colSpan={5} style={{ textAlign: 'right', color: 'var(--muted)' }}>Total paid in the old system</td><td style={{ textAlign: 'right' }}><strong>{inr(d.oldPayments.reduce((n, x) => n + x.amount, 0))}</strong></td></tr>
            </tbody>
          </table></div>
        </div>
      )}

      {d.remarks.length > 0 && <FeeRemarks remarks={d.remarks} canFix={canFix} notify={done} />}

      <div className="fee-grid">
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Fee history</h2><span>Every entry that changed what is owed, oldest first, with the balance after each.</span></div></div>
          <ol className="fee-log">
            {history.map((l, k) => {
              const [label, tone, Icon] = LEDGER_LOOK[l.type] ?? [LEDGER[l.type] ?? l.type, 'slate', SlidersHorizontal]
              return (
                <li key={k} className={tone}>
                  <i aria-hidden><Icon size={16} /></i>
                  <div>
                    <strong>{label}</strong>
                    {l.note && <p>{l.note}</p>}
                    <small>{fmtTime(l.at)}{l.by ? ` · ${l.by}` : ''}</small>
                  </div>
                  <div className="fee-log-amt">
                    <b>{l.amount < 0 ? `− ${inr(-l.amount)}` : `+ ${inr(l.amount)}`}</b>
                    <small>Balance {inr(Math.max(l.balance, 0))}</small>
                  </div>
                </li>
              )
            })}
            {!history.length && <li className="fee-log-none">Nothing has been charged or paid yet.</li>}
          </ol>
        </div>
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Fee update requests</h2><span>What admissions asked accounts to change.</span></div></div>
          <div className="table-scroll"><table style={{ minWidth: 0 }}>
            <thead><tr><th>Asked</th><th>Change</th><th>Reason</th><th>Result</th></tr></thead>
            <tbody>
              {d.requests.map((q) => (
                <tr key={q.id}>
                  <td>{fmt(q.requestedAt)}<small>{q.requestedBy ?? '—'}</small></td>
                  <td>{q.newTotal !== q.currentTotal ? <>{inr(q.currentTotal)} → <strong>{inr(q.newTotal)}</strong></> : 'Same total'}{q.plan && <small>Plan: {planLabel(q.plan)}</small>}</td>
                  <td style={{ maxWidth: 220 }}>{q.reason}</td>
                  <td><span className={`status-badge ${REQ[q.status]?.[1] ?? 'status-slate'}`}>{REQ[q.status]?.[0] ?? q.status}</span>{q.decidedBy && <small>{q.decidedBy}, {fmt(q.decidedAt)}</small>}{q.decisionNote && <small>{q.decisionNote}</small>}</td>
                </tr>
              ))}
              {!d.requests.length && <tr><td colSpan={4} style={{ padding: 18, color: '#8b98aa' }}>No request has been sent.</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

        </>
      )}
      {preview && <ReceiptPreview r={preview.r} show={preview.show} name={r.name} onClose={() => setPreview(null)} />}
      {reversing && <ReverseForm r={reversing} onClose={() => setReversing(null)} onDone={(m) => { setReversing(null); done(m) }} />}
    </section>
  )
}

/** A request that is waiting: accounts approves or rejects it here; admissions sees that it is with accounts. */
function PendingRequest({ q, total, canDecide, notify }: { q: StudentFees['requests'][number]; total: number; canDecide: boolean; notify: (m: string) => void }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const decide = (approve: boolean) => {
    if (!approve && note.trim().length < 3) return setError('Say why the request is rejected.')
    start(async () => {
      const res = await decideFeeChangeAction({ requestId: q.id, approve, note: note || null })
      if (!res.ok) return setError(res.error)
      notify(approve ? 'Request approved: the fees are updated' : 'Request rejected')
    })
  }
  return (
    <div className="panel fee-requests">
      <div className="panel-header"><div><h2>Fee update request waiting</h2><span>Asked by {q.requestedBy ?? 'admissions'} on {fmt(q.requestedAt)}.</span></div></div>
      <dl className="detail-list">
        <div><dt>Total fees</dt><dd>{q.newTotal !== total ? <>{inr(total)} → {inr(q.newTotal)}</> : 'No change'}</dd></div>
        <div><dt>Payment plan</dt><dd>{q.plan ? planLabel(q.plan) : 'No change'}</dd></div>
        <div><dt>Reason</dt><dd>{q.reason}</dd></div>
      </dl>
      {canDecide ? (
        <>
          <label className="full-label">Note (needed to reject)<textarea value={note} onChange={(e) => { setNote(e.target.value); setError('') }} placeholder="Optional when approving" /></label>
          {error && <p role="alert" className="form-problem">{error}</p>}
          <div className="fee-action-row" style={{ marginTop: 14 }}>
            <button className="button primary" disabled={pending} onClick={() => decide(true)}>{pending ? 'Saving…' : 'Approve and update fees'}</button>
            <button className="button secondary" disabled={pending} onClick={() => decide(false)}>Reject</button>
          </div>
        </>
      ) : <p className="section-hint" style={{ margin: '14px 0 0' }}>Accounts will approve or reject it. The fees change only when it is approved.</p>}
    </div>
  )
}

/** Admissions cannot change fees: this sends accounts a request for new total fees and/or another payment plan. */
function RequestForm({ d, notify }: { d: StudentFees; notify: (m: string) => void }) {
  const r = d.row
  const total = r.charged - r.discounted
  const [amount, setAmount] = useState('')
  const [withPlan, setWithPlan] = useState(false)
  const [plan, setPlan] = useState<PlanState>(() => newPlanState(r.nextDue ?? today()))
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const next = amount ? Number(amount) * 100 : total
  const balance = r.balance + next - total // what would be left to pay
  const limits = planLimits(r.courseStart, r.courseEnd, today())
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next === total && !withPlan) return setError('Enter new total fees, or ask for another payment plan.')
    if (balance < 0) return setError(`The student has already paid ${inr(r.paid)}: the total cannot be less than that.`)
    if (withPlan && balance > 0 && planStateProblem(plan, balance, limits)) return setError(`Payment plan: ${planStateProblem(plan, balance, limits)}`)
    if (reason.trim().length < 3) return setError('Say why the fees should change.')
    start(async () => {
      const res = await requestFeeChangeAction({ registrationId: r.registrationId, newTotal: next, reason, plan: withPlan && balance > 0 ? planPayload(plan, balance) : null })
      if (!res.ok) return setError(res.error)
      setAmount(''); setReason(''); setWithPlan(false)
      notify('Request sent to accounts')
    })
  }
  return (
    <form className="panel fee-actions" onSubmit={submit} noValidate>
      <div className="panel-header"><div><h2>Request a fee update</h2><span>Only accounts can change a student&apos;s fees. Fill in what should change; it takes effect when accounts approves.</span></div></div>
      <div className="form-grid">
        <label>New total fees (₹)<input inputMode="numeric" value={amount} placeholder={`Now ${(total / 100).toLocaleString('en-IN')}; leave empty to keep it`} autoComplete="off" onChange={(e) => { setAmount(e.target.value.replace(/\D/g, '').slice(0, 8)); setError('') }} />
          {next !== total && <small className="reg-note">{next > total ? `${inr(next - total)} more than now` : `${inr(total - next)} less than now`} · balance would be {inr(Math.max(balance, 0))}</small>}
        </label>
        <label>Payment plan
          <select value={withPlan ? 'yes' : 'no'} onChange={(e) => { setWithPlan(e.target.value === 'yes'); setError('') }}><option value="no">Keep as it is ({planLabel(r.plan)})</option><option value="yes">Ask for another plan</option></select>
        </label>
      </div>
      {withPlan && balance > 0 && <div style={{ marginTop: 16 }}><FeePlanEditor total={balance} value={plan} limits={limits} onChange={(s) => { setPlan(s); setError('') }} /></div>}
      <label className="full-label">Reason<span className="required-mark">*</span><textarea value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} placeholder="Why the fees should change" /></label>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="fee-action-row" style={{ marginTop: 14 }}><button className="button primary" disabled={pending}><Send size={16} /> {pending ? 'Sending…' : 'Send request to accounts'}</button></div>
    </form>
  )
}

/** A receipt or a proof of payment in a small pop-up: the uploaded picture, or the receipt's main lines. */
/** Reverses a payment: a wrong entry (never received / entered twice) or a refund (money given back). */
function ReverseForm({ r, onClose, onDone }: { r: StudentFees['receipts'][number]; onClose: () => void; onDone: (m: string) => void }) {
  const [kind, setKind] = useState<'wrong_entry' | 'refund'>('wrong_entry')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState('')
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Reverse receipt ${r.receiptNo}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        const res = await reversePaymentAction({ receiptNo: r.receiptNo, kind, reason, refundMode: kind === 'refund' ? mode : null, refundRef: kind === 'refund' ? ref || null : null })
        if (!res.ok) return setError(res.error)
        onDone(`${r.receiptNo} ${kind === 'refund' ? 'refunded' : 'cancelled'}: ${inr(r.amount)} is back on the balance`)
      }) }}>
        <p className="section-hint" style={{ margin: '-8px 0 12px' }}>{inr(r.amount)} paid on {fmt(r.paidAt)} ({r.mode}). The receipt is kept and shown as cancelled; the amount goes back on the student&apos;s balance and onto the coming installments. This cannot be undone.</p>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <div className="tp-chips" role="radiogroup" aria-label="What happened">
            <button type="button" role="radio" aria-checked={kind === 'wrong_entry'} className={kind === 'wrong_entry' ? 'on' : ''} onClick={() => setKind('wrong_entry')}>Wrong entry (not received / entered twice)</button>
            <button type="button" role="radio" aria-checked={kind === 'refund'} className={kind === 'refund' ? 'on' : ''} onClick={() => setKind('refund')}>Refund (money given back)</button>
          </div>
          <label>Why<span className="required-mark">*</span><textarea required rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'refund' ? 'e.g. Student left in the first week; refund approved' : 'e.g. Same UPI payment entered twice'} /></label>
          {kind === 'refund' && <>
            <label>How it was given back<span className="required-mark">*</span><input required maxLength={40} value={mode} onChange={(e) => setMode(e.target.value)} placeholder="Cash, UPI, bank transfer…" /></label>
            <label>Reference (optional)<input maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI / transfer reference" /></label>
          </>}
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending || reason.trim().length < 5 || (kind === 'refund' && !mode.trim())}>{pending ? 'Saving…' : kind === 'refund' ? 'Record refund' : 'Cancel this payment'}</button></div>
      </form>
    </Modal>
  )
}

function ReceiptPreview({ r, show, name, onClose }: { r: StudentFees['receipts'][number]; show: 'receipt' | 'proof'; name: string; onClose: () => void }) {
  const online = paymentChannel(r.mode) === 'online'
  // the uploaded paper slip is the receipt of an offline-slip payment; the proof is the payment's own screenshot or cheque
  const files = r.proofs.filter((p) => (show === 'proof' ? !p.slip : p.slip))
  const title = show === 'proof' ? 'Proof of payment' : r.paperSlip ? 'Uploaded receipt (paper slip)' : online ? 'E-receipt' : 'Receipt'
  const full = `/receipts/${encodeURIComponent(r.receiptNo)}`
  return (
    <OnPage>
    <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <div className="modal-card rc-pop" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><div><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <dl className="rc-pop-lines">
          <div><dt>{r.paperSlip ? 'Slip ID' : 'Receipt no.'}</dt><dd>{r.receiptNo}</dd></div>
          <div><dt>Amount</dt><dd><strong>{inr(r.amount)}</strong></dd></div>
          <div><dt>Date</dt><dd>{fmt(r.paidAt)}</dd></div>
          <div><dt>Mode</dt><dd>{r.mode}{r.txnRef ? ` · ${r.txnRef}` : ''}</dd></div>
          <div><dt>Received from</dt><dd>{name}</dd></div>
          <div><dt>Received by</dt><dd>{r.receivedBy ?? '—'}</dd></div>
        </dl>
        {files.map((f) => (f.mime === 'application/pdf'
          ? <a key={f.id} className="button secondary" href={`/documents/${f.id}`}>Download {f.fileName}</a>
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={f.id} className="rc-pop-img" src={`/documents/${f.id}`} alt={title} />))}
        {show === 'receipt' && !r.paperSlip && <p className="section-hint" style={{ margin: '12px 0 0' }}>{online ? 'Made automatically for the online payment. Non-refundable.' : 'To print and sign. Non-refundable.'}</p>}
        {show !== 'receipt' && !files.length && <p className="section-hint" style={{ margin: '12px 0 0' }}>No proof was uploaded for this payment.</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Close</button>
          {show === 'receipt' && !r.paperSlip && <a className="button primary" href={full} target="_blank" rel="noreferrer"><Printer size={15} /> Print</a>}
        </div>
      </div>
    </div>
    </OnPage>
  )
}
