'use client'
// Seminars & Workshops: every event of the branch (head office: of every branch) with how many signed up, passed and
// got a certificate, and whether it is taking sign-ups now. Opens the event; New makes one.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Award, CalendarDays, Plus, Radio, Search, Users } from 'lucide-react'
import type { EventRow } from '@/modules/events/service'

const KIND: Record<string, string> = { seminar: 'Seminar', workshop: 'Workshop', webinar: 'Webinar', bootcamp: 'Bootcamp', competition: 'Competition', other: 'Event' }
export const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
/** Live = taking sign-ups now. */
export const isLive = (e: Pick<EventRow, 'isOpen' | 'closesAt'>) => e.isOpen && (!e.closesAt || new Date(e.closesAt) > new Date())

export function EventsPanel({ events, canCreate, showBranch }: { events: EventRow[]; canCreate: boolean; showBranch: boolean }) {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const list = useMemo(() => events.filter((e) => (!kind || e.kind === kind) && (!q || `${e.title} ${e.speaker ?? ''} ${e.venue ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [events, q, kind])
  const live = events.filter(isLive).length
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Events / Seminars &amp; Workshops</p>
          <h1>Seminars &amp; Workshops</h1>
          <p className="subheading">Seminars, workshops, webinars and other events. Each has a sign-up link and QR code: people fill in their details, take the quiz when there is one, and get their certificate by e-mail.</p>
        </div>
        {canCreate && <Link href="/events/new" className="button primary"><Plus size={15} /> New event</Link>}
      </div>
      <div className="table-summary" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className="status-badge status-blue"><CalendarDays size={13} /> {events.length} event{events.length === 1 ? '' : 's'}</span>
        <span className="status-badge status-green"><Radio size={13} /> {live} taking sign-ups</span>
        <span className="status-badge status-amber"><Users size={13} /> {events.reduce((n, e) => n + e.joined, 0).toLocaleString('en-IN')} people</span>
        <span className="status-badge status-blue"><Award size={13} /> {events.reduce((n, e) => n + e.certified, 0).toLocaleString('en-IN')} certificates</span>
      </div>
      <div className="panel table-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div><h2>Events</h2><span>Newest first</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="table-search" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 999, height: 38, background: '#fff' }}><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, speaker, venue" aria-label="Search events" /></label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type" style={{ height: 38, borderRadius: 999, border: '1px solid var(--line)', padding: '0 12px' }}><option value="">Every type</option>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Event</th><th>When</th>{showBranch && <th>Branch</th>}<th>Quiz</th><th>Certificate</th><th>Signed up</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td><Link href={`/events/${e.id}`} style={{ fontWeight: 700, color: 'var(--ink)' }}>{e.title}</Link><div className="section-hint">{KIND[e.kind]}{e.speaker ? ` · ${e.speaker}` : ''}</div></td>
                <td>{fmtWhen(e.startsAt)}<div className="section-hint">{e.mode === 'online' ? 'Online' : e.venue ?? (e.mode === 'hybrid' ? 'Both' : '')}</div></td>
                {showBranch && <td>{e.branch ?? 'Head office'}</td>}
                <td>{e.hasQuiz ? `${e.questions} question${e.questions === 1 ? '' : 's'}` : '—'}</td>
                <td>{e.certificate ? (e.design ?? <span className="status-badge status-red">No design</span>) : '—'}</td>
                <td><b>{e.joined}</b>{e.hasQuiz ? <div className="section-hint">{e.passed} passed</div> : null}{e.certificate ? <div className="section-hint">{e.certified} certificates</div> : null}</td>
                <td>{isLive(e) ? <span className="status-badge status-green"><span className="status-dot" />Live</span> : <span className="status-badge status-red"><span className="status-dot" />Closed</span>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={showBranch ? 7 : 6} style={{ textAlign: 'center', padding: 28 }} className="section-hint">{events.length ? 'No event matches.' : canCreate ? 'No events yet: create the first one.' : 'No events yet.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  )
}
