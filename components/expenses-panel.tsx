'use client'
// Expenses and profit (app/(panel)/expenses): the month's profit, the six months up to it, the month's spending by
// head, the expenses themselves, and the form to add one.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { addExpenseAction, deleteExpenseAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { ExpenseRow, ProfitReport } from '@/modules/expenses/service'

const inr = (paise: number) => `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

type Props = {
  month: string; thisMonth: string; today: string; report: ProfitReport; rows: ExpenseRow[]
  categories: string[]; modes: string[]; canAdd: boolean; canDelete: boolean
  branches: { id: string; name: string }[]; branchId: string
}

export function ExpensesPanel(p: Props) {
  const router = useRouter()
  const notify = useNotify()
  const [adding, setAdding] = useState(false)
  const [pending, start] = useTransition()
  const go = (q: Record<string, string>) => {
    const u = new URL(window.location.href)
    for (const [k, v] of Object.entries(q)) { if (v) u.searchParams.set(k, v); else u.searchParams.delete(k) }
    router.push(`${u.pathname}${u.search}`)
  }
  const cur = p.report.months[p.report.months.length - 1] ?? { income: 0, expenses: 0, profit: 0, month: p.month }
  const top = Math.max(1, ...p.report.months.map((m) => Math.max(m.income, m.expenses)))
  const spent = p.report.byCategory.reduce((n, c) => n + c.amount, 0)
  const remove = (r: ExpenseRow) => {
    if (!window.confirm(`Delete the ${inr(r.amount)} expense for ${r.category}? It stays on record, out of the totals.`)) return
    start(async () => { const res = await deleteExpenseAction(r.id); notify(res.ok ? 'Expense deleted' : res.error); if (res.ok) router.refresh() })
  }
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Fees &amp; money / Expenses</p><h1>Expenses &amp; profit</h1><p className="subheading">Fees received (payments that stand) less what was spent. Record each expense as it is paid.</p></div>
        <div className="row-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input type="month" value={p.month} max={p.thisMonth} onChange={(e) => e.target.value && go({ month: e.target.value })} aria-label="Month" />
          {!!p.branches.length && <select value={p.branchId} onChange={(e) => go({ branch: e.target.value })} aria-label="Branch"><option value="">All branches</option>{p.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          {p.canAdd && <button type="button" className="button primary" onClick={() => setAdding(true)}><Plus size={15} /> Add expense</button>}
        </div>
      </div>

      <div className="table-summary">
        <div><strong className="text-green">{inr(cur.income)}</strong><span>Fees received · {monthName(p.month)}</span></div>
        <div><strong className="text-amber">{inr(cur.expenses)}</strong><span>Spent</span></div>
        <div><strong className={cur.profit >= 0 ? 'text-green' : 'text-red'} style={cur.profit < 0 ? { color: '#b91c1c' } : undefined}>{inr(cur.profit)}</strong><span>{cur.profit >= 0 ? 'Profit' : 'Loss'}</span></div>
        <div><strong className="text-blue">{cur.income ? `${Math.round((cur.profit * 100) / cur.income)}%` : '—'}</strong><span>Margin</span></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Six months</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {p.report.months.map((m) => (
              <div key={m.month} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span>{monthName(m.month)}</span>
                <div style={{ display: 'grid', gap: 3 }} aria-label={`${monthName(m.month)}: received ${inr(m.income)}, spent ${inr(m.expenses)}`}>
                  <span style={{ height: 8, borderRadius: 4, background: '#10b981', width: `${(m.income * 100) / top}%`, minWidth: m.income ? 3 : 0 }} />
                  <span style={{ height: 8, borderRadius: 4, background: '#f59e0b', width: `${(m.expenses * 100) / top}%`, minWidth: m.expenses ? 3 : 0 }} />
                </div>
                <strong style={{ textAlign: 'right', color: m.profit < 0 ? '#b91c1c' : undefined }}>{inr(m.profit)}</strong>
              </div>
            ))}
          </div>
          <p className="section-hint" style={{ margin: '10px 0 0' }}><span style={{ color: '#10b981' }}>■</span> fees received · <span style={{ color: '#f59e0b' }}>■</span> spent · right: profit</p>
        </div>
        <div className="panel" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Spent in {monthName(p.month)}, by head</h2>
          {!p.report.byCategory.length ? <p className="section-hint" style={{ margin: 0 }}>Nothing recorded this month.</p> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {p.report.byCategory.map((c) => (
                <div key={c.category} style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10, fontSize: 13 }}>
                  <div><span>{c.category}</span><div style={{ height: 6, borderRadius: 3, background: 'var(--tint)', marginTop: 4 }}><div style={{ height: 6, borderRadius: 3, background: 'var(--navy)', width: `${(c.amount * 100) / spent}%` }} /></div></div>
                  <strong style={{ textAlign: 'right' }}>{inr(c.amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>For</th><th>Paid to</th><th>Branch</th><th>Recorded by</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.id}>
                  <td>{day(r.spentOn)}</td>
                  <td><strong>{r.category}</strong>{r.note && <span style={{ display: 'block' }}>{r.note}</span>}</td>
                  <td>{r.paidTo ?? '—'}{r.mode && <span style={{ display: 'block' }}>{r.mode}</span>}</td>
                  <td>{r.branch}</td><td>{r.by}</td>
                  <td style={{ textAlign: 'right' }}><strong>{inr(r.amount)}</strong></td>
                  <td>{p.canDelete && <button type="button" className="filter-button icon-only" title="Delete (entered by mistake)" aria-label={`Delete the ${r.category} expense`} disabled={pending} onClick={() => remove(r)}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
              {!p.rows.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>No expenses recorded in {monthName(p.month)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {adding && <ExpenseForm {...p} onClose={() => setAdding(false)} onDone={() => { setAdding(false); notify('Expense recorded'); router.refresh() }} />}
    </section>
  )
}

function ExpenseForm({ categories, modes, branches, branchId, today, onClose, onDone }: Props & { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ spentOn: today, category: '', amount: '', paidTo: '', mode: '', note: '', branchId })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    const rupees = Number(f.amount.replace(/,/g, ''))
    if (!Number.isFinite(rupees) || rupees <= 0) return setError('Enter the amount')
    const r = await addExpenseAction({ spentOn: f.spentOn, category: f.category, amount: Math.round(rupees * 100), paidTo: f.paidTo, mode: f.mode, note: f.note, branchId: f.branchId || null })
    if (!r.ok) return setError(r.error)
    onDone()
  })
  return (
    <Modal title="Add expense" onClose={onClose}>
      <form className="wl-form" onSubmit={(e) => { e.preventDefault(); save() }}>
        <label>Date<input type="date" value={f.spentOn} max={today} onChange={(e) => setF({ ...f, spentOn: e.target.value })} required /></label>
        <label>Amount (₹)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="e.g. 25000" required /></label>
        <label className="wide">For<input list="expense-heads" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Pick or type, e.g. Rent" required maxLength={60} />
          <datalist id="expense-heads">{categories.map((c) => <option key={c} value={c} />)}</datalist></label>
        <label>Paid to<input value={f.paidTo} onChange={(e) => setF({ ...f, paidTo: e.target.value })} placeholder="e.g. the landlord" maxLength={120} /></label>
        <label>Paid by<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="">—</option>{modes.map((m) => <option key={m}>{m}</option>)}</select></label>
        {!!branches.length && <label className="wide">Branch<select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} required><option value="">Pick the branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <label className="wide">Note (optional)<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. bill no. 4521, October" maxLength={300} /></label>
        <div className="wide"><Err msg={error} /></div>
        <div className="modal-actions wide"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save expense'}</button></div>
      </form>
    </Modal>
  )
}
