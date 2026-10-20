'use client'
import { useEffect, useState } from 'react'

/** Type to search on the server, then pick from the (max 20) matches. Works with any number of records. */
export function Picker({ search, onPick, placeholder, ariaLabel, emptyLabel = 'Select…' }: {
  search: (q: string) => Promise<{ id: string; label: string }[]>
  onPick: (id: string, label: string) => void
  placeholder: string
  ariaLabel: string
  emptyLabel?: string
}) {
  const [q, setQ] = useState('')
  const [opts, setOpts] = useState<{ id: string; label: string }[]>([])
  const [val, setVal] = useState('')
  useEffect(() => {
    let live = true
    const t = setTimeout(async () => { const r = await search(q); if (live) setOpts(r) }, q ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  return (
    <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={`${ariaLabel} search`} style={{ flex: '1 1 180px', height: 36, padding: '0 10px', border: '1px solid #e1e7ee', borderRadius: 6, fontSize: 11 }} />
      <select aria-label={ariaLabel} value={val} onChange={(e) => { setVal(e.target.value); onPick(e.target.value, opts.find((o) => o.id === e.target.value)?.label ?? '') }} style={{ flex: '2 1 240px' }}>
        <option value="">{opts.length ? emptyLabel : q ? 'No matches' : 'Type to search…'}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  )
}
