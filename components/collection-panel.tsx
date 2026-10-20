'use client'
// Fee collection: totals, a chart of the money received per day or month, where it came from (mode, course,
// branch) and the list of payments. The period and filters are kept in the address.
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { DateInput } from '@/components/date-input'
import { paymentChannel } from '@/modules/fees/plan'
import type { CollectionReport } from '@/modules/fees/collection'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
/** ₹1.2L / ₹45K: short amounts for axis ticks. */
const short = (paise: number) => { const r = paise / 100; return r >= 1e7 ? `₹${+(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${+(r / 1e5).toFixed(1)}L` : r >= 1000 ? `₹${+(r / 1000).toFixed(1)}K` : `₹${r}` }
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const fmtDay = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const fmtLong = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtMonth = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const fmtTime = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** The periods offered as one-tap choices. */
function presets(today: string): [string, string, string][] {
  const t = new Date(`${today}T00:00:00`)
  const add = (n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return iso(d) }
  const monthStart = iso(new Date(t.getFullYear(), t.getMonth(), 1))
  const weekStart = add(-((t.getDay() + 6) % 7)) // Monday
  return [
    ['Today', today, today], ['Yesterday', add(-1), add(-1)], ['This week', weekStart, today], ['This month', monthStart, today],
    ['Last month', iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))],
    ['Last 3 months', iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), today], ['This year', iso(new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1)), today],
  ]
}

export function CollectionPanel({ report: r, today, branchId, modeId, paymentModes, branches }: {
  report: CollectionReport; today: string; branchId: string; modeId: string
  paymentModes: { id: string; value: string }[]
  /** Head office only: the branches to narrow to. Empty for branch staff. */
  branches: { id: string; name: string }[]
}) {
  const router = useRouter()
  const path = usePathname()
  const go = (patch: Partial<{ from: string; to: string; branch: string; mode: string }>) => {
    const q = { from: r.from, to: r.to, branch: branchId, mode: modeId, ...patch }
    const sp = new URLSearchParams(Object.entries(q).filter(([, v]) => v))
    router.push(`${path}?${sp}`)
  }
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const ps = presets(today)
  const active = ps.find(([, f, t]) => f === r.from && t === r.to)?.[0]
  const online = r.byMode.filter((m) => paymentChannel(m.name) === 'online').reduce((n, m) => n + m.total, 0)
  const single = r.from === r.to
  const title = single ? (r.from === today ? 'Today' : fmtLong(r.from)) : `${fmtLong(r.from)} to ${fmtLong(r.to)}`

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports / Collections</p>
          <h1>Fee collection</h1>
          <p className="subheading">{title}{branches.length ? ` · ${branches.find((b) => b.id === branchId)?.name ?? 'All branches'}` : ''}{modeId ? ` · ${paymentModes.find((m) => m.id === modeId)?.value ?? ''}` : ''}</p>
        </div>
      </div>

      {/* one row of filters above everything they change */}
      <div className="panel col-filters">
        <div className="col-presets" role="group" aria-label="Period">
          {ps.map(([label, f, t]) => <button key={label} type="button" className={active === label ? 'on' : ''} onClick={() => go({ from: f, to: t })}>{label}</button>)}
        </div>
        <div className="col-controls">
          <label>From<DateInput type="date" value={r.from} max={today} onChange={(e) => e.target.value && go({ from: e.target.value, to: e.target.value > r.to ? e.target.value : r.to })} /></label>
          <label>To<DateInput type="date" value={r.to} min={r.from} max={today} onChange={(e) => e.target.value && go({ to: e.target.value })} /></label>
          {branches.length > 0 && <label>Branch<select value={branchId} onChange={(e) => go({ branch: e.target.value })}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label>Mode of payment<select value={modeId} onChange={(e) => go({ mode: e.target.value })}><option value="">All modes</option>{paymentModes.map((m) => <option key={m.id} value={m.id}>{m.value}</option>)}</select></label>
        </div>
      </div>

      <div className="table-summary">
        <div><strong>{inr(r.total)}</strong><span>Collected</span></div>
        <div><strong>{r.count.toLocaleString('en-IN')}</strong><span>Payments from {r.students.toLocaleString('en-IN')} student{r.students === 1 ? '' : 's'}</span></div>
        <div><strong>{inr(online)}</strong><span>Online ({r.total ? Math.round(online * 100 / r.total) : 0}%)</span></div>
        <div><strong>{inr(r.total - online)}</strong><span>Offline: cash and cheques ({r.total ? 100 - Math.round(online * 100 / r.total) : 0}%)</span></div>
      </div>

      {!single && (
        <div className="panel">
          <div className="panel-header">
            <div><h2>Collection per {r.by}</h2><span>{r.by === 'day' ? 'Each bar is one day.' : 'Each bar is one month.'} Point at a bar for the figure.</span></div>
            <div className="reg-seg" role="group" aria-label="Show as"><button type="button" className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Chart</button><button type="button" className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button></div>
          </div>
          {view === 'chart' ? <TimeBars series={r.series} by={r.by} /> : (
            <div className="table-scroll" style={{ maxHeight: 340 }}><table style={{ minWidth: 0 }}>
              <thead><tr><th>{r.by === 'day' ? 'Day' : 'Month'}</th><th style={{ textAlign: 'right' }}>Payments</th><th style={{ textAlign: 'right' }}>Collected</th></tr></thead>
              <tbody>{r.series.map((s) => <tr key={s.key}><td>{r.by === 'day' ? fmtLong(s.key) : fmtMonth(s.key)}</td><td style={{ textAlign: 'right' }}>{s.count}</td><td style={{ textAlign: 'right' }}>{inr(s.total)}</td></tr>)}</tbody>
            </table></div>
          )}
        </div>
      )}

      <div className={`col-grid${branches.length && !branchId ? ' three' : ''}`}>
        <div className="panel"><div className="panel-header"><div><h2>By mode of payment</h2><span>How the money came in.</span></div></div><RankBars items={r.byMode} total={r.total} /></div>
        <div className="panel"><div className="panel-header"><div><h2>By course</h2><span>The courses the fees were for.</span></div></div><RankBars items={r.byCourse} total={r.total} /></div>
        {branches.length > 0 && !branchId && <div className="panel"><div className="panel-header"><div><h2>By branch</h2><span>Each branch&apos;s share.</span></div></div><RankBars items={r.byBranch} total={r.total} /></div>}
      </div>

      <div className="panel table-panel">
        <div className="panel-header"><div><h2>Payments</h2><span>{r.count > r.rows.length ? `The latest ${r.rows.length} of ${r.count.toLocaleString('en-IN')}. Narrow the period to see the rest.` : `${r.count.toLocaleString('en-IN')} payment${r.count === 1 ? '' : 's'}, newest first.`}</span></div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Received</th><th>Receipt</th><th>Student</th><th>Course</th>{branches.length > 0 && <th>Branch</th>}<th>Mode</th><th>Received by</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.receiptNo}>
                  <td>{fmtTime(x.paidAt)}</td>
                  <td><strong className="id-text">{x.receiptNo}</strong><small>{x.paperSlip ? 'Paper slip' : paymentChannel(x.mode) === 'online' ? 'E-receipt' : 'Receipt'}</small></td>
                  <td><div><strong>{x.student}</strong><span style={{ display: 'block' }}>{x.phone} · {x.regNo}</span></div></td>
                  <td>{x.course}{x.department && x.department !== x.course && <small>{x.department}</small>}</td>
                  {branches.length > 0 && <td>{x.branch}</td>}
                  <td>{x.mode}{x.txnRef && <small>{x.txnRef}</small>}</td>
                  <td>{x.receivedBy ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><strong>{inr(x.amount)}</strong></td>
                  <td><div className="row-actions"><a className="filter-button" href={`/receipts/${encodeURIComponent(x.receiptNo)}`} target="_blank" rel="noreferrer">{x.paperSlip ? 'Slip' : 'Receipt'}</a><a className="filter-button" href={`/fees/${x.registrationId}`}>Fees</a></div></td>
                </tr>
              ))}
              {!r.rows.length && <tr><td colSpan={branches.length ? 9 : 8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>Nothing was collected in this period.</td></tr>}
            </tbody>
            {r.rows.length > 0 && <tfoot><tr><td colSpan={branches.length ? 7 : 6} style={{ textAlign: 'right', fontWeight: 700 }}>Total collected</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(r.total)}</td><td /></tr></tfoot>}
          </table>
        </div>
      </div>
    </section>
  )
}

/** Money per day or month: one series, so one colour and no legend; the tooltip gives the exact figure. */
function TimeBars({ series, by }: { series: CollectionReport['series']; by: 'day' | 'month' }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...series.map((s) => s.total), 1)
  // a round top for the scale: 1, 2 or 5 times a power of ten
  const pow = 10 ** Math.floor(Math.log10(max)), top = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= max)!
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const W = 960, H = 260, L = 56, B = 28, T = 10, plotW = W - L - 8, plotH = H - T - B
  const slot = plotW / series.length, bw = Math.max(2, Math.min(34, slot - 2))
  const labelEvery = Math.ceil(series.length / 12)
  const name = (k: string) => (by === 'day' ? fmtDay(k) : fmtMonth(k))
  const h = hover != null ? series[hover] : null
  return (
    <div className="col-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Collection per ${by}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => { const y = T + plotH - (v / top) * plotH; return <g key={v}><line x1={L} x2={W - 8} y1={y} y2={y} className="grid" /><text x={L - 8} y={y + 4} textAnchor="end" className="tick">{short(v)}</text></g> })}
        {series.map((s, i) => {
          const x = L + i * slot + (slot - bw) / 2, bh = (s.total / top) * plotH, y = T + plotH - bh, rr = Math.min(4, bw / 2, bh)
          return (
            <g key={s.key}>
              {/* the whole column is the hit target, not only the bar */}
              <rect x={L + i * slot} y={T} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${name(s.key)}: ${inr(s.total)}, ${s.count} payments`} />
              {bh > 0 && <path d={`M${x},${T + plotH} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${T + plotH} Z`} className={`bar${hover === i ? ' on' : ''}`} pointerEvents="none" />}
              {i % labelEvery === 0 && <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="tick">{name(s.key)}</text>}
            </g>
          )
        })}
        <line x1={L} x2={W - 8} y1={T + plotH} y2={T + plotH} className="axis" />
      </svg>
      {h && <div className="col-tip" style={{ left: `${((L + hover! * slot + slot / 2) / W) * 100}%` }}><strong>{inr(h.total)}</strong><span>{by === 'day' ? fmtLong(h.key) : fmtMonth(h.key)} · {h.count} payment{h.count === 1 ? '' : 's'}</span></div>}
    </div>
  )
}

/** A ranked list with bars: the name and the figure are text, the bar only shows the share. */
function RankBars({ items, total }: { items: { name: string; total: number; count: number }[]; total: number }) {
  const max = Math.max(...items.map((i) => i.total), 1)
  if (!items.length) return <p className="section-hint" style={{ margin: 0 }}>Nothing in this period.</p>
  return (
    <ul className="col-rank">
      {items.map((i) => (
        <li key={i.name} title={`${i.name}: ${inr(i.total)} from ${i.count} payment${i.count === 1 ? '' : 's'}`}>
          <div><span>{i.name}</span><strong>{inr(i.total)}</strong></div>
          <div className="track"><i style={{ width: `${Math.max(1.5, (i.total / max) * 100)}%` }} /></div>
          <small>{i.count} payment{i.count === 1 ? '' : 's'} · {total ? Math.round(i.total * 1000 / total) / 10 : 0}% of the collection</small>
        </li>
      ))}
    </ul>
  )
}
