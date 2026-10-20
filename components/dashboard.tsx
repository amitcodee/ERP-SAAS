'use client'
// The home screen: the greeting, the period the numbers are for (Today, This month… or any From – To), the four
// headline numbers against the period before, "My day" (the person's own work, by role), then the trend, follow-ups,
// where enquiries came from, fee collection, students by department and the latest activity.
import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownRight, ArrowUpRight, Building2, CalendarDays, CalendarRange, ChevronRight, CircleDollarSign, Clock3, FileText, Plus, Sparkles, Target } from 'lucide-react'
import { DateInput } from '@/components/date-input'
import { RoleHome } from '@/components/role-home'
import type { Dashboard as Data } from '@/modules/reports/service'
import type { HomeSection } from '@/modules/home/service'
import type { SystemAlert } from '@/modules/ops/status'

const inr = (paise: number) => {
  const r = paise / 100
  return r >= 10000000 ? `₹${(r / 10000000).toFixed(2)}Cr` : r >= 100000 ? `₹${(r / 100000).toFixed(1)}L` : `₹${r.toLocaleString('en-IN')}`
}
const COLORS = ['#10186a', '#4a4af4', '#5cc8ff', '#c9f74a', '#a78bfa', '#ff9f6e', '#cbd5e1']
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

// ---- the period ------------------------------------------------------------------------------------------------------
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const monthStart = (d: string, back = 0) => { const [y, m] = d.split('-').map(Number), k = y * 12 + m - 1 - back; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}-01` }
/** The quick choices, worked out from today (India time). */
function presets() {
  const t = todayIST(), dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  return [
    { key: 'today', label: 'Today', from: t, to: t },
    { key: 'yesterday', label: 'Yesterday', from: add(t, -1), to: add(t, -1) },
    { key: 'week', label: 'This week', from: add(t, -dow), to: t },
    { key: '7d', label: 'Last 7 days', from: add(t, -6), to: t },
    { key: 'month', label: 'This month', from: monthStart(t), to: t },
    { key: 'last-month', label: 'Last month', from: monthStart(t, 1), to: add(monthStart(t), -1) },
    { key: '30d', label: 'Last 30 days', from: add(t, -29), to: t },
    { key: '90d', label: 'Last 3 months', from: add(t, -89), to: t },
    { key: 'year', label: 'This year', from: `${t.slice(0, 4)}-01-01`, to: t },
  ]
}
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const rangeText = (from: string, to: string) => (from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`)

function PeriodBar({ range }: { range: Data['range'] | null }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const list = presets()
  const cur = range ?? { from: list[4].from, to: list[4].to, picked: false }
  const active = list.find((p) => p.from === cur.from && p.to === cur.to)?.key ?? 'custom'
  const [custom, setCustom] = useState(active === 'custom')
  const [from, setFrom] = useState(cur.from)
  const [to, setTo] = useState(cur.to)
  const go = (f: string, t: string, key?: string) => {
    const q = new URLSearchParams(params.toString())
    if (key === 'month') { q.delete('from'); q.delete('to') } else { q.set('from', f); q.set('to', t) }
    router.push(`${path}${q.size ? `?${q}` : ''}`, { scroll: false })
  }
  return (
    <div className="db-period" role="group" aria-label="Period of the numbers">
      <span className="db-period-label"><CalendarRange size={16} /> Showing <b>{rangeText(cur.from, cur.to)}</b></span>
      <div className="db-period-chips">
        {list.map((p) => (
          <button key={p.key} type="button" className={!custom && active === p.key ? 'on' : ''} aria-pressed={!custom && active === p.key}
            onClick={() => { setCustom(false); setFrom(p.from); setTo(p.to); go(p.from, p.to, p.key) }}>{p.label}</button>
        ))}
        <button type="button" className={custom || active === 'custom' ? 'on' : ''} aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
      </div>
      {(custom || active === 'custom') && (
        <form className="db-period-custom" onSubmit={(e) => { e.preventDefault(); if (from && to) go(from <= to ? from : to, from <= to ? to : from) }}>
          <label>From<DateInput type="date" value={from} max={todayIST()} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<DateInput type="date" value={to} max={todayIST()} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="submit" className="button primary" disabled={!from || !to}>Apply</button>
        </form>
      )}
    </div>
  )
}

// ---- charts ----------------------------------------------------------------------------------------------------------
function Change({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="db-pill flat">—</span>
  const up = pct >= 0
  return <span className={`db-pill ${up ? 'up' : 'down'}`}>{up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{up ? '+' : ''}{pct}%</span>
}

function Trend({ series }: { series: Data['series'] }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.enquiries, s.registrations]))
  const step = series.length > 1 ? 640 / (series.length - 1) : 0
  const pts = (key: 'enquiries' | 'registrations') => series.map((s, i) => `${series.length > 1 ? i * step : 320},${180 - (s[key] / max) * 160}`)
  const line = (key: 'enquiries' | 'registrations') => 'M' + pts(key).join(' L')
  const every = Math.max(1, Math.ceil(series.length / 7))
  return (
    <div className="trend-wrap">
      <svg viewBox="0 0 640 190" preserveAspectRatio="none" role="img" aria-label="Enquiries and registrations over the period">
        <defs><linearGradient id="blueFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4a4af4" stopOpacity=".28" /><stop offset="100%" stopColor="#4a4af4" stopOpacity="0" /></linearGradient></defs>
        {[20, 73, 126, 180].map((y) => <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="#eceefa" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {series.length > 1 && <path d={`${line('enquiries')} L640,190 L0,190Z`} fill="url(#blueFill)" />}
        <path d={line('enquiries')} fill="none" stroke="#4a4af4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <path d={line('registrations')} fill="none" stroke="#5cc8ff" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chart-x">{series.filter((_, i) => i % every === 0).map((s) => <span key={s.label}>{s.label}</span>)}</div>
    </div>
  )
}

/** Half-circle of ticks, filled up to `pct`. */
function Gauge({ pct }: { pct: number }) {
  const N = 41
  return (
    <svg viewBox="0 0 200 108" className="db-gauge" role="img" aria-label={`${pct}% collected`}>
      {Array.from({ length: N }, (_, i) => {
        const a = Math.PI - (i / (N - 1)) * Math.PI
        const on = (i / (N - 1)) * 100 <= pct && pct > 0
        const x = Math.cos(a), y = Math.sin(a)
        // Rounded so the server and the browser print the same numbers.
        const r = (n: number) => Math.round(n * 100) / 100
        return <line key={i} x1={r(100 + x * 70)} y1={r(100 - y * 70)} x2={r(100 + x * 94)} y2={r(100 - y * 94)} stroke={on ? '#4a4af4' : '#e4e6fb'} strokeWidth="3" strokeLinecap="round" />
      })}
    </svg>
  )
}

// Which screen a log line belongs to, and the colour of its entry, both read from its wording ("create enquiry").
const LOG_SCREEN: [RegExp, string][] = [
  [/enquir|lead/, 'Enquiry'], [/registration/, 'Registration'], [/payment|fee|receipt|discount|installment/, 'Fees'],
  [/certificate|student/, 'Students'], [/batch|attendance|capstone|grade/, 'Attendance'], [/course|catalog/, 'Courses'],
  [/event|design/, 'Seminars & Workshops'], [/call/, 'Random Call'], [/role/, 'Roles & Permissions'], [/user|password/, 'Users & Staff'], [/branch/, 'Branches'], [/setting|rule/, 'Settings'],
]
const logScreen = (what: string) => LOG_SCREEN.find(([re]) => re.test(what.toLowerCase()))?.[1]
const logTone = (what: string) => {
  const w = what.toLowerCase()
  return /delete|deactivate|cancel|revoke|reject|fail/.test(w) ? 'red' : /payment|receipt|approve|activate|collect/.test(w) ? 'green' : /update|change|reset|set |distribute|assign/.test(w) ? 'amber' : /login/.test(w) ? 'violet' : 'blue'
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`
}

type Props = {
  data: Data | null; firstName: string; scopeLabel: string; onNavigate: (m: string) => void; canAddEnquiry: boolean; alerts?: SystemAlert[]
  home?: { sections: HomeSection[]; roleLabel: string }
}

export function DashboardView({ data, firstName, scopeLabel, onNavigate, canAddEnquiry, alerts = [], home }: Props) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const hour = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const head = (
    <div className="db-head">
      <div><h1>{greeting}, {firstName} 👋</h1><p>Here&apos;s what&apos;s happening at your institute{data?.range.picked ? ` — ${rangeText(data.range.from, data.range.to)}` : ' today'}.</p></div>
      <div className="db-head-actions">
        <span className="db-chip"><CalendarDays size={15} />{today}</span>
        <span className="db-chip"><Building2 size={15} />{scopeLabel}</span>
        {canAddEnquiry && <button className="button primary" onClick={() => onNavigate('Enquiry')}><Plus size={16} /> Add enquiry</button>}
      </div>
    </div>
  )
  const myDay = home && home.sections.length > 0 && <RoleHome sections={home.sections} roleLabel={home.roleLabel} onNavigate={onNavigate} />
  const alertBox = alerts.length > 0 && (
    <div className="panel system-alerts" role="alert">
      <strong>System alerts</strong>
      <ul>{alerts.map((a) => <li key={a.job}>{a.text}</li>)}</ul>
    </div>
  )
  if (!data) return <section className="page-container db">{head}{alertBox}{myDay || <div className="panel" style={{ padding: 24 }}>Use the menu on the left to get started. Reports are available to managers and accountants.</div>}</section>

  const r = data.range
  const vs = r.picked ? `vs the ${r.days === 1 ? 'day' : `${r.days} days`} before` : 'this month vs the same days before'
  const conv = data.enquiries.value ? Math.round((data.registrations.value / data.enquiries.value) * 100) : null
  const cards = [
    { label: 'New enquiries', value: data.enquiries.value.toLocaleString('en-IN'), change: data.enquiries.changePct as number | null | undefined, note: vs, icon: Sparkles, go: 'Enquiry' },
    { label: 'Registrations', value: data.registrations.value.toLocaleString('en-IN'), change: data.registrations.changePct, note: conv === null ? vs : `${conv}% of the enquiries · ${vs}`, icon: FileText, go: 'Registration' },
    { label: 'Fees collected', value: inr(data.feesCollected.value), change: data.feesCollected.changePct, note: vs, icon: CircleDollarSign, go: 'Collection' },
    { label: 'Follow-ups due', value: String(data.followUpsDue), change: undefined, note: 'today or overdue', icon: Clock3, go: 'Enquiry' },
  ]
  const totalDept = data.byDepartment.reduce((n, d) => n + d.count, 0)
  let acc = 0
  const stops = data.byDepartment.map((d, i) => { const from = (acc / Math.max(totalDept, 1)) * 100; acc += d.count; return `${COLORS[i % COLORS.length]} ${from}% ${(acc / Math.max(totalDept, 1)) * 100}%` })
  const bars = data.series.slice(-12)
  const maxReg = Math.max(1, ...bars.map((s) => s.registrations))
  const peak = bars.reduce((best, s, i) => (s.registrations > bars[best].registrations ? i : best), 0)
  const billed = data.feesCollected.total + data.pendingDues
  const rate = billed > 0 ? Math.round((data.feesCollected.total / billed) * 100) : 0
  const maxSrc = Math.max(1, ...data.sources.map((s) => s.enquiries))
  const trendSpan = r.picked ? rangeText(r.from, r.to) : 'Last 12 months'

  return (
    <section className="page-container db">
      {head}
      <PeriodBar key={`${r.from}${r.to}`} range={r.picked ? r : null} />
      {alertBox}
      <div className="db-stats">
        {cards.map(({ label, value, change, note, icon: Icon, go }, i) => (
          <button type="button" className={`panel db-stat tone-${i}`} key={label} onClick={() => onNavigate(go)} title={`Open ${go}`}>
            <div className="db-stat-top"><span>{label}</span><span className="db-ico"><Icon size={19} /></span></div>
            <div className="db-stat-value"><strong>{value}</strong>{change !== undefined && <Change pct={change} />}</div>
            <em>{change === null ? 'nothing in the period before' : note}</em>
          </button>
        ))}
      </div>

      {myDay && <div className="db-myday">{myDay}</div>}

      <div className="db-main">
        <div className="db-col">
          <div className="panel">
            <div className="panel-header"><div><h2>Enquiries vs registrations</h2><span>{trendSpan}{data.seriesBy === 'day' ? ', day by day' : ', month by month'}</span></div>
              <div className="chart-legend"><span><i className="legend-blue" /> Enquiries</span><span><i className="legend-light" /> Registrations</span></div>
            </div>
            <div className="db-trend">
              <div className="db-big"><strong>{data.series.reduce((n, s) => n + s.enquiries, 0).toLocaleString('en-IN')}</strong><span>Enquiries in the chart · Total enquiries {data.enquiries.total.toLocaleString('en-IN')}</span></div>
              <Trend series={data.series} />
            </div>
            <div className="db-strip">
              <div className="navy"><strong>{data.registrations.total.toLocaleString('en-IN')}</strong><span>Total registrations</span></div>
              <div className="green"><strong>{data.students.toLocaleString('en-IN')}</strong><span>Active students</span></div>
              <div className="amber"><strong>{inr(data.pendingDues)}</strong><span>Pending dues</span></div>
            </div>
          </div>

          <div className="db-two">
            <div className="panel db-list">
              <div className="panel-header"><div><h2>Follow-ups due</h2><span>Today or overdue</span></div><button className="text-button" onClick={() => onNavigate('Enquiry')}>View all <ChevronRight size={14} /></button></div>
              {data.todaysFollowUps.map((f) => (
                <div className="db-row" key={f.enquiryNo}>
                  <div className={`small-avatar ${f.overdue ? 'amber' : 'blue'}`}>{initials(f.name)}</div>
                  <div className="db-row-main"><strong>{f.name}</strong><span>{f.course ?? '—'} · {f.enquiryNo}</span></div>
                  <span className={`db-pill ${f.overdue ? 'down' : 'up'}`}><Clock3 size={12} />{f.overdue ? 'Overdue' : 'Today'}</span>
                </div>
              ))}
              {!data.todaysFollowUps.length && <p className="db-empty">Nothing due — nice.</p>}
            </div>

            <div className="panel">
              <div className="panel-header"><div><h2>Where enquiries came from</h2><span>{rangeText(r.from, r.to)}</span></div><Target size={18} style={{ color: 'var(--indigo)' }} /></div>
              <div className="db-sources">
                {data.sources.map((s) => (
                  <div key={s.source}>
                    <div className="db-src-top"><span>{s.source}</span><b>{s.enquiries}</b></div>
                    <div className="db-src-bar"><i style={{ width: `${(s.enquiries / maxSrc) * 100}%` }} /><em style={{ width: `${(s.joined / maxSrc) * 100}%` }} /></div>
                    <small>{s.joined} joined{s.enquiries ? ` · ${Math.round((s.joined / s.enquiries) * 100)}%` : ''}</small>
                  </div>
                ))}
                {!data.sources.length && <p className="db-empty">No enquiries in this period.</p>}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h2>Recent activity</h2><span>Latest actions · {rangeText(r.from, r.to)}</span></div></div>
            <ol className="db-log">
              {data.recentActivity.map((a, i) => {
                const screen = logScreen(a.what)
                const body = <><time>{ago(a.at)}</time><p><strong>{a.who}</strong> {a.what}</p></>
                return (
                  <li className={logTone(a.what)} key={i}>
                    {screen ? <button onClick={() => onNavigate(screen)} title={`Open ${screen}`}>{body}<ChevronRight size={15} /></button> : <div>{body}</div>}
                  </li>
                )
              })}
            </ol>
            {!data.recentActivity.length && <p className="db-empty">No activity in this period.</p>}
          </div>
        </div>

        <div className="db-col">
          <div className="panel">
            <div className="panel-header"><div><h2>Registrations</h2><span>{data.seriesBy === 'day' ? 'Day by day' : 'Month by month'}{bars.length < data.series.length ? `, last ${bars.length}` : ''}</span></div></div>
            <div className="db-bars">
              {bars.map((s, i) => (
                <div className={i === peak && s.registrations > 0 ? 'peak' : ''} key={i} title={`${s.label}: ${s.registrations}`}>
                  <b>{i === peak && s.registrations > 0 ? s.registrations : ''}</b>
                  <span><i style={{ height: `${Math.max(6, (s.registrations / maxReg) * 100)}%` }} /></span>
                  <em>{bars.length > 8 && i % 2 ? '' : data.seriesBy === 'day' ? s.label.slice(0, 2) : s.label}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="panel db-rate">
            <div className="panel-header"><div><h2>Fee collection rate</h2><span>All time</span></div></div>
            <div className="db-gauge-wrap"><Gauge pct={rate} /><div><strong>{rate}%</strong><span>of fees collected</span></div></div>
            <div className="db-rate-legend">
              <div><i style={{ background: '#4a4af4' }} />Collected<strong>{inr(data.feesCollected.total)}</strong></div>
              <div><i style={{ background: '#cfd3f5' }} />Pending<strong>{inr(data.pendingDues)}</strong></div>
              <div><i style={{ background: '#c9f74a' }} />In this period<strong>{inr(data.feesCollected.value)}</strong></div>
            </div>
            <div className="db-rate-actions">
              <button className="button secondary" onClick={() => onNavigate('Fees')}>Show details</button>
              <button className="button secondary" onClick={() => onNavigate('Reports')}>Dues aging &amp; funnel</button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h2>Students by department</h2><span>{totalDept} active now</span></div></div>
            <div className="course-content">
              <div className="donut" style={totalDept ? { background: `conic-gradient(${stops.join(',')})` } : undefined}><div><strong>{totalDept}</strong><span>Students</span></div></div>
              <div className="course-legend">{data.byDepartment.map((d, i) => <div key={d.name}><i style={{ background: COLORS[i % COLORS.length] }} /><span>{d.name}</span><strong>{Math.round((d.count / Math.max(totalDept, 1)) * 100)}%</strong></div>)}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
