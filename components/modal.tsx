'use client'
// The one popup frame of the panel. It is drawn on the page itself (a portal into <body>), so a popup opened from
// inside a table (whose action column is sticky) or a scrolling card is never clipped or covered by it.
import { useEffect, useState, useSyncExternalStore, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DateInput } from '@/components/date-input'

const noSubscribe = () => () => {}
/** True in the browser once the page is live (false on the server and while hydrating, so both render the same). */
const useClient = () => useSyncExternalStore(noSubscribe, () => true, () => false)

/** Puts its children on the page itself (see above). */
export function OnPage({ children }: { children: React.ReactNode }) {
  return useClient() ? createPortal(children, document.body) : <>{children}</>
}

/** Open popups, oldest first: Escape closes only the one opened last (a confirm over a details popup, say). */
const open: { close: () => void }[] = []
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open.length) { e.preventDefault(); open[open.length - 1].close() } })
function useEscape(onClose: () => void) {
  const [entry] = useState(() => ({ close: onClose }))
  entry.close = onClose // always the latest
  useEffect(() => {
    open.push(entry)
    return () => { open.splice(open.indexOf(entry), 1) }
  }, [entry])
}

export function Modal({ title, onClose, wide, className, children }: { title: string; onClose: () => void; wide?: boolean; className?: string; children: React.ReactNode }) {
  useEscape(onClose)
  return (
    <OnPage>
      <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
        <div className={className ?? `modal-card step-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
          <div className="modal-head"><div><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
          {children}
        </div>
      </div>
    </OnPage>
  )
}

export const Err = ({ msg }: { msg: string }) => (msg ? <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{msg}</p> : null)

const dayIso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const dayName = (o: number) => (o === 0 ? 'Today' : o === 1 ? 'Tomorrow' : o === -1 ? 'Yesterday' : o > 0 ? `In ${o} days` : `${-o} days ago`)

/** A date field with one-tap choices. `picks` are day offsets from today (-1 = yesterday, 1 = tomorrow). `time` also asks the time. */
export function QuickDate({ label, value, onChange, picks, required, time, max }: {
  label: string; value: string; onChange: (v: string) => void; picks: number[]; required?: boolean; time?: boolean; max?: string
}) {
  const pick = (o: number) => onChange(time ? `${dayIso(o)}T${value.slice(11, 16) || '10:00'}` : dayIso(o))
  return (
    <label>{label}{required && <span className="required-mark">*</span>}
      <DateInput type={time ? 'datetime-local' : 'date'} value={value} required={required} max={max} onChange={(e) => onChange(e.target.value)} />
      <span className="quick-picks">{picks.map((o) => <button type="button" key={o} className={value.slice(0, 10) === dayIso(o) ? 'on' : ''} onClick={() => pick(o)}>{dayName(o)}</button>)}</span>
    </label>
  )
}

/** "Are you sure?" before deleting. onConfirm returns an error message, or nothing when it worked. */
export function ConfirmDelete({ title, text, onClose, onConfirm }: { title: string; text: string; onClose: () => void; onConfirm: () => Promise<string | void> }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={title} onClose={onClose}>
      <p className="section-hint" style={{ margin: 0, fontSize: 13, whiteSpace: 'normal' }}>{text}</p>
      <Err msg={error} />
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="button danger" disabled={pending} onClick={() => start(async () => { const err = await onConfirm(); if (err) setError(err) })}>{pending ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>
  )
}
