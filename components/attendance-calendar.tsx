'use client'
// One student's attendance as a month calendar: each class day marked present (green) or absent (red) by the trainer,
// or a class day of their batch not marked yet (grey). Opened from the Students list.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { studentAttendanceAction } from '@/app/actions'
import { Err } from '@/components/modal'
import { Modal } from '@/components/registration-modals'
import type { StudentAttendance } from '@/modules/academics/service'
import { monthIST, todayIST } from '@/lib/ist'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const shift = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7) }

export function AttendanceCalendar({ registrationId, title, onClose }: { registrationId: string; title: string; onClose: () => void }) {
  const [month, setMonth] = useState(() => monthIST())
  const [d, setD] = useState<StudentAttendance | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    setLoading(true)
    studentAttendanceAction(registrationId, month).then((r) => {
      if (!live) return
      setLoading(false)
      if (r.ok) { setD(r.data ?? null); setError(r.data ? '' : 'Student not found') } else setError(r.error)
    })
    return () => { live = false }
  }, [registrationId, month])

  const [y, mo] = month.split('-').map(Number)
  const first = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7 // blanks before the 1st (weeks start Monday)
  const count = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const today = todayIST()
  const inMonth = d?.month === month ? d.days : []
  const present = inMonth.filter((x) => x.present === true).length
  const absent = inMonth.filter((x) => x.present === false).length
  const unmarked = inMonth.filter((x) => x.present === null).length

  return (
    <Modal wide title={`Attendance — ${title}`} onClose={onClose}>
      <Err msg={error} />
      {d && (
        <div className="att-head">
          <div>
            {d.batches.length
              ? d.batches.map((b) => <div key={b.name} className="att-batch"><strong>{b.name}</strong> · Trainer: {b.trainer ?? 'not set'}{b.days?.length ? ` · ${b.days.map((x) => WEEK[x - 1]).join(', ')}` : ''}{b.time ? ` · ${b.time}` : ''}</div>)
              : <div className="att-batch">Not in a batch yet: the academic manager adds students to a batch, and its trainer marks attendance.</div>}
          </div>
          <div className="att-total"><strong>{d.total.pct}%</strong><span>{d.total.present} of {d.total.sessions} classes overall</span></div>
        </div>
      )}
      <div className="att-nav">
        <button type="button" className="filter-button icon-only" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <strong>{MONTHS[mo - 1]} {y}</strong>
        <button type="button" className="filter-button icon-only" onClick={() => setMonth(shift(month, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <span className="att-legend"><i className="p" /> Present {present} <i className="a" /> Absent {absent} <i className="u" /> Not marked {unmarked}</span>
      </div>
      <div className={`att-grid${loading ? ' loading' : ''}`}>
        {WEEK.map((w) => <div key={w} className="att-wd">{w}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`
          const marks = inMonth.filter((x) => x.date === iso)
          const state = marks.some((x) => x.present === false) ? 'a' : marks.some((x) => x.present === true) ? 'p' : marks.length ? 'u' : ''
          const tip = marks.map((x) => `${x.batch}: ${x.present === true ? 'Present' : x.present === false ? 'Absent' : 'Not marked yet'}${x.markedBy ? ` (marked by ${x.markedBy})` : x.trainer ? ` · trainer ${x.trainer}` : ''}${x.topic ? ` · ${x.topic}` : ''}`).join('\n')
          return (
            <div key={iso} className={`att-day ${state}${iso === today ? ' today' : ''}`} title={tip || undefined}>
              <span>{i + 1}</span>
              {state && <small>{state === 'p' ? 'Present' : state === 'a' ? 'Absent' : 'Not marked'}</small>}
            </div>
          )
        })}
      </div>
      <p className="section-hint" style={{ margin: '10px 0 0' }}>Marked by the trainer of the student’s batch on the Attendance page. Point at a day for the batch, who marked it and the topic.</p>
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
    </Modal>
  )
}
