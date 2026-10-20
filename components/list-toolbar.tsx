'use client'
// One toolbar for every list screen: search, screen-specific filters, a date range (presets or custom) and sort.
import { useState } from 'react'
import { ExportButton } from '@/components/export-button'
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Search, X } from 'lucide-react'
import type { ListQuery } from '@/lib/list-query'
import { DateInput } from '@/components/date-input'

export type FilterDef = { key: string; label: string; options: { value: string; label: string }[] }
export type SortDef = { key: string; label: string; dir: 'asc' | 'desc' }

/** The part of usePagedList the toolbar and headers need (the users screen supplies its own, client-side). */
export type ListControls = {
  query: ListQuery
  q: string
  setQ: (v: string) => void
  filter: (k: string) => string
  setFilter: (k: string, v: string) => void
  setRange: (from: string, to: string) => void
  setSort: (sort: string, dir: 'asc' | 'desc') => void
  toggleSort: (key: string, firstDir?: 'asc' | 'desc') => void
  reset: () => void
  filtered: boolean
}

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return day(d) }

/** Presets are worked out in the viewer's own time zone. */
function preset(key: string): [string, string] {
  const now = new Date()
  switch (key) {
    case 'today': return [day(now), day(now)]
    case 'yesterday': return [shift(-1), shift(-1)]
    case '7d': return [shift(-6), day(now)]
    case '30d': return [shift(-29), day(now)]
    case 'month': return [day(new Date(now.getFullYear(), now.getMonth(), 1)), day(now)]
    case 'last_month': return [day(new Date(now.getFullYear(), now.getMonth() - 1, 1)), day(new Date(now.getFullYear(), now.getMonth(), 0))]
    case 'next7': return [day(now), shift(6)]
    default: return ['', '']
  }
}

const PAST = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['last_month', 'Last month']]
const FUTURE = [['today', 'Today'], ['next7', 'Next 7 days'], ['7d', 'Last 7 days'], ['month', 'This month'], ['last_month', 'Last month']]

export function ListToolbar({ list, placeholder, autoFocus, filters = [], dateLabel, dateFuture, sorts = [], exportList }: {
  list: ListControls; placeholder: string; autoFocus?: boolean; filters?: FilterDef[]
  /** the list's key in modules/exports/lists.ts: shows Export (Excel / CSV / PDF of what the list shows, all pages) */
  exportList?: string
  /** e.g. "Call date"; omit to hide the date filter. */
  dateLabel?: string
  /** Offer "Next 7 days" (for due / follow-up dates). */
  dateFuture?: boolean
  sorts?: SortDef[]
}) {
  const { from = '', to = '' } = list.query
  const presets = dateFuture ? FUTURE : PAST
  const current = presets.find(([k]) => { const [a, b] = preset(k); return a === from && b === to })?.[0]
  const [custom, setCustom] = useState(false)
  const rangeValue = !from && !to ? '' : current && !custom ? current : 'custom'
  const sortValue = list.query.sort ? `${list.query.sort}:${list.query.dir ?? 'desc'}` : ''

  return (
    <div className="table-toolbar list-toolbar">
      <div className="table-search">
        <Search size={16} />
        <input value={list.q} onChange={(e) => list.setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label="Search" />
        {list.q && <button type="button" className="search-clear" onClick={() => list.setQ('')} aria-label="Clear search"><X size={14} /></button>}
      </div>
      <div className="toolbar-controls">
        {filters.map((fd) => (
          <select key={fd.key} className={`toolbar-select${list.filter(fd.key) ? ' is-set' : ''}`} value={list.filter(fd.key)} onChange={(e) => list.setFilter(fd.key, e.target.value)} aria-label={fd.label}>
            <option value="">{fd.label}: all</option>
            {fd.options.map((o) => <option key={o.value} value={o.value}>{fd.label}: {o.label}</option>)}
          </select>
        ))}
        {dateLabel && (
          <>
            <label className={`toolbar-select toolbar-date${from || to ? ' is-set' : ''}`}>
              <CalendarDays size={14} />
              <select value={rangeValue} aria-label={dateLabel} onChange={(e) => {
                const v = e.target.value
                setCustom(v === 'custom')
                if (v === 'custom') list.setRange(from || shift(-29), to || day(new Date()))
                else { const [a, b] = preset(v); list.setRange(a, b) }
              }}>
                <option value="">{dateLabel}: any time</option>
                {presets.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                <option value="custom">Custom range…</option>
              </select>
            </label>
            {rangeValue === 'custom' && (
              <span className="toolbar-range">
                <DateInput type="date" value={from} max={to || undefined} onChange={(e) => list.setRange(e.target.value, to)} aria-label={`${dateLabel} from`} />
                <span>to</span>
                <DateInput type="date" value={to} min={from || undefined} onChange={(e) => list.setRange(from, e.target.value)} aria-label={`${dateLabel} to`} />
              </span>
            )}
          </>
        )}
        {sorts.length > 0 && (
          <label className={`toolbar-select toolbar-date${sortValue ? ' is-set' : ''}`}>
            <ArrowUpDown size={14} />
            <select value={sortValue} aria-label="Sort" onChange={(e) => { const [k, d] = e.target.value.split(':'); if (k) list.setSort(k, d as 'asc' | 'desc'); else list.setSort('', 'desc') }}>
              <option value="">Sort: default</option>
              {sorts.map((s) => <option key={`${s.key}:${s.dir}`} value={`${s.key}:${s.dir}`}>{s.label}</option>)}
            </select>
          </label>
        )}
        {(list.filtered || sortValue) && <button type="button" className="filter-button" onClick={() => { setCustom(false); list.reset() }}><X size={13} /> Clear</button>}
        {exportList && <ExportButton list={exportList} query={list.query} />}
      </div>
    </div>
  )
}

/** A clickable column header that sorts the list by `k`. */
export function SortTh({ list, k, first = 'asc', children }: { list: ListControls; k: string; first?: 'asc' | 'desc'; children: React.ReactNode }) {
  const on = list.query.sort === k
  const Icon = !on ? ArrowUpDown : list.query.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th aria-sort={on ? (list.query.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={`th-sort${on ? ' on' : ''}`} onClick={() => list.toggleSort(k, first)}>{children}<Icon size={12} /></button>
    </th>
  )
}

/** Turns catalog rows into select options. */
export const opts = <T,>(rows: T[], value: (r: T) => string, label: (r: T) => string) => rows.map((r) => ({ value: value(r), label: label(r) }))

/** Follow-up filter shared by calls and enquiries. */
export const FOLLOW = [{ value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Due today' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'none', label: 'No follow-up' }]
