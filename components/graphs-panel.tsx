'use client'
// Graphs of the admissions work over a period: the daily (or monthly) activity, the money, the funnel from lead to
// registration, where leads come from, what they ask for, and who did the work. The period lives in the address.
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { DateInput } from '@/components/date-input'
import type { Graphs } from '@/modules/reports/graphs'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const short = (paise: number) => { const r = paise / 100; return r >= 1e7 ? `₹${+(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${+(r / 1e5).toFixed(1)}L` : r >= 1000 ? `₹${+(r / 1000).toFixed(1)}K` : `₹${r}` }
const day = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const mon = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const long = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0)
const shiftDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

const STATUS: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead' }

const LINES = [
  { key: 'calls', label: 'Calls', color: '#3b82f6' },
  { key: 'leads', label: 'Leads', color: '#8b5cf6' },
  { key: 'visits', label: 'Visits', color: '#f59e0b' },
  { key: 'registrations', label: 'Registrations', color: '#10b981' },
] as const

export function GraphsPanel({ data: g, today, showBranches, scope }: { data: Graphs; today: string; showBranches: boolean; scope: string }) {
  const router = useRouter()
  const path = usePathname()
  const go = (from: string, to: string) => router.push(`${path}?${new URLSearchParams({ from, to })}`)
  const t = new Date(`${today}T00:00:00Z`)
  const monthStart = today.slice(0, 8) + '01'
  const fyStart = `${t.getUTCMonth() >= 3 ? t.getUTCFullYear() : t.getUTCFullYear() - 1}-04-01`
  const presets: [string, string, string][] = [
    ['Last 7 days', shiftDays(today, -6), today], ['Last 30 days', shiftDays(today, -29), today], ['This month', monthStart, today],
    ['Last 3 months', shiftDays(today, -89), today], ['This year (Apr–Mar)', fyStart, today],
  ]
  const active = presets.find(([, f, to]) => f === g.from && to === g.to)?.[0]
  const name = (k: string) => (g.by === 'day' ? day(k) : mon(k))

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports / Graphs</p>
          <h1>Graphs</h1>
          <p className="subheading">How the admissions work went from {long(g.from)} to {long(g.to)}{scope ? ` · ${scope}` : ''}. Every chart is worked out live from the records; point at a chart for the exact figures.</p>
        </div>
      </div>

      <div className="panel col-filters">
        <div className="col-presets" role="group" aria-label="Period">{presets.map(([label, f, to]) => <button key={label} type="button" className={active === label ? 'on' : ''} onClick={() => go(f, to)}>{label}</button>)}</div>
        <div className="col-controls">
          <label>From<DateInput type="date" value={g.from} max={today} onChange={(e) => e.target.value && go(e.target.value, e.target.value > g.to ? e.target.value : g.to)} /></label>
          <label>To<DateInput type="date" value={g.to} min={g.from} max={today} onChange={(e) => e.target.value && go(g.from, e.target.value)} /></label>
        </div>
      </div>

      <div className="table-summary">
        <div><strong>{g.totals.calls.toLocaleString('en-IN')}</strong><span>Calls</span></div>
        <div><strong>{g.totals.leads.toLocaleString('en-IN')}</strong><span>New leads</span></div>
        <div><strong>{g.totals.visits.toLocaleString('en-IN')}</strong><span>Visits</span></div>
        <div><strong>{g.totals.registrations.toLocaleString('en-IN')}</strong><span>Registrations</span></div>
        <div><strong>{inr(g.totals.collected)}</strong><span>Collected</span></div>
      </div>

      <h2 className="gr-section">Over time</h2>
      <div className="panel">
        <div className="panel-header"><div><h2>Activity per {g.by}</h2><span>Four lines, one per kind of work. A rising line means more of that work; the gap between leads and registrations is the people still to convert.</span></div>
          <div className="chart-legend">{LINES.map((l) => <span key={l.key}><i style={{ background: l.color }} />{l.label}</span>)}</div></div>
        <Lines series={g.series} name={name} />
      </div>
      <div className="col-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Month by month — last 12 months</h2><span>Leads (purple) against registrations (green) each month, up to {mon(g.to.slice(0, 7))}.</span></div>
            <div className="chart-legend"><span><i style={{ background: '#8b5cf6' }} />Leads</span><span><i style={{ background: '#10b981' }} />Registrations</span></div></div>
          <PairBars items={g.months.map((m) => ({ label: mon(m.key), a: m.leads, b: m.registrations }))} />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Money per month — last 12 months</h2><span>Fee payments received each month.</span></div></div>
          <Bars items={g.months.map((m) => ({ key: m.key, label: mon(m.key), value: m.collected }))} money />
        </div>
      </div>

      <h2 className="gr-section">Leads</h2>
      <div className="col-grid three">
        <div className="panel">
          <div className="panel-header"><div><h2>Where the leads stand</h2><span>The period&apos;s {g.funnel.leads} leads by their status today.</span></div></div>
          <Donut items={g.statuses.map((x) => ({ name: STATUS[x.name] ?? x.name, value: x.count }))} unit="leads" />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Lead sources</h2><span>Each source&apos;s share of the new leads.</span></div></div>
          <Donut items={g.sources.map((x) => ({ name: x.name, value: x.count }))} unit="leads" />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>From lead to registration</h2><span>How far the period&apos;s leads got by today.</span></div></div>
          <Funnel f={g.funnel} />
        </div>
      </div>
      <div className="col-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Sources and how they convert</h2><span>Leads per source, and how many of them registered — the best source is the one that registers, not only the one that brings most.</span></div></div>
          <Rank items={g.sources} extraLabel="registered" />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Courses asked for</h2><span>The courses the new leads asked about, and how many registered.</span></div></div>
          <HBars items={g.courses.map((x) => ({ name: x.name, value: x.count, note: `${x.extra ?? 0} registered` }))} color="#8b5cf6" />
        </div>
      </div>

      <h2 className="gr-section">Registrations and courses</h2>
      <div className="col-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Registrations by course</h2><span>Students registered in the period per course, with the total course fees agreed.</span></div></div>
          <HBars items={g.regCourses.map((x) => ({ name: x.name, value: x.count, note: inr(x.fee) }))} color="#10b981" />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>Registrations by department</h2><span>Each department&apos;s share of the registrations.</span></div></div>
          <Donut items={g.departments.map((x) => ({ name: x.name, value: x.count }))} unit="students" />
        </div>
      </div>

      <h2 className="gr-section">Money</h2>
      <div className="col-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>Money collected per {g.by}</h2><span>Fee payments received. Total {inr(g.totals.collected)}.</span></div></div>
          <Bars items={g.series.map((s) => ({ key: s.key, label: name(s.key), value: s.collected }))} money />
        </div>
        <div className="panel">
          <div className="panel-header"><div><h2>By mode of payment</h2><span>How the money came in: cash, UPI, card, bank transfer…</span></div></div>
          <Donut items={g.modes.map((x) => ({ name: x.name, value: x.total }))} money unit="" />
        </div>
      </div>

      {showBranches && (<>
        <h2 className="gr-section">Branches</h2>
        <div className="col-grid three">
          <div className="panel">
            <div className="panel-header"><div><h2>Share of leads</h2><span>Each branch&apos;s part of all the leads.</span></div></div>
            <Donut items={g.branches.map((b) => ({ name: b.name, value: b.leads }))} unit="leads" />
          </div>
          <div className="panel">
            <div className="panel-header"><div><h2>Registrations per branch</h2><span>Students registered in the period.</span></div></div>
            <HBars items={g.branches.map((b) => ({ name: b.name, value: b.registrations, note: `${pct(b.registrations, b.leads)}% of leads` }))} color="#10b981" />
          </div>
          <div className="panel">
            <div className="panel-header"><div><h2>Collection per branch</h2><span>Fee payments received in the period.</span></div></div>
            <HBars items={g.branches.map((b) => ({ name: b.name, value: b.collected }))} money color="#059669" />
          </div>
        </div>
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Branches side by side</h2><span>Leads, registrations and money per branch in this period. Conversion = registrations ÷ leads.</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Branch</th><th>Leads</th><th>Registrations</th><th>Conversion</th><th>Collected</th></tr></thead>
            <tbody>{g.branches.map((b) => <tr key={b.name}><td><strong>{b.name}</strong></td><td><Cell v={b.leads} max={Math.max(...g.branches.map((x) => x.leads), 1)} /></td><td><Cell v={b.registrations} max={Math.max(...g.branches.map((x) => x.registrations), 1)} /></td><td>{pct(b.registrations, b.leads)}%</td><td>{inr(b.collected)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </>)}

      <h2 className="gr-section">Counsellors and staff</h2>
      {g.staff.length ? (<>
        <div className="col-grid">
          <div className="panel">
            <div className="panel-header"><div><h2>Calls per counsellor</h2><span>New and follow-up calls each person made in the period.</span></div></div>
            <HBars items={g.staff.map((s) => ({ name: s.name, value: s.calls }))} color="#3b82f6" />
          </div>
          <div className="panel">
            <div className="panel-header"><div><h2>Registrations per counsellor</h2><span>Registrations each person entered, and the visits of their leads.</span></div></div>
            <HBars items={[...g.staff].sort((a, b) => b.registrations - a.registrations).map((s) => ({ name: s.name, value: s.registrations, note: `${s.visits} visits` }))} color="#10b981" />
          </div>
        </div>
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Who did the work</h2><span>All three figures per person; the bar shows each one against the busiest.</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Staff</th><th>Calls</th><th>Visits</th><th>Registrations</th></tr></thead>
            <tbody>{g.staff.map((s) => <tr key={s.name}><td><strong>{s.name}</strong></td><td><Cell v={s.calls} max={Math.max(...g.staff.map((x) => x.calls), 1)} /></td><td><Cell v={s.visits} max={Math.max(...g.staff.map((x) => x.visits), 1)} /></td><td><Cell v={s.registrations} max={Math.max(...g.staff.map((x) => x.registrations), 1)} /></td></tr>)}</tbody>
          </table></div>
        </div>
      </>) : <div className="panel"><p className="section-hint" style={{ margin: 0 }}>No work recorded in this period.</p></div>}
    </section>
  )
}

/** Several counts over time as lines; one tooltip lists them all for the column under the pointer. */
function Lines({ series, name }: { series: Graphs['series']; name: (k: string) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...series.flatMap((s) => LINES.map((l) => s[l.key])))
  const pow = 10 ** Math.floor(Math.log10(max)), top = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= max)!
  const W = 960, H = 280, L = 44, B = 28, T = 12, pw = W - L - 12, ph = H - T - B
  const x = (i: number) => L + (series.length === 1 ? pw / 2 : (i * pw) / (series.length - 1))
  const y = (v: number) => T + ph - (v / top) * ph
  const every = Math.ceil(series.length / 12)
  const h = hover != null ? series[hover] : null
  return (
    <div className="col-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Activity over time" onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={L} x2={W - 12} y1={y(f * top)} y2={y(f * top)} className="grid" /><text x={L - 8} y={y(f * top) + 4} textAnchor="end" className="tick">{Math.round(f * top)}</text></g>)}
        {LINES.map((l) => <polyline key={l.key} fill="none" stroke={l.color} strokeWidth={2.2} strokeLinejoin="round" points={series.map((s, i) => `${x(i)},${y(s[l.key])}`).join(' ')} />)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ph} className="axis" />}
        {hover != null && LINES.map((l) => <circle key={l.key} cx={x(hover)} cy={y(series[hover][l.key])} r={4} fill={l.color} />)}
        {series.map((s, i) => (
          <g key={s.key}>
            <rect x={x(i) - pw / series.length / 2} y={T} width={Math.max(pw / series.length, 4)} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="tick">{name(s.key)}</text>}
          </g>
        ))}
        <line x1={L} x2={W - 12} y1={T + ph} y2={T + ph} className="axis" />
      </svg>
      {h && <div className="col-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}><strong>{name(h.key)}</strong>{LINES.map((l) => <span key={l.key}>{l.label}: {h[l.key]}</span>)}</div>}
    </div>
  )
}

function Bars({ items, money }: { items: { key: string; label: string; value: number }[]; money?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...items.map((i) => i.value))
  const W = 480, H = 220, L = 52, B = 26, T = 10, pw = W - L - 6, ph = H - T - B
  const slot = pw / items.length, bw = Math.max(2, Math.min(26, slot - 2))
  const every = Math.ceil(items.length / 6)
  const fmt = (v: number) => (money ? short(v) : String(v))
  const h = hover != null ? items[hover] : null
  return (
    <div className="col-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bars" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - 6} y1={T + ph - f * ph} y2={T + ph - f * ph} className="grid" /><text x={L - 6} y={T + ph - f * ph + 4} textAnchor="end" className="tick">{fmt(f * max)}</text></g>)}
        {items.map((it, i) => { const bh = (it.value / max) * ph; return (
          <g key={it.key}>
            <rect x={L + i * slot} y={T} width={slot} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />
            {bh > 0 && <rect x={L + i * slot + (slot - bw) / 2} y={T + ph - bh} width={bw} height={bh} rx={Math.min(3, bw / 2)} className={`bar${hover === i ? ' on' : ''}`} pointerEvents="none" />}
            {i % every === 0 && <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="tick">{it.label}</text>}
          </g>) })}
        <line x1={L} x2={W - 6} y1={T + ph} y2={T + ph} className="axis" />
      </svg>
      {h && <div className="col-tip" style={{ left: `${((L + hover! * slot + slot / 2) / W) * 100}%` }}><strong>{money ? inr(h.value) : h.value}</strong><span>{h.label}</span></div>}
    </div>
  )
}

function Funnel({ f }: { f: Graphs['funnel'] }) {
  const steps = [
    { label: 'Leads came in', n: f.leads, note: 'every lead added in the period' },
    { label: 'Visited the branch', n: f.visited, note: `${pct(f.visited, f.leads)}% of the leads` },
    { label: 'Took a demo', n: f.demo, note: `${pct(f.demo, f.leads)}% of the leads` },
    { label: 'Registered', n: f.registered, note: `${pct(f.registered, f.leads)}% of the leads — the conversion` },
    { label: 'Dead (dropped)', n: f.dead, note: `${pct(f.dead, f.leads)}% of the leads` },
  ]
  return (
    <ul className="col-rank">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div><span>{s.label}</span><strong>{s.n.toLocaleString('en-IN')}</strong></div>
          <div className="track"><i style={{ width: `${Math.max(1.5, f.leads ? (s.n / f.leads) * 100 : 0)}%`, background: i === 4 ? '#ef4444' : i === 3 ? '#10b981' : undefined }} /></div>
          <small>{s.note}</small>
        </li>
      ))}
    </ul>
  )
}

function Rank({ items, extraLabel }: { items: { name: string; count: number; extra?: number }[]; extraLabel: string }) {
  if (!items.length) return <p className="section-hint" style={{ margin: 0 }}>Nothing in this period.</p>
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <ul className="col-rank">
      {items.map((i) => (
        <li key={i.name}>
          <div><span>{i.name}</span><strong>{i.count}</strong></div>
          <div className="track"><i style={{ width: `${Math.max(1.5, (i.count / max) * 100)}%` }} /></div>
          <small>{i.extra ?? 0} {extraLabel} · {pct(i.extra ?? 0, i.count)}% conversion</small>
        </li>
      ))}
    </ul>
  )
}

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#ec4899', '#64748b']

/** A circle (donut) chart: each slice is a share; the legend gives every name, figure and percentage. */
function Donut({ items, unit, money }: { items: { name: string; value: number }[]; unit: string; money?: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const list = items.filter((i) => i.value > 0)
  const total = list.reduce((n, i) => n + i.value, 0)
  if (!total) return <p className="section-hint" style={{ margin: 0 }}>Nothing in this period.</p>
  // the top 7 slices, the rest as "Other"
  const shown = list.length > 8 ? [...list.slice(0, 7), { name: 'Other', value: list.slice(7).reduce((n, i) => n + i.value, 0) }] : list
  const fmt = (v: number) => (money ? inr(v) : v.toLocaleString('en-IN'))
  const R = 70, C = 2 * Math.PI * R
  let acc = 0
  const h = hover != null ? shown[hover] : null
  return (
    <div className="gr-donut">
      <svg viewBox="0 0 180 180" role="img" aria-label="Share chart" onMouseLeave={() => setHover(null)}>
        {shown.map((s, i) => {
          const len = (s.value / total) * C, off = acc
          acc += len
          return <circle key={s.name} cx={90} cy={90} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={hover === i ? 30 : 24}
            strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" onMouseEnter={() => setHover(i)} style={{ cursor: 'pointer', transition: 'stroke-width .15s' }} />
        })}
        <text x={90} y={86} textAnchor="middle" className="gr-donut-big">{h ? `${Math.round((h.value * 100) / total)}%` : money ? short(total) : total.toLocaleString('en-IN')}</text>
        <text x={90} y={106} textAnchor="middle" className="gr-donut-small">{h ? h.name.slice(0, 18) : unit || 'total'}</text>
      </svg>
      <ul className="gr-legend">
        {shown.map((s, i) => (
          <li key={s.name} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{s.name}</span><b>{fmt(s.value)}</b><small>{Math.round((s.value * 1000) / total) / 10}%</small>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A ranked bar chart lying on its side, so long names stay readable. */
function HBars({ items, color, money }: { items: { name: string; value: number; note?: string }[]; color: string; money?: boolean }) {
  const list = items.filter((i) => i.value > 0)
  if (!list.length) return <p className="section-hint" style={{ margin: 0 }}>Nothing in this period.</p>
  const max = Math.max(...list.map((i) => i.value))
  return (
    <ul className="gr-hbars">
      {list.slice(0, 12).map((i) => (
        <li key={i.name} title={`${i.name}: ${money ? inr(i.value) : i.value}${i.note ? ` · ${i.note}` : ''}`}>
          <span className="name">{i.name}</span>
          <span className="bar"><i style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: color }} /></span>
          <b>{money ? short(i.value) : i.value.toLocaleString('en-IN')}</b>
          {i.note && <small>{i.note}</small>}
        </li>
      ))}
    </ul>
  )
}

/** Two bars per month side by side (leads and registrations). */
function PairBars({ items }: { items: { label: string; a: number; b: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...items.flatMap((i) => [i.a, i.b]))
  const W = 480, H = 220, L = 36, B = 26, T = 10, pw = W - L - 6, ph = H - T - B
  const slot = pw / items.length, bw = Math.max(2, Math.min(14, slot / 2 - 2))
  const h = hover != null ? items[hover] : null
  return (
    <div className="col-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Leads and registrations per month" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - 6} y1={T + ph - f * ph} y2={T + ph - f * ph} className="grid" /><text x={L - 6} y={T + ph - f * ph + 4} textAnchor="end" className="tick">{Math.round(f * max)}</text></g>)}
        {items.map((it, i) => {
          const cx = L + i * slot + slot / 2, ha = (it.a / max) * ph, hb = (it.b / max) * ph
          return (
            <g key={it.label}>
              <rect x={L + i * slot} y={T} width={slot} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />
              {ha > 0 && <rect x={cx - bw - 1} y={T + ph - ha} width={bw} height={ha} rx={2} fill="#8b5cf6" opacity={hover == null || hover === i ? 1 : 0.45} pointerEvents="none" />}
              {hb > 0 && <rect x={cx + 1} y={T + ph - hb} width={bw} height={hb} rx={2} fill="#10b981" opacity={hover == null || hover === i ? 1 : 0.45} pointerEvents="none" />}
              <text x={cx} y={H - 8} textAnchor="middle" className="tick">{it.label}</text>
            </g>
          )
        })}
        <line x1={L} x2={W - 6} y1={T + ph} y2={T + ph} className="axis" />
      </svg>
      {h && <div className="col-tip" style={{ left: `${((L + hover! * slot + slot / 2) / W) * 100}%` }}><strong>{h.label}</strong><span>Leads: {h.a}</span><span>Registrations: {h.b} ({pct(h.b, h.a)}%)</span></div>}
    </div>
  )
}

const Cell = ({ v, max }: { v: number; max: number }) => (
  <div className="gr-cell"><span>{v}</span><div className="track"><i style={{ width: `${Math.max(v ? 3 : 0, (v / max) * 100)}%` }} /></div></div>
)
