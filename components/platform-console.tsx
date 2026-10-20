'use client'
// The platform console's editors: plans, codes, notices, and one institute's plan / trial / feature flags.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createAnnouncementAction, createCouponAction, endAnnouncementAction, extendTrialAction, savePlanAction, setCouponActiveAction, setFeatureAction, setOrgPlanAction } from '@/app/platform/actions'

const LIMITS = [['branches', 'Branches'], ['staff', 'Staff logins'], ['activeStudents', 'Active students'], ['storageMb', 'Files (MB)'], ['messagesPerMonth', 'Messages / month']] as const
type Limits = Record<(typeof LIMITS)[number][0], number | null>
export type PlanRow = { key: string; name: string; description: string | null; price_monthly: number; price_yearly: number; limits: Record<string, number | null>; modules: string[]; is_public: boolean; is_active: boolean; sort: number; orgs: number }

function useAct() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { const r = await fn(); setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? 'Failed' }); if (r.ok) router.refresh() })
  const note = msg && <p role="status" className={msg.ok ? 'section-hint' : 'login-error'} style={{ margin: 0 }}>{msg.text}</p>
  return { pending, act, note }
}
const rupees = (p: number) => String(p / 100)
const paise = (r: string) => Math.round(Number(r || 0) * 100)

export function PlanEditor({ plan, modules }: { plan: PlanRow | null; modules: Record<string, string> }) {
  const { pending, act, note } = useAct()
  const [v, setV] = useState({
    key: plan?.key ?? '', name: plan?.name ?? '', description: plan?.description ?? '', monthly: rupees(plan?.price_monthly ?? 0), yearly: rupees(plan?.price_yearly ?? 0),
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, plan?.limits?.[k] == null ? '' : String(plan.limits[k])])) as Record<string, string>,
    modules: plan?.modules ?? [], isPublic: plan?.is_public ?? true, isActive: plan?.is_active ?? true, sort: plan?.sort ?? 10,
  })
  const save = () => act(() => savePlanAction({
    key: v.key, name: v.name, description: v.description, priceMonthly: paise(v.monthly), priceYearly: paise(v.yearly), sort: v.sort, isPublic: v.isPublic, isActive: v.isActive, modules: v.modules,
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, v.limits[k] === '' ? null : Number(v.limits[k])])) as Limits,
  }), 'Saved')
  return (
    <form className="panel wl-form" onSubmit={(e) => { e.preventDefault(); save() }} style={{ marginBottom: 12 }}>
      <label>Key<input value={v.key} disabled={!!plan} onChange={(e) => setV({ ...v, key: e.target.value })} required aria-label="Key" /></label>
      <label>Name<input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required aria-label="Name" /></label>
      <label className="wide">Description<input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></label>
      <label>₹ / month (before GST)<input type="number" min={0} value={v.monthly} onChange={(e) => setV({ ...v, monthly: e.target.value })} /></label>
      <label>₹ / year<input type="number" min={0} value={v.yearly} onChange={(e) => setV({ ...v, yearly: e.target.value })} /></label>
      {LIMITS.map(([k, label]) => <label key={k}>{label} (blank: no limit)<input type="number" min={0} value={v.limits[k]} onChange={(e) => setV({ ...v, limits: { ...v.limits, [k]: e.target.value } })} /></label>)}
      <div className="wide" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(modules).map(([m, label]) => <label key={m} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={v.modules.includes(m)} onChange={() => setV({ ...v, modules: v.modules.includes(m) ? v.modules.filter((x) => x !== m) : [...v.modules, m] })} />{label}</label>)}
      </div>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />On the pricing page</label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />On offer</label>
      <label>Order<input type="number" min={0} max={100} value={v.sort} onChange={(e) => setV({ ...v, sort: Number(e.target.value) })} /></label>
      <div className="wide" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="button primary" disabled={pending}>{plan ? `Save ${plan.name}` : 'Add plan'}</button>{plan && <small>{plan.orgs} institute(s) on it</small>}{note}</div>
    </form>
  )
}

export function CouponForm({ plans }: { plans: string[] }) {
  const { pending, act, note } = useAct()
  const [v, setV] = useState({ code: '', kind: 'percent', value: '', plans: [] as string[], until: '', max: '' })
  return (
    <form className="panel wl-form" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); act(() => createCouponAction({
      code: v.code, percentOff: v.kind === 'percent' ? Number(v.value) : null, amountOff: v.kind === 'amount' ? paise(v.value) : null, plans: v.plans,
      validUntil: v.until ? new Date(`${v.until}T23:59:59+05:30`).toISOString() : null, maxRedemptions: v.max ? Number(v.max) : null,
    }), 'Code added') }}>
      <label>Code<input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} required aria-label="Code" /></label>
      <label>Off<select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="percent">%</option><option value="amount">₹</option></select></label>
      <label>How much<input type="number" min={1} value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} required aria-label="How much" /></label>
      <label>Good until<input type="date" value={v.until} onChange={(e) => setV({ ...v, until: e.target.value })} /></label>
      <label>Uses (blank: any)<input type="number" min={1} value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} /></label>
      <div className="wide" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>Plans (none ticked: all):{plans.map((p) => <label key={p} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={v.plans.includes(p)} onChange={() => setV({ ...v, plans: v.plans.includes(p) ? v.plans.filter((x) => x !== p) : [...v.plans, p] })} />{p}</label>)}</div>
      <div className="wide" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="button primary" disabled={pending}>Add code</button>{note}</div>
    </form>
  )
}

export function CouponToggle({ code, active }: { code: string; active: boolean }) {
  const { pending, act } = useAct()
  return <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => setCouponActiveAction(code, !active), active ? 'Switched off' : 'Switched on')}>{active ? 'Switch off' : 'Switch on'}</button>
}

export function NoticeForm({ plans }: { plans: string[] }) {
  const { pending, act, note } = useAct()
  const [v, setV] = useState({ title: '', body: '', tone: 'info' as 'info' | 'warning', plans: [] as string[], until: '' })
  return (
    <form className="panel wl-form" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); act(() => createAnnouncementAction({ ...v, endsAt: v.until ? new Date(`${v.until}T23:59:59+05:30`).toISOString() : null }), 'Notice is live') }}>
      <label className="wide">Title<input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required aria-label="Title" /></label>
      <label className="wide">Message<textarea rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} required aria-label="Message" /></label>
      <label>Kind<select value={v.tone} onChange={(e) => setV({ ...v, tone: e.target.value as 'info' | 'warning' })}><option value="info">Information</option><option value="warning">Warning</option></select></label>
      <label>Shown until (blank: until ended)<input type="date" value={v.until} onChange={(e) => setV({ ...v, until: e.target.value })} /></label>
      <div className="wide" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>For plans (none ticked: everyone):{plans.map((p) => <label key={p} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" checked={v.plans.includes(p)} onChange={() => setV({ ...v, plans: v.plans.includes(p) ? v.plans.filter((x) => x !== p) : [...v.plans, p] })} />{p}</label>)}</div>
      <div className="wide" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button className="button primary" disabled={pending}>Show it</button>{note}</div>
    </form>
  )
}

export function EndNotice({ id }: { id: string }) {
  const { pending, act } = useAct()
  return <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => endAnnouncementAction(id), 'Ended')}>End now</button>
}

/** One institute: its plan, its trial, its feature flags. */
export function OrgCommercial({ org, plans, features }: { org: { id: string; status: string; plan: string }; plans: string[]; features: Record<string, boolean> }) {
  const { pending, act, note } = useAct()
  const [plan, setPlan] = useState(org.plan)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [flag, setFlag] = useState('')
  return (
    <div className="panel" style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Plan, trial and features</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Plan reason" style={{ flex: '1 1 220px' }} />
        <select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plan">{plans.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <button type="button" className="button secondary" disabled={pending || plan === org.plan || reason.trim().length < 3} onClick={() => act(() => setOrgPlanAction(org.id, plan, reason), 'Plan changed')}>Change plan</button>
        {['trial', 'read_only'].includes(org.status) && <>
          <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days" style={{ width: 80 }} />
          <button type="button" className="button secondary" disabled={pending || reason.trim().length < 3} onClick={() => act(() => extendTrialAction(org.id, days, reason), 'Trial extended')}>Extend trial</button>
        </>}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(features).map(([f, on]) => <button key={f} type="button" className="filter-button" disabled={pending} onClick={() => act(() => setFeatureAction(org.id, f, !on), `${f} ${on ? 'off' : 'on'}`)}>{f}: {on ? 'on' : 'off'}</button>)}
        <input value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="new_flag" aria-label="Flag" style={{ width: 160 }} />
        <button type="button" className="filter-button" disabled={pending || !flag} onClick={() => act(() => setFeatureAction(org.id, flag, true), `${flag} on`)}>Switch on</button>
      </div>
      {note}
    </div>
  )
}
