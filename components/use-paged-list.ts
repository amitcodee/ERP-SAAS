'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { ActionResult } from '@/app/actions'
import { isEmptyQuery, type ListQuery } from '@/lib/list-query'

export const PAGE_SIZE = 25

/**
 * A list that searches, filters, sorts and pages on the SERVER, so it works the same with 30 rows or 30,000.
 * `initial` is the first page rendered by the server (no filters); when the server sends fresh data (after a save)
 * the current query is simply re-run.
 */
export function usePagedList<T>(initial: { rows: T[]; total: number }, fetcher: (lq: ListQuery, page: number) => Promise<ActionResult<{ rows: T[]; total: number }>>) {
  // ?q=... in the address (the top bar's search opens a list this way) starts the list already searched.
  const urlQ = useSearchParams().get('q') ?? ''
  const [lq, setLq] = useState<ListQuery>(urlQ ? { q: urlQ } : {})
  const [page, setPage] = useState(0)
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const typed = useRef(false) // only typing in the search box is debounced; picking a filter fetches at once

  const run = (query: ListQuery, p: number, delay: number) => {
    const my = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await fetcher(query, p)
      if (my !== seq.current) return // a newer request superseded this one
      setLoading(false)
      if (r.ok && r.data) { setData(r.data); setError('') } else if (!r.ok) setError(r.error)
    }, delay)
    return () => clearTimeout(t)
  }

  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; if (isEmptyQuery(lq)) return }
    const delay = typed.current ? 250 : 0
    typed.current = false
    if (isEmptyQuery(lq) && page === 0) { seq.current++; setLoading(false); setData(initial); return }
    return run(lq, page, delay)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lq, page])

  // Fresh server data after a save: watch the server-sent rows array itself (a new {rows,total} object is built on every render).
  const lastRows = useRef(initial.rows)
  useEffect(() => {
    if (lastRows.current === initial.rows) return
    lastRows.current = initial.rows
    if (isEmptyQuery(lq) && page === 0) setData({ rows: initial.rows, total: initial.total })
    else return run(lq, page, 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.rows])

  const update = (patch: Partial<ListQuery>) => { setPage(0); setLq((cur) => ({ ...cur, ...patch })) }

  // A new search from the top bar while this list is already open.
  const lastUrlQ = useRef(urlQ)
  useEffect(() => {
    if (lastUrlQ.current === urlQ) return
    lastUrlQ.current = urlQ
    update({ q: urlQ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ])
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  return {
    rows: data.rows, total: data.total, page, setPage, pages, loading, error,
    query: lq,
    q: lq.q ?? '',
    setQ: (v: string) => { typed.current = true; update({ q: v }) },
    filter: (k: string) => lq.f?.[k] ?? '',
    setFilter: (k: string, v: string) => update({ f: { ...lq.f, [k]: v } }),
    setRange: (from: string, to: string) => update({ from: from || undefined, to: to || undefined }),
    setSort: (sort: string, dir: 'asc' | 'desc') => update({ sort, dir }),
    /** Header click: first click sorts this column (descending for dates/amounts, else ascending), next click flips. */
    toggleSort: (key: string, firstDir: 'asc' | 'desc' = 'asc') =>
      update(lq.sort === key ? { dir: lq.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: firstDir }),
    reset: () => update({ q: '', from: undefined, to: undefined, sort: undefined, dir: undefined, f: {} }),
    filtered: !isEmptyQuery({ ...lq, sort: undefined }),
  }
}

export type PagedList = ReturnType<typeof usePagedList<unknown>>
