'use client'
// A ticket's rating: stars to show, and the form whoever raised it uses (help desk, My Tickets, student portal).
import { useState, useTransition } from 'react'
import { Star } from 'lucide-react'
import { rateTicketAction } from '@/app/actions'
import type { TicketRow } from '@/modules/support/service'

export function Stars({ value, onPick, size = 16 }: { value: number; onPick?: (n: number) => void; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }} aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => onPick
        ? <button key={n} type="button" onClick={() => onPick(n)} aria-label={`${n} star${n === 1 ? '' : 's'}`} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }}><Star size={size} fill={n <= value ? '#f59e0b' : 'none'} color="#f59e0b" /></button>
        : <Star key={n} size={size} fill={n <= value ? '#f59e0b' : 'none'} color="#f59e0b" />)}
    </span>
  )
}

/** Whoever raised the ticket rates the help (1-5 stars, with a word), once it is answered. */
export function Rate({ t, onChanged }: { t: Pick<TicketRow, 'id' | 'rating' | 'ratingNote'>; onChanged: (m: string) => void }) {
  const [stars, setStars] = useState(t.rating ?? 0)
  const [note, setNote] = useState(t.ratingNote ?? '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => { const r = await rateTicketAction(t.id, stars, note || null); if (!r.ok) return setError(r.error); onChanged('Thank you for rating!') })
  return (
    <div className="fee-note" style={{ margin: '10px 0', display: 'grid', gap: 8 }}>
      <strong>{t.rating ? 'Your rating' : 'How was the help?'}</strong>
      <Stars value={stars} onPick={setStars} size={22} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A word about it (optional)" maxLength={500} />
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div><button type="button" className="button secondary" disabled={pending || !stars || (stars === t.rating && note === (t.ratingNote ?? ''))} onClick={save}>{t.rating ? 'Update rating' : 'Send rating'}</button></div>
    </div>
  )
}
