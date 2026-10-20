'use client'
// One delete button for every list: the bin icon, then a popup to confirm. Deleted things wait 30 days in
// the Recycle Bin (head office can restore them there).
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ConfirmDelete } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'

/** `label` shows the word next to the icon (a button among others, e.g. in a details popup) instead of the icon alone. */
export function DeleteButton({ what, run, onDone, label }: { what: string; run: () => Promise<{ ok: boolean; error?: string }>; onDone?: () => void; label?: boolean }) {
  const notify = useNotify()
  const [asking, setAsking] = useState(false)
  return (
    <>
      {label
        ? <button type="button" className="button secondary del-btn" onClick={() => setAsking(true)}><Trash2 size={15} /> Delete</button>
        : <button type="button" className="filter-button icon-only del-btn" title={`Delete ${what}`} aria-label={`Delete ${what}`} onClick={() => setAsking(true)}><Trash2 size={14} /></button>}
      {asking && <ConfirmDelete title={`Delete ${what}?`} text={`${what} will be removed from every list. It stays 30 days in the Recycle Bin, where head office can restore it.`}
        onClose={() => setAsking(false)}
        onConfirm={async () => {
          const r = await run()
          if (!r.ok) return r.error ?? 'Could not delete'
          setAsking(false)
          notify(`${what} deleted — it stays 30 days in the Recycle Bin`)
          onDone?.()
        }} />}
    </>
  )
}
