'use client'
// How a fee is paid: in full, or in installments (every month, months 1-3-5, or dates and amounts set by hand).
// Used on the registration form and by accounts on the fees page.
import { Plus, Trash2 } from 'lucide-react'
import { DateInput } from '@/components/date-input'
import { buildPlan, limitsLabel, MAX_INSTALLMENTS, PATTERN_LABEL, planProblem, type FeePlan, type PlanLimits, type PlanLine } from '@/modules/fees/plan'

export type PlanState = { type: FeePlan['type']; count: string; pattern: FeePlan['pattern']; firstDue: string; lines: { dueDate: string; amount: string }[] }
export const newPlanState = (firstDue: string): PlanState => ({ type: 'full', count: '3', pattern: 'monthly', firstDue, lines: [] })

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const digits = (v: string) => v.replace(/\D/g, '')
const custom = (s: PlanState) => s.type === 'installments' && s.pattern === 'custom'

/** The installments the plan gives for `total` (paise). */
export function planLines(s: PlanState, total: number): PlanLine[] {
  if (custom(s)) return s.lines.map((l) => ({ dueDate: l.dueDate, amount: l.amount ? Number(l.amount) * 100 : 0 }))
  return buildPlan(total, { type: s.type, count: Number(s.count) || 1, pattern: s.pattern, firstDue: s.firstDue })
}
/** What still stops the plan from being saved; '' when it is fine. `limits` = what the course allows (planLimits). */
export function planStateProblem(s: PlanState, total: number, limits?: PlanLimits | null): string {
  if (!s.firstDue && !custom(s)) return s.type === 'full' ? 'Choose the date the fee is to be paid by.' : 'Choose the date of the first installment.'
  if (s.type === 'installments' && limits && limits.maxCount < 2) return limits.late ? 'Less than a month of the course is left: the rest is paid in one payment (choose full payment).' : `A ${limits.months}-month course is too short for installments: choose full payment.`
  if (s.type === 'installments' && !custom(s) && (!(Number(s.count) >= 2) || Number(s.count) > MAX_INSTALLMENTS)) return `Enter the number of installments (2 to ${Math.min(MAX_INSTALLMENTS, limits?.maxCount ?? MAX_INSTALLMENTS)}).`
  return total > 0 ? planProblem(total, planLines(s, total), limits) : ''
}
/** What is sent to the server. */
export const planPayload = (s: PlanState, total: number) => {
  const lines = planLines(s, total)
  return { type: s.type, count: s.type === 'full' ? 1 : custom(s) ? Math.max(1, lines.length) : Number(s.count) || 1, pattern: s.pattern, firstDue: custom(s) ? lines[0]?.dueDate ?? s.firstDue : s.firstDue, lines: custom(s) ? lines : null }
}

export function FeePlanEditor({ total, value, onChange, limits }: { total: number; value: PlanState; onChange: (s: PlanState) => void; limits?: PlanLimits | null }) {
  const set = (patch: Partial<PlanState>) => onChange({ ...value, ...patch })
  const lines = planLines(value, total)
  const maxCount = Math.min(MAX_INSTALLMENTS, limits?.maxCount ?? MAX_INSTALLMENTS)
  const problem = total > 0 ? planStateProblem(value, total, limits) : ''
  const isCustom = custom(value)
  const sum = lines.reduce((n, l) => n + l.amount, 0)
  /** Switching to "custom" starts from the monthly split, so only what differs is retyped. */
  const toCustom = () => set({ pattern: 'custom', lines: buildPlan(total, { type: 'installments', count: Math.min(Number(value.count) || 3, Math.max(2, maxCount)), pattern: 'monthly', firstDue: value.firstDue }).map((l) => ({ dueDate: l.dueDate, amount: String(l.amount / 100) })) })
  const setLine = (i: number, patch: Partial<PlanState['lines'][number]>) => set({ lines: value.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) })

  return (
    <div className="plan-editor">
      {limits && <p className="section-hint" style={{ margin: '0 0 12px' }}>{limitsLabel(limits)}</p>}
      <div className="form-grid">
        <label>Fee type<span className="required-mark">*</span>
          <select name="planType" value={value.type} onChange={(e) => set({ type: e.target.value as FeePlan['type'], ...(Number(value.count) > maxCount && maxCount >= 2 ? { count: String(maxCount) } : {}) })}><option value="full">Full payment (one time)</option><option value="installments">Installments</option></select>
        </label>
        {value.type === 'full' && <label>To be paid by<span className="required-mark">*</span><DateInput name="planFirstDue" type="date" required value={value.firstDue} onChange={(e) => set({ firstDue: e.target.value })} /></label>}
        {value.type === 'installments' && (
          <>
            <label>Installments fall due<span className="required-mark">*</span>
              <select name="planPattern" value={value.pattern} onChange={(e) => (e.target.value === 'custom' ? toCustom() : set({ pattern: e.target.value as FeePlan['pattern'] }))}>
                {(Object.keys(PATTERN_LABEL) as FeePlan['pattern'][]).map((k) => <option key={k} value={k}>{PATTERN_LABEL[k]}</option>)}
              </select>
            </label>
            {!isCustom && <label>Number of installments<span className="required-mark">*</span><input name="planCount" inputMode="numeric" required value={value.count} autoComplete="off" onChange={(e) => set({ count: digits(e.target.value).slice(0, 2) })} />{limits && maxCount >= 2 && <small className="reg-note">2 to {maxCount} for this course</small>}</label>}
            {!isCustom && <label>First installment on<span className="required-mark">*</span><DateInput name="planFirstDue" type="date" required value={value.firstDue} onChange={(e) => set({ firstDue: e.target.value })} /></label>}
          </>
        )}
      </div>

      {isCustom ? (
        <div className="plan-lines">
          {value.lines.map((l, i) => (
            <div className="plan-line edit" key={i}>
              <i>{i + 1}</i>
              <DateInput aria-label={`Installment ${i + 1} date`} type="date" required value={l.dueDate} onChange={(e) => setLine(i, { dueDate: e.target.value })} />
              <input aria-label={`Installment ${i + 1} amount`} inputMode="numeric" required placeholder="Amount (₹)" value={l.amount} autoComplete="off" onChange={(e) => setLine(i, { amount: digits(e.target.value).slice(0, 8) })} />
              <button type="button" className="filter-button icon-only danger" title="Remove installment" aria-label={`Remove installment ${i + 1}`} disabled={value.lines.length === 1} onClick={() => set({ lines: value.lines.filter((_, k) => k !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <div className="plan-foot">
            <button type="button" className="button secondary" disabled={value.lines.length >= Math.max(2, maxCount)} onClick={() => set({ lines: [...value.lines, { dueDate: '', amount: total > sum ? String((total - sum) / 100) : '' }] })}><Plus size={15} /> Add installment</button>
            <span className={sum === total ? 'ok' : 'bad'}>{inr(sum)} of {inr(total)}{sum === total ? ' · adds up' : sum < total ? ` · ${inr(total - sum)} still to place` : ` · ${inr(sum - total)} too much`}</span>
          </div>
        </div>
      ) : total > 0 && lines.length > 0 && value.firstDue ? (
        <ol className="plan-lines">
          {lines.map((l, i) => <li className="plan-line" key={i}><i>{i + 1}</i><span>{value.type === 'full' ? 'Full fee' : i === 0 ? 'First installment' : `Installment ${i + 1}`}</span><span>{fmt(l.dueDate)}</span><strong>{inr(l.amount)}</strong></li>)}
        </ol>
      ) : null}
      {limits && problem && lines.length > 0 && <p className="form-problem" style={{ marginTop: 10 }}>{problem}</p>}
    </div>
  )
}
