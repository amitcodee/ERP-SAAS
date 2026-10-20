'use client'
// A date (or date + time) field with the panel's own calendar instead of the browser's pop-up.
// The real <input type="date"> stays underneath, so typing, form names, "required" and every onChange keep working;
// only the pop-up is ours. Use it exactly like <input type="date" /> or <input type="datetime-local" />.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max'> & { type: 'date' | 'datetime-local'; min?: string; max?: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const todayIso = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth(), n.getDate()) }

/** Sets the value the way typing would, so React's onChange (and plain form submission) both see it. */
function setNative(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

export function DateInput({ type, className, min, max, disabled, ...rest }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const [view, setView] = useState({ y: 2000, m: 0 }) // the month on show
  const [, redraw] = useState(0) // the picked value lives in the input itself
  const withTime = type === 'datetime-local'

  const value = () => input.current?.value ?? ''
  const day = value().slice(0, 10)
  const time = value().slice(11, 16)
  const minDay = min?.slice(0, 10), maxDay = max?.slice(0, 10)
  const off = (d: string) => (!!minDay && d < minDay) || (!!maxDay && d > maxDay)

  const show = () => {
    if (disabled || rest.readOnly) return
    const base = /^\d{4}-\d{2}-\d{2}/.test(value()) ? value() : todayIso()
    setView({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 })
    setOpen(true)
  }
  const write = (d: string, t = time) => {
    if (!input.current) return
    setNative(input.current, d ? (withTime ? `${d}T${t || `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`}` : d) : '')
    redraw((n) => n + 1)
  }

  // Place the calendar under the field (or above it when there is no room), and keep it on screen.
  useLayoutEffect(() => {
    if (!open || !input.current) return
    const r = input.current.getBoundingClientRect()
    const h = pop.current?.offsetHeight ?? 360, w = pop.current?.offsetWidth ?? 300
    const top = r.bottom + 6 + h > window.innerHeight && r.top - 6 - h > 0 ? r.top - 6 - h : r.bottom + 6
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top })
  }, [open, view.m, view.y])

  useEffect(() => {
    if (!open) return
    const away = (e: Event) => { const t = e.target as Node; if (!pop.current?.contains(t) && !input.current?.parentElement?.contains(t)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const moved = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', moved)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true); window.removeEventListener('scroll', moved, true); window.removeEventListener('resize', moved) }
  }, [open])

  // The 6 weeks on show, Monday first, with the days of the months either side.
  const first = new Date(view.y, view.m, 1)
  const lead = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(view.y, view.m, 1 - lead + i); return { d: iso(d.getFullYear(), d.getMonth(), d.getDate()), n: d.getDate(), other: d.getMonth() !== view.m } })
  const step = (by: number) => setView((v) => { const d = new Date(v.y, v.m + by, 1); return { y: d.getFullYear(), m: d.getMonth() } })
  const years = Array.from({ length: 111 }, (_, i) => new Date().getFullYear() + 10 - i)
  const today = todayIso()

  return (
    <span className={`date-field ${className ?? ''}`}>
      {/* The browser's own pop-up is switched off (see .date-field in globals.css; Firefox opens it on click, hence preventDefault). */}
      <input ref={input} type={type} min={min} max={max} disabled={disabled} {...rest} onClick={(e) => { e.preventDefault(); rest.onClick?.(e); show() }} />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="Open calendar" onClick={() => (open ? setOpen(false) : show())}><CalendarDays size={17} /></button>
      {open && createPortal(
        <div ref={pop} className="cal" role="dialog" aria-label="Choose a date" style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }} onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'SELECT') e.preventDefault() }}>
          <div className="cal-head">
            <button type="button" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
            <div className="cal-title">
              <select value={view.m} aria-label="Month" onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>
              <select value={view.y} aria-label="Year" onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
            <button type="button" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={16} /></button>
          </div>
          <div className="cal-grid cal-days">{DAYS.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-grid">
            {cells.map((c) => (
              <button type="button" key={c.d} disabled={off(c.d)} aria-pressed={c.d === day} aria-label={c.d}
                className={`${c.other ? 'other' : ''} ${c.d === today ? 'today' : ''} ${c.d === day ? 'on' : ''}`}
                onClick={() => { write(c.d); if (!withTime) setOpen(false) }}>{c.n}</button>
            ))}
          </div>
          {withTime && (
            <div className="cal-time">
              <span>Time</span>
              <select value={time.slice(0, 2) || ''} aria-label="Hour" onChange={(e) => write(day || today, `${e.target.value}:${time.slice(3, 5) || '00'}`)}><option value="" disabled>HH</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={pad(h)}>{pad(h)}</option>)}</select>
              <b>:</b>
              <select value={time.slice(3, 5) || ''} aria-label="Minute" onChange={(e) => write(day || today, `${time.slice(0, 2) || '00'}:${e.target.value}`)}><option value="" disabled>MM</option>{Array.from({ length: 60 }, (_, m) => <option key={m} value={pad(m)}>{pad(m)}</option>)}</select>
            </div>
          )}
          <div className="cal-foot">
            <button type="button" onClick={() => { write(''); setOpen(false) }}>Clear</button>
            <button type="button" disabled={off(today)} onClick={() => { write(today); setView({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); if (!withTime) setOpen(false) }}>Today</button>
            {withTime && <button type="button" className="done" onClick={() => setOpen(false)}>Done</button>}
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
