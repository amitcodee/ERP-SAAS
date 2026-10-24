'use client'
// Franchises (app/(panel)/franchises): each franchise centre with its partner, terms and the month's royalty, the
// balance owed, the partners' payments, and the forms to set terms and record a payment. FranchiseModal is also
// opened from Branches ("Make a franchise").
import { Fragment, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Handshake, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { deleteRoyaltyAction, invitePartnerAction, recordRoyaltyAction, setFranchiseAction, setFranchiseFeeAction } from '@/app/actions'
import type { FranchiseFeeRow } from '@/modules/franchise/fees'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { Franchise, RoyaltyPaymentRow } from '@/modules/franchise/service'

const inr = (paise: number) => `${paise < 0 ? '−' : ''}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
export const termsText = (f: Pick<Franchise, 'royaltyKind' | 'royaltyValue'>) =>
  !f.royaltyKind || f.royaltyValue == null ? 'No royalty set' : f.royaltyKind === 'percent' ? `${(f.royaltyValue / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}% of fees received` : `${inr(f.royaltyValue)} a month`

type Props = {
  month: string; thisMonth: string; today: string; franchises: Franchise[]; payments: RoyaltyPaymentRow[]; modes: string[]
  canEdit: boolean; canRecord: boolean; canDelete: boolean; ownBranches: { id: string; name: string }[]
  fees: FranchiseFeeRow[]
}

export function FranchisesPanel(p: Props) {
  const router = useRouter()
  const notify = useNotify()
  const [edit, setEdit] = useState<Franchise | 'new' | null>(null)
  const [paying, setPaying] = useState<Franchise | null>(null)
  const [open, setOpen] = useState<string | null>(p.franchises.length === 1 ? p.franchises[0].branchId : null)
  const [pending, start] = useTransition()
  const go = (month: string) => { const u = new URL(window.location.href); u.searchParams.set('month', month); router.push(`${u.pathname}${u.search}`) }
  const remove = (r: RoyaltyPaymentRow) => {
    if (!window.confirm(`Delete the ${inr(r.amount)} payment from ${r.branch}? It stays on record, out of the statement.`)) return
    start(async () => { const res = await deleteRoyaltyAction(r.id); notify(res.ok ? 'Payment deleted' : res.error); if (res.ok) router.refresh() })
  }
  const total = (k: 'income' | 'royalty' | 'paid') => p.franchises.reduce((n, f) => n + f.month[k], 0)
  const due = p.franchises.reduce((n, f) => n + Math.max(0, f.balance), 0)
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Fees &amp; money / Franchises</p><h1>Franchises</h1><p className="subheading">Centres run by franchise partners: what they received in fees, the royalty on it, and what they have paid. Their receipts carry the partner’s legal name.</p></div>
        <div className="row-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input type="month" value={p.month} max={p.thisMonth} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Month" />
          {p.canEdit && <button type="button" className="button primary" onClick={() => setEdit('new')} disabled={!p.ownBranches.length} title={p.ownBranches.length ? undefined : 'Every branch is a franchise already'}><Plus size={15} /> Make a franchise</button>}
        </div>
      </div>

      {p.franchises.length > 1 && (
        <div className="table-summary">
          <div><strong className="text-blue">{inr(total('income'))}</strong><span>Fees received · {monthName(p.month)}</span></div>
          <div><strong className="text-amber">{inr(total('royalty'))}</strong><span>Royalty for the month</span></div>
          <div><strong className="text-green">{inr(total('paid'))}</strong><span>Paid in the month</span></div>
          <div><strong style={{ color: due > 0 ? '#b45309' : undefined }}>{inr(due)}</strong><span>Owed to date</span></div>
        </div>
      )}

      {!p.franchises.length ? (
        <div className="panel" style={{ padding: 28, textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center' }}>
          <Handshake size={28} />
          <strong>No franchises yet</strong>
          <p className="section-hint" style={{ margin: 0, maxWidth: 520 }}>Make a branch a franchise: give its partner’s legal name (printed on its receipts) and the royalty, a percent of the fees it receives or a fixed amount a month. Its branch login is the partner’s.</p>
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead><tr><th>Centre &amp; partner</th><th>Terms</th><th style={{ textAlign: 'right' }}>Fees received</th><th style={{ textAlign: 'right' }}>Royalty</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Owed to date</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {p.franchises.map((f) => (<Fragment key={f.branchId}>
                <tr>
                  <td><strong>{f.branch}</strong><small style={{ display: 'block' }}>{f.partnerName}{f.partnerOwner ? ` · ${f.partnerOwner}` : ''}{f.partnerPhone ? ` · ${f.partnerPhone}` : ''}</small></td>
                  <td>{termsText(f)}<small style={{ display: 'block' }}>{f.agreementFrom ? `from ${day(f.agreementFrom)}` : 'no start date'}{f.agreementTo ? ` to ${day(f.agreementTo)}` : ''}</small><small style={{ display: 'block' }}>{f.hqCertificates ? 'Certificates: head office issues' : 'Certificates: the centre issues'}</small></td>
                  <td style={{ textAlign: 'right' }}>{inr(f.month.income)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(f.month.royalty)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(f.month.paid)}</td>
                  <td style={{ textAlign: 'right' }}><strong style={{ color: f.balance > 0 ? '#b45309' : '#047857' }}>{f.balance > 0 ? inr(f.balance) : f.balance < 0 ? `${inr(-f.balance)} ahead` : 'Nothing'}</strong></td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="filter-button" onClick={() => setOpen(open === f.branchId ? null : f.branchId)}>{open === f.branchId ? 'Hide' : 'Statement'}</button>
                      {p.canRecord && <button type="button" className="filter-button" onClick={() => setPaying(f)}><Plus size={14} /> Payment</button>}
                      {p.canEdit && <button type="button" className="filter-button icon-only" title={f.partnerEmail ? `Invite the partner: their login, e-mailed to ${f.partnerEmail}` : 'Add the partner’s e-mail to the terms to invite them'} aria-label={`Invite the partner of ${f.branch}`} disabled={pending || !f.partnerEmail} onClick={() => start(async () => { const r = await invitePartnerAction(f.branchId); notify(r.ok ? r.data!.message : r.error) })}><Send size={14} /></button>}
                      {p.canEdit && <button type="button" className="filter-button icon-only" title="Edit the terms" aria-label={`Edit ${f.branch}`} onClick={() => setEdit(f)}><Pencil size={14} /></button>}
                    </div>
                  </td>
                </tr>
                {open === f.branchId && (
                  <tr><td colSpan={7} style={{ background: 'var(--tint-2)' }}>
                    <table style={{ width: '100%' }}>
                      <thead><tr><th>Month</th><th style={{ textAlign: 'right' }}>Fees received</th><th style={{ textAlign: 'right' }}>Royalty</th><th style={{ textAlign: 'right' }}>Paid</th></tr></thead>
                      <tbody>{f.months.slice(0, 12).map((m) => <tr key={m.month}><td>{monthName(m.month)}</td><td style={{ textAlign: 'right' }}>{inr(m.income)}</td><td style={{ textAlign: 'right' }}>{inr(m.royalty)}</td><td style={{ textAlign: 'right' }}>{inr(m.paid)}</td></tr>)}</tbody>
                    </table>
                    {f.months.length > 12 && <small className="section-hint">The last 12 of {f.months.length} months; the balance counts them all.</small>}
                  </td></tr>
                )}
              </Fragment>))}
            </tbody>
          </table>
        </div>
      )}

      {!!p.payments.length && (
        <div className="panel table-scroll" style={{ marginTop: 16 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Royalty payments</h2>
          <table>
            <thead><tr><th>Date</th><th>Centre</th><th style={{ textAlign: 'right' }}>Amount</th><th>How</th><th>Note</th><th>Recorded by</th>{p.canDelete && <th />}</tr></thead>
            <tbody>{p.payments.map((r) => (
              <tr key={r.id}>
                <td>{day(r.paidOn)}</td><td>{r.branch}</td><td style={{ textAlign: 'right' }}>{inr(r.amount)}</td><td>{r.mode ?? '—'}{r.ref ? ` · ${r.ref}` : ''}</td><td>{r.note ?? ''}</td><td>{r.by}</td>
                {p.canDelete && <td><button type="button" className="filter-button icon-only" title="Delete (recorded by mistake)" aria-label="Delete payment" disabled={pending} onClick={() => remove(r)}><Trash2 size={14} /></button></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {p.canEdit && !!p.fees.length && <CourseFees fees={p.fees} />}

      {edit && <FranchiseModal f={edit === 'new' ? null : edit} branches={p.ownBranches} onClose={() => setEdit(null)} onDone={(m) => { setEdit(null); notify(m); router.refresh() }} />}
      {paying && <PaymentModal f={paying} today={p.today} modes={p.modes} onClose={() => setPaying(null)} onDone={(m) => { setPaying(null); notify(m); router.refresh() }} />}
    </section>
  )
}

/** Make a branch a franchise, or change (or end) its terms. */
export function FranchiseModal({ f, branches, onClose, onDone }: { f: Franchise | null; branches: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({
    branchId: f?.branchId ?? branches[0]?.id ?? '', partnerName: f?.partnerName ?? '', partnerOwner: f?.partnerOwner ?? '', partnerPhone: f?.partnerPhone ?? '', partnerEmail: f?.partnerEmail ?? '',
    agreementFrom: f?.agreementFrom ?? '', agreementTo: f?.agreementTo ?? '', royaltyKind: (f?.royaltyKind ?? 'percent') as 'percent' | 'fixed' | 'none',
    amount: f?.royaltyValue != null ? String(f.royaltyValue / 100) : '', hqCertificates: f?.hqCertificates ?? true,
  })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  const save = (kind: 'own' | 'franchise') => start(async () => {
    const n = Number(v.amount)
    if (kind === 'franchise' && v.royaltyKind !== 'none' && (!v.amount || !Number.isFinite(n) || n < 0)) return setError(v.royaltyKind === 'percent' ? 'Give the royalty percent' : 'Give the monthly royalty')
    const r = await setFranchiseAction({
      branchId: v.branchId, kind, partnerName: v.partnerName, partnerOwner: v.partnerOwner, partnerPhone: v.partnerPhone, partnerEmail: v.partnerEmail,
      agreementFrom: v.agreementFrom || null, agreementTo: v.agreementTo || null,
      royaltyKind: v.royaltyKind === 'none' ? null : v.royaltyKind, royaltyValue: v.royaltyKind === 'none' ? null : Math.round(n * 100),
      hqCertificates: v.hqCertificates,
    })
    if (!r.ok) return setError(r.error)
    onDone(kind === 'own' ? 'It is your own centre again' : f ? 'Franchise terms saved' : 'It is a franchise now')
  })
  return (
    <Modal title={f ? `Franchise — ${f.branch}` : 'Make a branch a franchise'} onClose={onClose}>
      <div className="wl-form">
        {!f && <label className="wide">Branch<select value={v.branchId} onChange={set('branchId')}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        <label className="wide">Partner’s legal name <small>(printed on the centre’s receipts)</small><input value={v.partnerName} onChange={set('partnerName')} maxLength={160} placeholder="e.g. Bright Skills Education LLP" /></label>
        <label>Owner<input value={v.partnerOwner} onChange={set('partnerOwner')} maxLength={120} /></label>
        <label>Phone<input value={v.partnerPhone} onChange={set('partnerPhone')} maxLength={30} inputMode="tel" /></label>
        <label className="wide">E-mail<input type="email" value={v.partnerEmail} onChange={set('partnerEmail')} maxLength={160} /></label>
        <label>Agreement from<input type="date" value={v.agreementFrom} onChange={set('agreementFrom')} /></label>
        <label>Agreement to <small>(optional)</small><input type="date" value={v.agreementTo} onChange={set('agreementTo')} /></label>
        <label>Royalty<select value={v.royaltyKind} onChange={set('royaltyKind')}><option value="percent">A percent of fees received</option><option value="fixed">A fixed amount a month</option><option value="none">None</option></select></label>
        {v.royaltyKind !== 'none' && <label>{v.royaltyKind === 'percent' ? 'Percent' : 'Amount a month (₹)'}<input type="number" min={0} max={v.royaltyKind === 'percent' ? 100 : undefined} step={v.royaltyKind === 'percent' ? 0.01 : 1} value={v.amount} onChange={set('amount')} /></label>}
        <label className={`wide set-check${v.hqCertificates ? ' on' : ''}`}><input type="checkbox" checked={v.hqCertificates} onChange={(e) => setV({ ...v, hqCertificates: e.target.checked })} /><span><b>Head office issues its certificates</b><small>The centre requests them; untick to let it issue its own.</small></span></label>
      </div>
      <p className="section-hint" style={{ margin: '8px 0 0' }}>The royalty counts from the agreement’s start (or the branch’s, without one), month by month. The branch’s own login is the partner’s: they see only this centre.</p>
      <Err msg={error} />
      <div className="modal-actions">
        {f && <button type="button" className="button secondary" disabled={pending} onClick={() => { if (window.confirm(`Make ${f.branch} your own centre again? Its terms are cleared; payments stay on record.`)) save('own') }}>Not a franchise any more</button>}
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" disabled={pending || !v.branchId || v.partnerName.trim().length < 2} onClick={() => save('franchise')}>{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  )
}

function PaymentModal({ f, today, modes, onClose, onDone }: { f: Franchise; today: string; modes: string[]; onClose: () => void; onDone: (m: string) => void }) {
  const [v, setV] = useState({ paidOn: today, amount: f.balance > 0 ? String(f.balance / 100) : '', mode: modes[0] ?? '', ref: '', note: '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value })
  const save = () => start(async () => {
    const n = Math.round(Number(v.amount) * 100)
    if (!n || n <= 0) return setError('Enter the amount')
    const r = await recordRoyaltyAction({ branchId: f.branchId, paidOn: v.paidOn, amount: n, mode: v.mode, ref: v.ref, note: v.note })
    if (!r.ok) return setError(r.error)
    onDone(`Payment of ₹${(n / 100).toLocaleString('en-IN')} recorded`)
  })
  return (
    <Modal title={`Royalty payment — ${f.branch}`} onClose={onClose}>
      <p className="section-hint" style={{ marginTop: 0 }}>Owed to date: <strong>{inr(Math.max(0, f.balance))}</strong></p>
      <div className="wl-form">
        <label>Date<input type="date" value={v.paidOn} max={today} onChange={set('paidOn')} /></label>
        <label>Amount (₹)<input type="number" min={1} step="0.01" value={v.amount} onChange={set('amount')} /></label>
        <label>How<select value={v.mode} onChange={set('mode')}>{modes.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label>Reference <small>(optional)</small><input value={v.ref} onChange={set('ref')} maxLength={80} placeholder="UTR / cheque no." /></label>
        <label className="wide">Note <small>(optional)</small><input value={v.note} onChange={set('note')} maxLength={300} /></label>
      </div>
      <Err msg={error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Record payment'}</button></div>
    </Modal>
  )
}

const toRupees = (p: number | null) => (p == null ? '' : String(p / 100))
const toPaise = (s: string) => (s.trim() === '' ? null : Math.round(Number(s) * 100))

/** Head office: the lowest and highest total fee a franchise may charge for each course (empty: no bound). */
function CourseFees({ fees }: { fees: FranchiseFeeRow[] }) {
  const router = useRouter()
  const notify = useNotify()
  const key = (f: FranchiseFeeRow) => f.courseId ?? `d:${f.departmentId}`
  const [v, setV] = useState<Record<string, { min: string; max: string }>>(() => Object.fromEntries(fees.map((f) => [key(f), { min: toRupees(f.min), max: toRupees(f.max) }])))
  const [pending, start] = useTransition()
  const changed = (f: FranchiseFeeRow) => toPaise(v[key(f)].min) !== f.min || toPaise(v[key(f)].max) !== f.max
  const save = (f: FranchiseFeeRow) => start(async () => {
    const min = toPaise(v[key(f)].min), max = toPaise(v[key(f)].max)
    if ((min != null && (!Number.isFinite(min) || min < 0)) || (max != null && (!Number.isFinite(max) || max < 0))) return notify('Enter amounts in rupees, or leave empty')
    const r = await setFranchiseFeeAction(f.courseId ? { courseId: f.courseId } : { departmentId: f.departmentId }, min, max)
    notify(r.ok ? `${f.courseId ? f.title : `Customised courses in ${f.department}`}: saved` : r.error); if (r.ok) router.refresh()
  })
  const set = (id: string, k: 'min' | 'max', val: string) => setV({ ...v, [id]: { ...v[id], [k]: val } })
  return (
    <div className="panel table-scroll" style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Course fees at franchises</h2>
      <p className="section-hint" style={{ margin: '0 0 10px' }}>The total fee (after discounts, with GST) a franchise may charge for each course. Checked when it registers a student, changes a fee or gives a discount; a customised course (its own title) follows its department’s line. Empty: no limit. Your own centres are not bound by it.</p>
      <table>
        <thead><tr><th>Course</th><th style={{ textAlign: 'right' }}>Usual fee</th><th>Lowest (₹)</th><th>Highest (₹)</th><th /></tr></thead>
        <tbody>{fees.map((f) => { const k = key(f), what = f.courseId ? f.title : `customised courses in ${f.department}`; return (
          <tr key={k}>
            <td>{f.courseId ? <strong>{f.title}</strong> : <em>Customised course</em>}<small style={{ display: 'block' }}>{f.department}</small></td>
            <td style={{ textAlign: 'right' }}>{f.baseFee != null ? inr(f.baseFee) : '—'}</td>
            <td><input type="number" min={0} step="1" value={v[k].min} onChange={(e) => set(k, 'min', e.target.value)} aria-label={`Lowest fee for ${what}`} style={{ width: 120 }} /></td>
            <td><input type="number" min={0} step="1" value={v[k].max} onChange={(e) => set(k, 'max', e.target.value)} aria-label={`Highest fee for ${what}`} style={{ width: 120 }} /></td>
            <td><button type="button" className="filter-button" disabled={pending || !changed(f)} onClick={() => save(f)}>Save</button></td>
          </tr>
        ) })}</tbody>
      </table>
    </div>
  )
}
