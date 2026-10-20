'use client'
// The same controls as usePagedList, for short lists the server sends whole (e.g. staff): filtered, sorted and paged in the browser.
import { useMemo, useState } from 'react'
import { isEmptyQuery, type ListQuery } from '@/lib/list-query'
import { PAGE_SIZE } from '@/components/use-paged-list'

type Val = string | number | null | undefined

const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export function useLocalList<T>(all: T[], cfg: {
  /** Text the search box looks in. */
  text: (r: T) => string
  /** Filter key -> does row match value. */
  filters?: Record<string, (r: T, v: string) => boolean>
  /** The ISO date the date range applies to. */
  date?: (r: T) => string | null
  sorts?: Record<string, (r: T) => Val>
}) {
  const [lq, setLq] = useState<ListQuery>({})
  const [page, setPage] = useState(0)
  const update = (patch: Partial<ListQuery>) => { setPage(0); setLq((cur) => ({ ...cur, ...patch })) }

  const rows = useMemo(() => {
    const q = lq.q?.trim().toLowerCase()
    let out = all.filter((r) => {
      if (q && !cfg.text(r).toLowerCase().includes(q)) return false
      for (const [k, v] of Object.entries(lq.f ?? {})) if (v && cfg.filters?.[k] && !cfg.filters[k](r, v)) return false
      if ((lq.from || lq.to) && cfg.date) {
        const iso = cfg.date(r)
        if (!iso) return false
        const d = localDay(iso)
        if ((lq.from && d < lq.from) || (lq.to && d > lq.to)) return false
      }
      return true
    })
    const key = lq.sort ? cfg.sorts?.[lq.sort] : undefined
    if (key) {
      const sign = lq.dir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => {
        const x = key(a), y = key(b)
        if (x == null || x === '') return y == null || y === '' ? 0 : 1 // blanks last either way
        if (y == null || y === '') return -1
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' })) * sign
      })
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, lq])

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const p = Math.min(page, pages - 1)
  return {
    rows: rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE), total: rows.length, page: p, setPage, pages, loading: false,
    query: lq,
    q: lq.q ?? '',
    setQ: (v: string) => update({ q: v }),
    filter: (k: string) => lq.f?.[k] ?? '',
    setFilter: (k: string, v: string) => update({ f: { ...lq.f, [k]: v } }),
    setRange: (from: string, to: string) => update({ from: from || undefined, to: to || undefined }),
    setSort: (sort: string, dir: 'asc' | 'desc') => update({ sort, dir }),
    toggleSort: (key: string, firstDir: 'asc' | 'desc' = 'asc') =>
      update(lq.sort === key ? { dir: lq.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: firstDir }),
    reset: () => update({ q: '', from: undefined, to: undefined, sort: undefined, dir: undefined, f: {} }),
    filtered: !isEmptyQuery({ ...lq, sort: undefined }),
  }
}
