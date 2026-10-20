'use client'
// Weekly timetable built from batch schedules (days + times). Shared by staff (Timetable screen) and the student portal.
import type { TimetableEntry } from '@/modules/academics/service'
import css from './timetable.module.css'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export function WeekGrid({ entries, showTrainer = true }: { entries: TimetableEntry[]; showTrainer?: boolean }) {
  const scheduled = entries.filter((e) => e.days.length && e.start)
  const unscheduled = entries.filter((e) => !(e.days.length && e.start))
  const today = ((new Date().getDay() + 6) % 7) + 1
  return (
    <>
      <div className={css.grid}>
        {WEEKDAYS.map((label, i) => {
          const day = i + 1
          const items = scheduled.filter((e) => e.days.includes(day)).sort((a, b) => a.start!.localeCompare(b.start!))
          return (
            <div key={label} className={`${css.day} ${day === today ? css.today : ''}`}>
              <div className={css.head}>{label}</div>
              {items.length === 0 && <div className={css.empty}>—</div>}
              {items.map((e) => (
                <div key={e.batchId} className={css.slot}>
                  <strong>{e.start}–{e.end}</strong>
                  <span>{e.name}</span>
                  <em>{[e.course, e.room && `Room ${e.room}`, showTrainer && e.trainer].filter(Boolean).join(' · ')}</em>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {unscheduled.length > 0 && (
        <p className="section-hint" style={{ marginTop: 12 }}>
          No fixed days/times yet: {unscheduled.map((e) => `${e.name}${e.timing ? ` (${e.timing})` : ''}`).join(', ')}
        </p>
      )}
    </>
  )
}

/** Day checkboxes for the batch form (posts `days` = 1..7). */
export function DayPicks() {
  return <div className={css.dayPicks}>{WEEKDAYS.map((d, i) => <label key={d}><input type="checkbox" name="days" value={i + 1} />{d}</label>)}</div>
}

export function TimetablePanel({ entries, isTrainer }: { entries: TimetableEntry[]; isTrainer: boolean }) {
  return (
    <section className="page-container">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Academics / Timetable</p>
          <h1>Timetable</h1>
          <p className="subheading">{isTrainer ? 'Your batches this week.' : 'Every active batch this week. Set days and times when creating a batch (Attendance → New batch).'}</p>
        </div>
      </div>
      <div className="panel">{entries.length ? <WeekGrid entries={entries} /> : <p style={{ fontSize: 11, color: '#8b98aa', margin: 0 }}>No active batches yet.</p>}</div>
    </section>
  )
}
