// Shared with the browser: how a fee is split into installments. No server code. Money in paise, dates 'YYYY-MM-DD'.

/** A student counts as active once at least this much has been paid; the first payment cannot be smaller (unless less is due). */
export const MIN_FIRST_PAYMENT = 500_00

/**
 * full = one payment. installments = `count` payments: 'monthly' every month, 'alternate' every second month
 * (months 1, 3, 5...), 'custom' = dates and amounts set by hand.
 */
export type FeePlan = { type: 'full' | 'installments'; count: number; pattern: 'monthly' | 'alternate' | 'custom'; firstDue: string }
export type PlanLine = { dueDate: string; amount: number }

export const PATTERN_LABEL: Record<FeePlan['pattern'], string> = { monthly: 'Every month', alternate: 'Months 1, 3, 5… (every second month)', custom: 'Custom dates and amounts' }
export const MAX_INSTALLMENTS = 24

/** The same day n months later (the last day of the month when that day does not exist, e.g. 31 Jan + 1 = 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}

/** The installments of a plan for `total`: equal parts in whole rupees, the odd remainder on the first one. */
export function buildPlan(total: number, plan: FeePlan): PlanLine[] {
  if (total <= 0) return []
  if (plan.type === 'full') return [{ dueDate: plan.firstDue, amount: total }]
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(plan.count)))
  const part = Math.floor(total / n / 100) * 100
  const step = plan.pattern === 'alternate' ? 2 : 1
  return Array.from({ length: n }, (_, i) => ({ dueDate: addMonths(plan.firstDue, i * step), amount: i === 0 ? total - part * (n - 1) : part })).filter((l) => l.amount > 0)
}

// ---- How long a course gives to pay: installments stop one month before it ends ----

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2027-01-09' -> '9 Jan 2027' (the same on the server and in the browser). */
export const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTH[m - 1]} ${y}` }

/**
 * What the course allows: at most one installment fewer than its months (a 3-month course: 2), and the last one
 * paid a month before it ends (ends 9 Jan: last by 9 Dec). `months` = the course's length, rounded to whole months.
 */
export type PlanLimits = { start: string; end: string; months: number; maxCount: number; lastDue: string; late: boolean }
/** `today` ('YYYY-MM-DD'): when the last date has already gone by (a plan redone late in the course), only one payment of the rest is allowed, on any date. */
export function planLimits(start: string | null | undefined, end: string | null | undefined, today?: string): PlanLimits | null {
  if (!start || !end || end <= start) return null
  const months = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 / 30.4375))
  const lastDue = addMonths(end, -1)
  const late = !!today && today > lastDue
  return { start, end, months, maxCount: late ? 1 : Math.max(1, months - 1), lastDue, late }
}
/** "Course ends 9 Jan 2027 (3 months): up to 2 installments, the last by 9 Dec 2026." */
export function limitsLabel(l: PlanLimits): string {
  const head = `Course ends ${dayLabel(l.end)} (${l.months} month${l.months === 1 ? '' : 's'})`
  if (l.late) return `${head}: fees were to be cleared by ${dayLabel(l.lastDue)}, so the rest is paid in one payment.`
  if (l.maxCount < 2) return `${head}: too short for installments. The full fee is paid by ${dayLabel(l.lastDue)}.`
  return `${head}: up to ${l.maxCount} installments, the last by ${dayLabel(l.lastDue)}.`
}
/** Today in India, 'YYYY-MM-DD' (the server's clock is UTC). */
export { todayIST } from '@/lib/ist'

/** What is wrong with a set of installments for `total`; '' when it is fine. `limits` = what the course allows (none when its dates are not known). */
export function planProblem(total: number, lines: PlanLine[], limits?: PlanLimits | null): string {
  if (!lines.length) return 'Add at least one installment.'
  if (lines.some((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.dueDate))) return 'Every installment needs a date.'
  if (lines.some((l) => !Number.isInteger(l.amount) || l.amount <= 0)) return 'Every installment needs an amount.'
  if (lines.some((l, i) => i > 0 && l.dueDate < lines[i - 1].dueDate)) return 'The installment dates must be in order.'
  const sum = lines.reduce((n, l) => n + l.amount, 0)
  if (sum !== total) return `The installments add up to ₹${(sum / 100).toLocaleString('en-IN')}, but ₹${(total / 100).toLocaleString('en-IN')} is to be paid.`
  if (limits) {
    if (lines.length > limits.maxCount && lines.length > 1)
      return limits.late ? `Less than a month of the course is left: the rest is paid in one payment (choose full payment).`
        : limits.maxCount < 2 ? `A ${limits.months}-month course is too short for installments: choose full payment.`
        : `A ${limits.months}-month course can have at most ${limits.maxCount} installments.`
    if (limits.late) return ''
    const last = lines[lines.length - 1].dueDate
    if (last > limits.lastDue) return `${lines.length > 1 ? 'The last installment' : 'The fee'} must be paid by ${dayLabel(limits.lastDue)}, one month before the course ends (${dayLabel(limits.end)}).`
  }
  return ''
}

/** "Full payment" / "4 installments, every month" */
export const planLabel = (p: FeePlan | null | undefined) => (!p ? 'No plan set' : p.type === 'full' ? 'Full payment' : `${p.count} installments, ${p.pattern === 'monthly' ? 'every month' : p.pattern === 'alternate' ? 'months 1, 3, 5…' : 'custom dates'}`)

// ---- How a payment came in, and what has to be kept as proof of it ----

/** cash = handed over at the desk; cheque = cheque or demand draft; online = UPI, bank transfer, card and the like. */
export type PaymentChannel = 'cash' | 'cheque' | 'online'
/** The channel of a payment mode, from its name (the modes are a list the institute keeps in Settings). */
export const paymentChannel = (mode: string): PaymentChannel => (/cash/i.test(mode) ? 'cash' : /cheque|check|draft|\bdd\b/i.test(mode) ? 'cheque' : 'online')

// One document each: the proof of the payment, and (offline) the paper slip.
export const MAX_PROOFS = 1
export const MAX_SLIPS = 1
/** hasRef = the mode has a number of its own (transaction, cheque), asked for but never required. */
export const CHANNEL: Record<PaymentChannel, { label: string; refLabel: string; hasRef: boolean; refNeeded: boolean; proofNeeded: boolean; refHint: string; proofHint: string }> = {
  cash: { label: 'Offline (cash)', refLabel: 'Slip / voucher no.', hasRef: false, refNeeded: false, proofNeeded: false, refHint: 'Optional', proofHint: 'Optional: a photo of the signed cash slip or the manual receipt.' },
  cheque: { label: 'Offline (cheque / draft)', refLabel: 'Cheque / draft no.', hasRef: true, refNeeded: false, proofNeeded: true, refHint: 'Optional: the number printed on the cheque', proofHint: 'A photo of the cheque or draft.' },
  online: { label: 'Online', refLabel: 'Transaction / UTR no.', hasRef: true, refNeeded: false, proofNeeded: true, refHint: 'Optional: UPI reference, UTR or card slip number', proofHint: 'The payment screenshot from the app, the bank message or the card slip.' },
}

/** What is missing for a payment of this mode; '' when it can be saved. `paperSlip` = a paper slip was given at the desk: its picture (`slips`) is then needed, besides the proof of payment that the mode asks for (none for cash). */
export function paymentProblem(mode: string, txnRef: string | null | undefined, proofs: number, paperSlip = false, slips = 0): string {
  const c = CHANNEL[paymentChannel(mode)]
  if (paperSlip && slips < 1) return 'Upload or photograph the paper slip given to the student.'
  if (slips > MAX_SLIPS) return 'Only one picture of the paper slip.'
  if (c.refNeeded && !txnRef?.trim()) return `${c.refLabel.replace(/\.$/, '')} is required for this mode of payment.`
  if (c.proofNeeded && proofs < 1) return paymentChannel(mode) === 'cheque' ? 'Add a photo of the cheque or draft as proof.' : 'Add the proof of the online payment (screenshot or slip).'
  if (proofs > MAX_PROOFS) return 'Only one proof of payment.'
  return ''
}
