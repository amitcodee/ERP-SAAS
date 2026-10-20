'use client'
import { useEffect, useId, useState } from 'react'
import { Search, X } from 'lucide-react'

/** One match: `ref` is its number (enquiry no., registration no.), `tag` an optional label such as "Visited". */
export type EnquiryHit = { id: string; ref: string; name: string; phone: string; fee: number | null; tag?: string }

const inr = (paise: number | null) => (paise ? `₹${(paise / 100).toLocaleString('en-IN')}` : 'No fee yet')

/** One search box: type a name, phone or enquiry no. and the matching students are listed under it to pick from. */
export function EnquirySearch<H extends EnquiryHit>({ search, onPick, disabled, searchKey = '', placeholder = "Type the student's name, phone or enquiry no.", label = "Search the student's lead or enquiry", none = 'No lead or enquiry found' }: {
  search: (q: string) => Promise<H[]>
  onPick: (id: string, hit: H) => void
  disabled?: boolean
  /** Changing it (e.g. another filter) searches again. */
  searchKey?: string
  placeholder?: string
  label?: string
  none?: string
}) {
  const listId = useId()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<H[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const term = q.trim()

  useEffect(() => {
    if (!term) { setHits([]); setBusy(false); return }
    let live = true
    setBusy(true)
    const t = setTimeout(async () => {
      const r = await search(term).catch(() => [])
      if (live) { setHits(r); setActive(0); setBusy(false) }
    }, 250)
    return () => { live = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, searchKey])

  const choose = (h: H) => { setOpen(false); setQ(''); onPick(h.id, h) }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); if (open && hits[active]) choose(hits[active]) } // never submits the form
    else if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const show = open && !!term
  return (
    <div className="enq-search">
      <Search size={18} aria-hidden />
      <input
        type="search" value={q} disabled={disabled} autoComplete="off" placeholder={placeholder}
        role="combobox" aria-label={label} aria-expanded={show} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={show && hits[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey}
      />
      {q && <button type="button" className="enq-search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => setQ('')}><X size={16} /></button>}
      {show && (
        // mousedown is stopped so that the box keeps the focus until the click lands
        <ul className="enq-search-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {hits.map((h, i) => (
            <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => choose(h)}>
              <i aria-hidden>{(h.name[0] ?? '?').toUpperCase()}</i>
              <span><strong>{h.name || 'No name'}</strong><small>{h.phone} · {h.ref}</small></span>
              {h.tag && <b>{h.tag}</b>}<em>{inr(h.fee)}</em>
            </li>
          ))}
          {!hits.length && <li className="enq-search-note" role="presentation">{busy ? 'Searching…' : `${none} for “${term}”. Check the spelling.`}</li>}
        </ul>
      )}
    </div>
  )
}
