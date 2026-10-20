'use client'
// Leaderboards over a period: telecallers / counselors by conversion, trainers by their index, students by ranking.
// The period (and the students' batch) live in the address; each person's own row is picked out.
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { DateInput } from '@/components/date-input'
import { ExportButton } from '@/components/export-button'
import type { Leaderboards } from '@/modules/reports/leaderboards'
import { MIN_LEADS } from '@/modules/reports/leaderboard-rules'

const long = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const shiftDays = (k: string, n: number) => new Date(Date.parse(`${k}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const lastMonth = (today: string) => {
  const [y, m] = today.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 2, 1)), last = new Date(Date.UTC(y, m - 1, 0))
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)] as const
}
const MEDAL = ['#d4a017', '#9aa3b2', '#b87333']

function Rank({ n }: { n: number }) {
  return n < 3
    ? <span aria-label={`Rank ${n + 1}`} style={{ display: 'inline-grid', placeItems: 'center', width: 26, height: 26, borderRadius: 999, background: MEDAL[n], color: '#fff', fontWeight: 700, fontSize: 12.5 }}>{n + 1}</span>
    : <span style={{ display: 'inline-block', width: 26, textAlign: 'center', color: 'var(--muted)', fontWeight: 600 }}>{n + 1}</span>
}

/** A percentage with a thin bar under it; '—' when there is nothing to measure. */
function Pct({ v, sub }: { v: number | null; sub?: string }) {
  if (v == null) return <span style={{ color: 'var(--faint)' }}>—</span>
  return (
    <div style={{ minWidth: 90 }}>
      <strong>{v}%</strong>{sub && <small style={{ marginLeft: 6 }}>{sub}</small>}
      <div style={{ height: 4, borderRadius: 4, background: 'var(--tint)', marginTop: 4 }}><div style={{ width: `${Math.min(v, 100)}%`, height: '100%', borderRadius: 4, background: v >= 75 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444' }} /></div>
    </div>
  )
}

export function LeaderboardsPanel({ data, from, to, today, batch, me, scope, showBranch }: {
  data: Leaderboards; from: string; to: string; today: string; batch: string | null; me: string; scope: string; showBranch: boolean
}) {
  const router = useRouter()
  const path = usePathname()
  const go = (f: string, t: string, b: string | null = batch) => router.push(`${path}?${new URLSearchParams({ from: f, to: t, ...(b ? { batch: b } : {}) })}`)
  const tabs = ([['admissions', 'Telecallers & counselors', data.admissions], ['trainers', 'Trainers', data.trainers], ['students', 'Students', data.students]] as const).filter((t) => t[2] != null)
  const [tab, setTab] = useState<string>(tabs[0]?.[0] ?? 'admissions')
  const [lmFrom, lmTo] = lastMonth(today)
  const presets: [string, string, string][] = [
    ['This month', today.slice(0, 8) + '01', today], ['Last month', lmFrom, lmTo], ['Last 30 days', shiftDays(today, -29), today], ['Last 3 months', shiftDays(today, -89), today],
  ]
  const active = presets.find(([, f, t]) => f === from && t === to)?.[0]
  const mine = (id: string) => (id === me ? { background: 'var(--tint)' } : undefined)
  const empty = (cols: number, text: string) => <tr><td colSpan={cols} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{text}</td></tr>

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reports / Leaderboards</p>
          <h1>Leaderboards</h1>
          <p className="subheading">Who led from {long(from)} to {long(to)}{scope ? ` · ${scope}` : ''}. Worked out live from the records; your own row is shaded.</p>
        </div>
        {/* the board on screen, for the same period (and batch) */}
        <div className="heading-actions"><ExportButton list={`leaderboard-${tab}`} query={{ from, to, f: batch ? { batch } : {} }} /></div>
      </div>

      <div className="panel col-filters">
        <div className="col-presets" role="group" aria-label="Period">{presets.map(([label, f, t]) => <button key={label} type="button" className={active === label ? 'on' : ''} onClick={() => go(f, t)}>{label}</button>)}</div>
        <div className="col-controls">
          <label>From<DateInput type="date" value={from} max={today} onChange={(e) => e.target.value && go(e.target.value, e.target.value > to ? e.target.value : to)} /></label>
          <label>To<DateInput type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && go(from, e.target.value)} /></label>
        </div>
      </div>

      {tabs.length > 1 && <div className="seg" role="tablist" style={{ marginBottom: 14 }}>{tabs.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>}

      {tab === 'admissions' && data.admissions && (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Telecallers & counselors — conversion</h2><span>Leads given to each person in the period (or added by them when not given to anyone), and how many came to visit and joined. Conversion = joined ÷ leads; it ranks first once someone has {MIN_LEADS} leads or more.</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th style={{ width: 50 }}>#</th><th>Name</th><th>Leads</th><th>Visited</th><th>Joined</th><th>Conversion</th><th>Follow-ups</th></tr></thead>
            <tbody>
              {data.admissions.map((r, i) => (
                <tr key={r.userId} style={mine(r.userId)}>
                  <td><Rank n={i} /></td>
                  <td><strong>{r.name}</strong>{showBranch && r.branch && <small>{r.branch}</small>}</td>
                  <td>{r.leads}</td>
                  <td>{r.visited}<small>{r.leads ? `${Math.round((r.visited / r.leads) * 100)}% of leads` : ''}</small></td>
                  <td><strong className="text-green">{r.joined}</strong></td>
                  <td><Pct v={r.conversion} sub={r.leads < MIN_LEADS ? `(${r.leads} lead${r.leads === 1 ? '' : 's'})` : undefined} /></td>
                  <td>{r.followUps}</td>
                </tr>
              ))}
              {!data.admissions.length && empty(7, 'No leads in this period.')}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'trainers' && data.trainers && (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Trainers — index out of 100</h2><span>From their batches: attendance (40), test scores (30) and syllabus covered on running batches (20), over the parts that have data and scaled to 90 — plus up to 10 for help given to students (2 per request done).</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th style={{ width: 50 }}>#</th><th>Trainer</th><th>Index</th><th>Attendance</th><th>Test average</th><th>Syllabus</th><th>Help done</th><th>Batches</th></tr></thead>
            <tbody>
              {data.trainers.map((r, i) => (
                <tr key={r.userId} style={mine(r.userId)}>
                  <td><Rank n={i} /></td>
                  <td><strong>{r.name}</strong>{showBranch && r.branch && <small>{r.branch}</small>}</td>
                  <td>{r.index == null ? <span style={{ color: 'var(--faint)' }}>No data yet</span> : <strong style={{ fontSize: 16 }}>{r.index}</strong>}</td>
                  <td><Pct v={r.attendance} sub={r.sessions ? `${r.sessions} classes` : undefined} /></td>
                  <td><Pct v={r.testAvg} sub={r.tests ? `${r.tests} tests` : undefined} /></td>
                  <td><Pct v={r.syllabus} /></td>
                  <td>{r.helpDone}</td>
                  <td>{r.batches}</td>
                </tr>
              ))}
              {!data.trainers.length && empty(8, 'No trainer has a batch yet.')}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'students' && data.students && (
        <div className="panel table-panel">
          <div className="panel-header">
            <div><h2>Students — ranking</h2><span>Attendance and average test score in the period, half each (or whichever there is). The top 100.</span></div>
            <label className="col-controls" style={{ margin: 0 }}>Batch
              <select value={batch ?? ''} onChange={(e) => go(from, to, e.target.value || null)}>
                <option value="">All batches</option>
                {data.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          </div>
          <div className="table-scroll"><table>
            <thead><tr><th style={{ width: 50 }}>#</th><th>Student</th><th>Course / batch</th><th>Score</th><th>Attendance</th><th>Test average</th></tr></thead>
            <tbody>
              {data.students.map((r, i) => (
                <tr key={r.registrationId}>
                  <td><Rank n={i} /></td>
                  <td><strong>{r.name}</strong><small>{r.regNo}{showBranch && r.branch ? ` · ${r.branch}` : ''}</small></td>
                  <td>{r.course}{r.batch && <small>{r.batch}</small>}</td>
                  <td><strong style={{ fontSize: 16 }}>{r.score}</strong></td>
                  <td><Pct v={r.attendance} sub={r.sessions ? `${r.sessions} classes` : undefined} /></td>
                  <td><Pct v={r.testAvg} sub={r.tests ? `${r.tests} tests` : undefined} /></td>
                </tr>
              ))}
              {!data.students.length && empty(6, 'No attendance or test marks in this period.')}
            </tbody>
          </table></div>
        </div>
      )}
    </section>
  )
}
