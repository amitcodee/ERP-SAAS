'use client'
// "Export" on a list: Excel, CSV or PDF of what the list shows now (search, filters, dates, sort), every page of it.
import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react'
import type { ListQuery } from '@/lib/list-query'

const FORMATS = [
  { key: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet, hint: 'Opens in Excel / Google Sheets, amounts as numbers' },
  { key: 'csv', label: 'CSV', icon: Sheet, hint: 'Plain table for any program' },
  { key: 'pdf', label: 'PDF', icon: FileText, hint: 'To print or share' },
] as const

export function ExportButton({ list, query = {}, label = 'Export' }: { list: string; query?: ListQuery; label?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const href = (format: string) => `/api/export?${new URLSearchParams({ list, format, query: JSON.stringify(query) })}`
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="filter-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Download this list (all pages, with the current filters)">
        <Download size={15} /> {label}
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40, minWidth: 250, background: 'var(--card, #fff)', border: '1px solid var(--line, #e8eaf6)', borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(16,24,106,.35)', padding: 6 }}>
          {FORMATS.map((f) => (
            <a key={f.key} role="menuitem" href={href(f.key)} download onClick={() => setOpen(false)}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 10px', borderRadius: 8, textDecoration: 'none', color: 'inherit' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--tint, #eef0ff)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <f.icon size={17} style={{ color: f.key === 'pdf' ? '#dc2626' : f.key === 'xlsx' ? '#059669' : '#4a4af4' }} />
              <span><strong style={{ display: 'block', fontSize: 13.5 }}>{f.label}</strong><small style={{ color: 'var(--muted, #6b7394)' }}>{f.hint}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
