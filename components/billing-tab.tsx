'use client'
// Settings → Plan & billing (head office): the plan and where the institute stands (trial, paid until, overdue),
// what it uses against the plan's limits, paying for a plan (monthly or yearly, a code, the credit for an unused
// period, GST shown), stopping renewal, and the invoices.
import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { billingCancelAction, billingCheckoutAction, billingQuoteAction } from '@/app/actions'
import { useNotify } from '@/components/panel-shell'
import type { BillingOverview } from '@/modules/billing/service'

export type BillingTabData = {
  overview: BillingOverview
  usage: { key: string; label: string; used: number; limit: number | null }[]
  plans: { key: string; name: string; monthly: number; yearly: number }[]
  payment: string | null
}
type Q = { amount: number; discount: number; credit: number; gst: number; total: number; startsAt: string; endsAt: string }

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0 })
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—')
const STATUS: Record<string, string> = {
  pending: 'Waiting for approval: your trial starts once approved', trial: 'Free trial', active: 'Active', past_due: 'Payment due: everything still works for a few days', read_only: 'Paused: pay to open it again (nothing is deleted)', suspended: 'Suspended', cancelled: 'Cancelled',
}

export function BillingTab({ d }: { d: BillingTabData }) {
  const notify = useNotify()
  const router = useRouter()
  const o = d.overview
  const [plan, setPlan] = useState(o.sub?.planKey ?? (d.plans.some((p) => p.key === o.plan.key) ? o.plan.key : d.plans[0]?.key ?? ''))
  const [interval, setInterval] = useState<'month' | 'year'>(o.sub?.interval ?? 'month')
  const [coupon, setCoupon] = useState('')
  const [q, setQ] = useState<Q | null>(null)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!plan) return
    const t = setTimeout(async () => { const r = await billingQuoteAction({ plan, interval, coupon: coupon || null }); if (r.ok) { setQ(r.data!); setErr('') } else { setQ(null); setErr(r.error) } }, coupon ? 400 : 0)
    return () => clearTimeout(t)
  }, [plan, interval, coupon])
  useEffect(() => { if (d.payment === 'paid') notify('Payment received: thank you'); if (d.payment === 'failed') notify('The payment did not go through') }, [d.payment, notify])

  return (
    <>
      <div className="panel set-card">
        <div className="set-card-head"><div><h2>{o.plan.name} plan</h2><p>{STATUS[o.status] ?? o.status}{o.status === 'trial' && o.trialEndsAt ? `, until ${day(o.trialEndsAt)}` : ''}{o.sub && o.sub.status === 'active' ? `. Paid ${o.sub.interval === 'month' ? 'monthly' : 'yearly'} until ${day(o.sub.end)}${o.sub.cancelAtPeriodEnd ? ' (will not renew)' : ''}.` : ''}</p></div>
          {o.sub?.status === 'active' && <div className="row-actions"><button type="button" className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await billingCancelAction(!o.sub!.cancelAtPeriodEnd); notify(r.ok ? (o.sub!.cancelAtPeriodEnd ? 'It will renew again' : 'It will stop at the end of the paid period') : r.error); router.refresh() })}>{o.sub.cancelAtPeriodEnd ? 'Keep renewing' : 'Stop renewing'}</button></div>}
        </div>
        <div className="set-rules">
          {d.usage.map((u) => (
            <div key={u.key} className="set-rule">
              <div><strong>{u.label}</strong><small>{u.limit == null ? 'No limit' : `${u.used.toLocaleString('en-IN')} of ${u.limit.toLocaleString('en-IN')}`}</small></div>
              {u.limit != null && <div style={{ width: 160, height: 8, borderRadius: 4, background: '#e6e8f3', overflow: 'hidden' }} aria-hidden="true"><div style={{ width: `${Math.min(100, (u.used / Math.max(u.limit, 1)) * 100)}%`, height: '100%', background: u.used >= u.limit ? '#dc2626' : '#4a4af4' }} /></div>}
            </div>
          ))}
        </div>
      </div>

      <div className="panel set-card">
        <div className="set-card-head"><div><h2>{o.sub?.status === 'active' ? 'Renew or change plan' : 'Choose a plan'}</h2><p>Paying for the same plan carries on from the end of the paid period; another plan starts now, with what is left of the current period taken off. Prices plus 18% GST.</p></div></div>
        <div className="wl-form">
          <label>Plan<select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">{d.plans.map((p) => <option key={p.key} value={p.key}>{p.name} ({inr(p.monthly)}/month)</option>)}</select></label>
          <label>Pay<select value={interval} onChange={(e) => setInterval(e.target.value as 'month' | 'year')} aria-label="Pay"><option value="month">Monthly</option><option value="year">Yearly (2 months free)</option></select></label>
          <label>Code<input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="If you have one" aria-label="Code" /></label>
        </div>
        {err && <p className="login-error" style={{ margin: '10px 0 0' }}>{err}</p>}
        {q && (
          <div className="set-rules" style={{ marginTop: 12 }}>
            <div className="set-rule"><div><strong>Plan</strong></div><div>{inr(q.amount)}</div></div>
            {q.discount > 0 && <div className="set-rule"><div><strong>Less</strong><small>{q.credit > 0 ? `${inr(q.credit)} unused from your current period` : ''}{q.credit > 0 && q.discount > q.credit ? ' and the code' : q.credit ? '' : 'The code'}</small></div><div>− {inr(q.discount)}</div></div>}
            <div className="set-rule"><div><strong>GST 18%</strong></div><div>{inr(q.gst)}</div></div>
            <div className="set-rule"><div><strong>To pay</strong><small>For {day(q.startsAt)} to {day(q.endsAt)}</small></div><div><strong>{inr(q.total)}</strong></div></div>
          </div>
        )}
        <div className="modal-actions"><button type="button" className="button primary" disabled={pending || !q} onClick={() => start(async () => { const r = await billingCheckoutAction({ plan, interval, coupon: coupon || null }); if (r.ok && r.data) window.location.assign(r.data); else notify(r.ok ? 'Failed' : r.error) })}>{pending ? 'Opening the payment page…' : q ? `Pay ${inr(q.total)}` : 'Pay'}</button></div>
      </div>

      <div className="panel set-card">
        <div className="set-card-head"><div><h2>Invoices</h2><p>A GST tax invoice for every payment.</p></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Number</th><th>Date</th><th>For</th><th>Total</th><th /></tr></thead>
          <tbody>
            {o.invoices.map((i) => <tr key={i.id}><td><strong>{i.number}</strong></td><td>{day(i.issuedAt)}</td><td>{i.description}</td><td>{inr(i.total)}</td><td><Link className="filter-button" href={`/billing/invoices/${i.id}`} target="_blank">Open</Link></td></tr>)}
            {!o.invoices.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No invoices yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>
  )
}
