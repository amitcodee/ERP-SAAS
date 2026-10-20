'use client'
// The work calendar (a month, a week or a range of days): every day shows how much happened (calls, leads, visits, registrations,
// money) and what is due (follow-ups, promised visits). Clicking a day lists everything behind those numbers.
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DateInput } from '@/components/date-input'
import type { CalendarData, DayCounts } from '@/modules/reports/calendar'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const time = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const longDay = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
const shortDay = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const dow = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay()
const monthEndOf = (m: string) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10) }
const ZERO: DayCounts = { calls: 0, followUpCalls: 0, leads: 0, webLeads: 0, visits: 0, followUpsDue: 0, expectedVisits: 0, registrations: 0, payments: 0, collected: 0 }
const shift = (m: string, by: number) => { const d = new Date(`${m}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + by); return d.toISOString().slice(0, 7) }
const STATUS: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead', active: 'Active', on_hold: 'On hold', discontinued: 'Discontinued', completed: 'Completed' }
const st = (s: string | null) => (s ? STATUS[s] ?? s : '—')

/** The kinds of work, in the order and colours used everywhere on the page. */
const KINDS: { key: keyof DayCounts; label: string; tone: string; what: string; need: keyof CalendarData['show'] }[] = [
  { key: 'calls', label: 'Calls', tone: 'blue', what: 'New random calls entered', need: 'calls' },
  { key: 'followUpCalls', label: 'Follow-up calls', tone: 'sky', what: 'Calls made again to an existing caller', need: 'calls' },
  { key: 'leads', label: 'Leads', tone: 'violet', what: 'New leads added (not yet visited)', need: 'leads' },
  { key: 'webLeads', label: 'Website leads', tone: 'teal', what: 'Forms filled on the websites', need: 'webLeads' },
  { key: 'visits', label: 'Visits', tone: 'indigo', what: 'People who came to the branch (visited enquiries)', need: 'leads' },
  { key: 'followUpsDue', label: 'Follow-ups due', tone: 'amber', what: 'Leads and calls whose next follow-up is this day', need: 'leads' },
  { key: 'expectedVisits', label: 'Expected visits', tone: 'orange', what: 'Callers who said they will visit this day', need: 'calls' },
  { key: 'registrations', label: 'Registrations', tone: 'green', what: 'Students registered (enrolment date)', need: 'registrations' },
  { key: 'payments', label: 'Payments', tone: 'emerald', what: 'Fee payments received', need: 'payments' },
]

export function CalendarPanel({ data: c, scope }: { data: CalendarData; scope: string }) {
  const router = useRouter()
  const path = usePathname()
  const go = (q: Record<string, string>) => router.push(`${path}?${new URLSearchParams(q)}`)
  // follow-ups due can come from leads or calls, so show it when either is readable
  const kinds = KINDS.filter((k) => c.show[k.need] || (k.key === 'followUpsDue' && c.show.calls))

  // the days on screen as whole weeks, Monday first; days outside what is shown stay blank
  const start = addDays(c.gridFrom, -((dow(c.gridFrom) + 6) % 7))
  const cells: (string | null)[] = []
  for (let k = start; k <= c.gridTo || cells.length % 7; k = addDays(k, 1)) cells.push(k >= c.gridFrom && k <= c.gridTo ? k : null)

  const single = c.from === c.to
  const whole = c.from === c.gridFrom && c.to === c.gridTo // a week or range listed as a whole
  // the counts of what is listed: one day, or the sum over the week / range
  const sel = { ...ZERO }
  for (const [k, n] of Object.entries(c.days)) if (k >= c.from && k <= c.to) for (const f of Object.keys(sel) as (keyof DayCounts)[]) sel[f] += n[f]
  const d = c.detail
  const title = single ? `${c.from === c.today ? 'Today — ' : ''}${longDay(c.from)}` : `${shortDay(c.from)} – ${shortDay(c.to)}`
  const heading = c.view === 'month' ? monthName(c.month) : c.view === 'week' ? `Week of ${shortDay(c.gridFrom)}` : `${shortDay(c.gridFrom)} – ${shortDay(c.gridTo)}`

  // what clicking a day does in each view
  const pick = (k: string) =>
    c.view === 'month' ? go({ view: 'month', month: c.month, day: k })
      : c.view === 'week' ? go({ view: 'week', day: c.gridFrom, ...(single && c.from === k ? {} : { pick: k }) })
        : go({ view: 'range', from: c.gridFrom, to: c.gridTo, ...(single && c.from === k ? {} : { pick: k }) })
  const prev = () => (c.view === 'month' ? go({ view: 'month', month: shift(c.month, -1) }) : go({ view: 'week', day: addDays(c.gridFrom, -7) }))
  const next = () => (c.view === 'month' ? go({ view: 'month', month: shift(c.month, 1) }) : go({ view: 'week', day: addDays(c.gridFrom, 7) }))
  const onToday = c.view === 'month' ? c.month === c.today.slice(0, 7) && c.from === c.today : c.view === 'week' ? c.today >= c.gridFrom && c.today <= c.gridTo : true

  return (
    <section className="page-container table-page col-page cal-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports / Calendar</p>
          <h1>Calendar</h1>
          <p className="subheading">Each day shows what was done (calls, leads, visits, registrations, payments) and what is due (follow-ups, promised visits). See a month, a week, or any range of days; click a day to see every name behind its numbers.{scope ? ` · ${scope}` : ''}</p>
        </div>
      </div>

      <div className="cal-layout">
        <div className="panel cal-month">
          <div className="cal-head">
            <div className="reg-seg" role="radiogroup" aria-label="Show">
              {(['month', 'week', 'range'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={c.view === v} className={c.view === v ? 'on' : ''}
                  onClick={() => (v === 'month' ? go({ view: 'month', month: c.from.slice(0, 7), day: c.from }) : v === 'week' ? go({ view: 'week', day: c.from }) : go({ view: 'range', from: c.view === 'month' ? `${c.month}-01` : c.gridFrom, to: c.view === 'month' ? (c.today.startsWith(c.month) ? c.today : monthEndOf(c.month)) : c.gridTo }))}>
                  {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Range'}
                </button>
              ))}
            </div>
            {c.view !== 'range' ? (
              <div className="cal-nav">
                <button type="button" className="filter-button icon-only" aria-label={`Previous ${c.view}`} onClick={prev}><ChevronLeft size={16} /></button>
                <h2>{heading}</h2>
                <button type="button" className="filter-button icon-only" aria-label={`Next ${c.view}`} onClick={next}><ChevronRight size={16} /></button>
                {!onToday && <button type="button" className="filter-button" onClick={() => go(c.view === 'month' ? { view: 'month', month: c.today.slice(0, 7), day: c.today } : { view: 'week', day: c.today })}>Today</button>}
              </div>
            ) : (
              <div className="cal-range col-controls">
                <label>From<DateInput type="date" value={c.gridFrom} onChange={(e) => e.target.value && go({ view: 'range', from: e.target.value, to: e.target.value > c.gridTo ? e.target.value : c.gridTo })} /></label>
                <label>To<DateInput type="date" value={c.gridTo} min={c.gridFrom} onChange={(e) => e.target.value && go({ view: 'range', from: c.gridFrom, to: e.target.value })} /></label>
              </div>
            )}
          </div>
          {c.view === 'range' && <p className="section-hint" style={{ margin: '0 0 10px' }}>Pick any dates, up to 3 months. The whole range is listed on the right; click one day to look at it alone.</p>}
          <div className="cal-legend">{kinds.map((k) => <span key={k.key} title={k.what}><i className={`tone-${k.tone}`} />{k.label}</span>)}</div>

          <div className={`cal-grid${c.view === 'week' ? ' week' : ''}`} role="grid" aria-label={heading}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="cal-dow">{w}</div>)}
            {cells.map((k, i) => {
              if (!k) return <div key={`x${i}`} className="cal-cell empty" />
              const n = c.days[k]
              const busy = n && kinds.some((t) => n[t.key])
              const picked = single ? k === c.from : !whole && k >= c.from && k <= c.to
              const inSel = whole && k >= c.from && k <= c.to
              return (
                <button key={k} type="button" className={`cal-cell${picked ? ' on' : ''}${inSel ? ' in' : ''}${k === c.today ? ' today' : ''}${(i % 7) > 3 ? ' tip-left' : ''}`} onClick={() => pick(k)} aria-label={longDay(k)} aria-pressed={picked}>
                  <span className="cal-num">{Number(k.slice(8))}{(k.endsWith('-01') || c.view !== 'month') && <small> {new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })}</small>}</span>
                  {n && <span className="cal-chips">
                    {kinds.map((t) => (n[t.key] ? <em key={t.key} className={`tone-${t.tone}`}>{c.view === 'week' ? `${n[t.key]} ${t.label.toLowerCase()}` : n[t.key]}</em> : null))}
                  </span>}
                  {n?.collected ? <small className="cal-money">{inr(n.collected)}</small> : null}
                  {/* the tooltip: the day's numbers by name, shown when pointing at (or focusing) the day */}
                  <span className="cal-tip" role="tooltip">
                    <strong>{longDay(k)}</strong>
                    {busy ? kinds.filter((t) => n![t.key]).map((t) => <span key={t.key}><i className={`tone-${t.tone}`} />{t.label}<b>{n![t.key]}</b></span>) : <span className="none">Nothing recorded</span>}
                    {n?.collected ? <span><i className="tone-emerald" />Collected<b>{inr(n.collected)}</b></span> : null}
                    <small>{picked && c.view !== 'month' ? 'Click again to list the whole ' + c.view : 'Click to list this day in the side panel'}</small>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="section-hint cal-foot">
            <strong>How to read it:</strong> each coloured number is a count for that day (colours as in the key above); point at a day for the names of the numbers, click it to list that day on the right. The amount under a day is the money collected. The square marks the day picked; the filled number is today.
            <br /><strong>On screen in total:</strong> {kinds.map((k) => `${c.totals[k.key]} ${k.label.toLowerCase()}`).join(' · ')}{c.show.payments ? ` · ${inr(c.totals.collected)} collected` : ''}.
          </p>
        </div>

        {/* the side panel: the chosen day, week or range at a glance, each count leading to its full list below */}
        <aside className="panel cal-side" aria-label={`Results for ${title}`}>
          <p className="eyebrow" style={{ margin: 0 }}>{single ? (c.from === c.today ? 'Today' : 'Selected day') : c.view === 'week' ? 'Whole week' : 'Whole range'}</p>
          <h2>{title}</h2>
          {!single && <p className="section-hint" style={{ margin: '-4px 0 4px' }}>Totals for {Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86400000) + 1} days. Click a day for that day alone.</p>}
          <ul className="cal-side-list">
            {kinds.map((k) => {
              const items = sideItems(k.key, d)
              return (
                <li key={k.key}>
                  <a href={`#cal-${SECTION[k.key]}`} className="cal-side-row"><i className={`tone-${k.tone}`} /><span>{k.label}</span><b className={`tone-text-${k.tone}`}>{sel[k.key]}</b></a>
                  {items.length > 0 && <ul className="cal-side-names">{items.slice(0, 4).map((x, j) => <li key={j}>{x}</li>)}{items.length > 4 && <li className="more"><a href={`#cal-${SECTION[k.key]}`}>+{items.length - 4} more</a></li>}</ul>}
                </li>
              )
            })}
          </ul>
          {c.show.payments && <div className="cal-side-total"><span>Collected</span><strong>{inr(sel.collected)}</strong></div>}
          <p className="section-hint" style={{ margin: '10px 0 0' }}>Click a count to jump to its full list below.</p>
        </aside>
      </div>

      {c.show.calls && (
        <Section id="calls" title="Calls made" hint="Every call in the days listed: new random calls and follow-up calls to people already called. Status and remark are what was noted on the call." count={d.calls.length}>
          <thead><tr><th>Time</th><th>Name</th><th>Phone</th><th>Course</th><th>Type</th><th>Status</th><th>By</th><th>Remark</th></tr></thead>
          <tbody>{d.calls.map((r, i) => <tr key={i}><td>{time(r.at)}</td><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td><Badge tone={r.followUp ? 'sky' : 'blue'}>{r.followUp ? 'Follow-up call' : 'New call'}</Badge></td><td>{r.status ?? '—'}</td><td>{r.by ?? '—'}</td><td className="cal-remark">{r.remark ?? '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.leads && (
        <Section id="leads" title="New leads" hint="Leads added in the days listed that have not visited the branch yet. Open one to call or update it." count={d.leads.length}>
          <thead><tr><th>Time</th><th>Lead</th><th>Name</th><th>Phone</th><th>Course</th><th>Source</th><th>Status</th><th>Assigned to</th></tr></thead>
          <tbody>{d.leads.map((r) => <tr key={r.enquiryNo}><td>{time(r.at)}</td><td><Link className="id-text" href={`/enquiries/update?q=${encodeURIComponent(r.enquiryNo)}`}>{r.enquiryNo}</Link></td><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td>{r.source ?? '—'}</td><td>{st(r.status)}</td><td>{r.assignedTo ?? '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.webLeads && (
        <Section id="web" title="Website leads" hint="Forms filled on the institute websites in the days listed. “Waiting” means no branch has it yet — send it from Web Leads." count={d.webLeads.length}>
          <thead><tr><th>Time</th><th>Name</th><th>Phone</th><th>Course</th><th>Website</th><th>Lead</th></tr></thead>
          <tbody>{d.webLeads.map((r, i) => <tr key={i}><td>{time(r.at)}</td><td><strong>{r.name}</strong></td><td>{r.phone ?? '—'}</td><td>{r.course ?? '—'}</td><td>{r.site}</td><td>{r.enquiryNo ? <Link className="id-text" href={`/enquiries/update?q=${encodeURIComponent(r.enquiryNo)}`}>{r.enquiryNo}</Link> : r.waiting ? <Badge tone="amber">Waiting</Badge> : '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.leads && (
        <Section id="visits" title="Visits" hint="People who came to the branch in the days listed (visited enquiries)." count={d.visits.length}>
          <thead><tr><th>Time</th><th>Enquiry</th><th>Name</th><th>Phone</th><th>Course</th><th>Status</th><th>Counsellor</th></tr></thead>
          <tbody>{d.visits.map((r) => <tr key={r.enquiryNo}><td>{time(r.at)}</td><td><Link className="id-text" href={`/enquiries/update?q=${encodeURIComponent(r.enquiryNo)}`}>{r.enquiryNo}</Link></td><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td>{st(r.status)}</td><td>{r.assignedTo ?? '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {(c.show.leads || c.show.calls) && (
        <Section id="followups" title="Follow-ups due" hint="Leads and calls whose next follow-up date is this day and that are still open (not joined, not dead). Call these people in the days listed." count={d.followUps.length}>
          <thead><tr><th>From</th><th>Ref</th><th>Name</th><th>Phone</th><th>Course</th><th>Status</th><th>Assigned to</th></tr></thead>
          <tbody>{d.followUps.map((r, i) => <tr key={i}><td><Badge tone={r.kind === 'Lead' ? 'violet' : 'blue'}>{r.kind}</Badge></td><td>{r.kind === 'Lead' ? <Link className="id-text" href={`/enquiries/update?q=${encodeURIComponent(r.ref)}`}>{r.ref}</Link> : r.ref}</td><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td>{st(r.status)}</td><td>{r.assignedTo ?? '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.calls && (
        <Section id="expected" title="Expected visits" hint="Callers who said they would come to the branch on the days listed." count={d.expectedVisits.length}>
          <thead><tr><th>Name</th><th>Phone</th><th>Course</th><th>Status</th><th>Assigned to</th></tr></thead>
          <tbody>{d.expectedVisits.map((r, i) => <tr key={i}><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td>{r.status ?? '—'}</td><td>{r.assignedTo ?? '—'}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.registrations && (
        <Section id="registrations" title="Registrations" hint="Students registered in the days listed, with the total course fee agreed." count={d.registrations.length}>
          <thead><tr><th>Reg. no.</th><th>Name</th><th>Phone</th><th>Course</th><th>Status</th><th style={{ textAlign: 'right' }}>Course fee</th></tr></thead>
          <tbody>{d.registrations.map((r) => <tr key={r.regNo}><td><span className="id-text">{r.regNo}</span></td><td><strong>{r.name}</strong></td><td>{r.phone}</td><td>{r.course ?? '—'}</td><td>{st(r.status)}</td><td style={{ textAlign: 'right' }}>{inr(r.fee)}</td></tr>)}</tbody>
        </Section>
      )}
      {c.show.payments && (
        <Section id="payments" title="Payments received" hint="Fee payments received in the days listed. Open a receipt to print or share it." count={d.payments.length}>
          <thead><tr><th>Time</th><th>Receipt</th><th>Student</th><th>Reg. no.</th><th>Mode</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>{d.payments.map((r) => <tr key={r.receiptNo}><td>{time(r.at)}</td><td><a className="id-text" href={`/receipts/${encodeURIComponent(r.receiptNo)}`} target="_blank" rel="noreferrer">{r.receiptNo}</a></td><td><strong>{r.name}</strong></td><td>{r.regNo}</td><td>{r.mode || '—'}</td><td style={{ textAlign: 'right' }}><strong>{inr(r.amount)}</strong></td></tr>)}</tbody>
          {d.payments.length > 0 && <tfoot><tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 800 }}>{inr(d.payments.reduce((n, p) => n + p.amount, 0))}</td></tr></tfoot>}
        </Section>
      )}
    </section>
  )
}

function Section({ id, title, hint, count, children }: { id: string; title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <div className="panel table-panel" id={`cal-${id}`}>
      <div className="panel-header"><div><h2>{title} <span className="cal-count">{count >= 300 ? '300+' : count}</span></h2><span>{hint}{count >= 300 ? ' Showing the first 300 — pick a shorter range or one day for the rest.' : ''}</span></div></div>
      {count ? <div className="table-scroll"><table>{children}</table></div> : <p className="section-hint" style={{ margin: 0, padding: '4px 0 8px' }}>Nothing in the days listed.</p>}
    </div>
  )
}

/** Which list below each count opens. */
const SECTION: Record<keyof DayCounts, string> = { calls: 'calls', followUpCalls: 'calls', leads: 'leads', webLeads: 'web', visits: 'visits', followUpsDue: 'followups', expectedVisits: 'expected', registrations: 'registrations', payments: 'payments', collected: 'payments' }

/** The first names behind a count, for the side panel. */
function sideItems(k: keyof DayCounts, d: CalendarData['detail']): string[] {
  switch (k) {
    case 'calls': return d.calls.filter((r) => !r.followUp).map((r) => `${r.name} · ${r.status ?? 'called'}`)
    case 'followUpCalls': return d.calls.filter((r) => r.followUp).map((r) => `${r.name} · ${r.status ?? 'called'}`)
    case 'leads': return d.leads.map((r) => `${r.name} · ${r.course ?? r.enquiryNo}`)
    case 'webLeads': return d.webLeads.map((r) => `${r.name} · ${r.site}`)
    case 'visits': return d.visits.map((r) => `${r.name} · ${r.course ?? r.enquiryNo}`)
    case 'followUpsDue': return d.followUps.map((r) => `${r.name} · ${r.phone}`)
    case 'expectedVisits': return d.expectedVisits.map((r) => `${r.name} · ${r.phone}`)
    case 'registrations': return d.registrations.map((r) => `${r.name} · ${r.course ?? r.regNo}`)
    case 'payments': return d.payments.map((r) => `${r.name} · ${inr(r.amount)}`)
    default: return []
  }
}

const Badge = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`cal-badge tone-${tone}`}>{children}</span>
