'use client'
// Every <select> in the panel opens this list instead of the browser's plain grey one.
// Like DateInput, the real <select> stays where it is, so form names, "required", defaultValue and every onChange keep
// working; only the pop-up is ours. Mounted once in the root layout. Opt a select out with data-native.
// Phones and tablets keep their own picker, which is already made for touch.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search } from 'lucide-react'

type Item = { kind: 'group'; label: string } | { kind: 'opt'; value: string; label: string; disabled: boolean; selected: boolean }
type Open = { sel: HTMLSelectElement; host: HTMLDivElement; id: number }

const SEARCH_FROM = 9 // a search box once there are this many choices

const ours = (t: EventTarget | null): HTMLSelectElement | null => {
  const sel = t instanceof Element ? t.closest('select') : null
  if (!sel || sel.multiple || sel.size > 1 || sel.disabled || sel.hasAttribute('data-native')) return null
  return window.matchMedia('(pointer: fine)').matches ? sel : null
}

function readItems(sel: HTMLSelectElement): Item[] {
  const out: Item[] = []
  const opt = (o: HTMLOptionElement, groupOff = false) => {
    // A disabled empty choice is a placeholder ("Select department"): the field already shows it, so leave it out of the list.
    if (o.value === '' && o.disabled) return
    out.push({ kind: 'opt', value: o.value, label: o.text, disabled: o.disabled || groupOff, selected: o.selected })
  }
  for (const c of Array.from(sel.children)) {
    if (c instanceof HTMLOptGroupElement) { out.push({ kind: 'group', label: c.label }); for (const o of Array.from(c.children)) if (o instanceof HTMLOptionElement) opt(o, c.disabled) }
    else if (c instanceof HTMLOptionElement) opt(c)
  }
  return out
}

/** Sets the value the way picking would, so React's onChange (and plain form submission) both see it. */
function choose(sel: HTMLSelectElement, value: string) {
  if (sel.value !== value) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, value)
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  sel.focus()
}

export function SelectPopups() {
  const [open, setOpen] = useState<Open | null>(null)
  const openRef = useRef<Open | null>(null)
  openRef.current = open

  const close = (refocus = false) => {
    const cur = openRef.current
    if (!cur) return
    cur.host.remove()
    setOpen(null)
    if (refocus) cur.sel.focus()
  }

  useEffect(() => {
    const show = (sel: HTMLSelectElement) => {
      // Live inside the select's own block (not <body>), so modals and the calendar pop-up count a click in the list as "inside".
      const box = (sel.closest('label') ?? sel).parentElement ?? document.body
      const host = document.createElement('div')
      host.className = 'sp-pop'
      box.appendChild(host)
      setOpen({ sel, host, id: Date.now() })
      sel.focus()
    }
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return
      const sel = ours(e.target)
      if (!sel) return
      e.preventDefault() // stops the browser's own list
      if (openRef.current?.sel === sel) close(true)
      else { close(); show(sel) }
    }
    const key = (e: KeyboardEvent) => {
      if (openRef.current) return
      const sel = ours(e.target)
      if (!sel) return
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); show(sel) }
    }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', down, true); document.removeEventListener('keydown', key, true) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!open) return null
  return createPortal(<List key={open.id} sel={open.sel} host={open.host} close={close} />, open.host)
}

function List({ sel, host, close }: { sel: HTMLSelectElement; host: HTMLDivElement; close: (refocus?: boolean) => void }) {
  const [items] = useState(() => readItems(sel))
  const [q, setQ] = useState('')
  const opts = items.filter((i): i is Extract<Item, { kind: 'opt' }> => i.kind === 'opt')
  const withSearch = opts.length >= SEARCH_FROM
  const needle = q.trim().toLowerCase()
  const shown = needle ? items.filter((i) => i.kind === 'opt' && i.label.toLowerCase().includes(needle)) : items
  const picks = shown.filter((i): i is Extract<Item, { kind: 'opt' }> => i.kind === 'opt' && !i.disabled)
  const [active, setActive] = useState(() => Math.max(0, picks.findIndex((o) => o.selected)))
  const list = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const typed = useRef({ s: '', t: 0 })

  // Under the field (or above it when there is no room), at least as wide as the field, and kept on screen.
  useLayoutEffect(() => {
    const place = () => {
      const r = sel.getBoundingClientRect()
      const vw = window.innerWidth, vh = window.innerHeight
      const width = Math.min(Math.max(r.width, 200), vw - 16)
      const below = vh - r.bottom - 12, above = r.top - 12
      const up = below < 240 && above > below
      const maxH = Math.max(140, Math.min(340, up ? above : below))
      host.style.width = `${width}px`
      host.style.maxHeight = `${maxH}px`
      host.style.left = '0px'; host.style.top = '0px'
      // A blurred or moved ancestor (the modal backdrop) shifts where "fixed" starts: measure and make up the difference.
      const o = host.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, vw - width - 8))
      const top = up ? r.top - 6 - Math.min(host.offsetHeight, maxH) : r.bottom + 6
      host.style.left = `${left - o.left}px`; host.style.top = `${top - o.top}px`
      host.dataset.up = up ? '1' : ''
    }
    place()
    if (withSearch) search.current?.focus({ preventScroll: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Scroll only the list (scrollIntoView could move the page, and a page scroll closes the list).
    const box = list.current, el = box?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!box || !el) return
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 4
  }, [active, q])

  useEffect(() => {
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!host.contains(t) && !sel.contains(t)) close() }
    const moved = (e: Event) => { if (!host.contains(e.target as Node)) close() }
    const gone = setInterval(() => { if (!sel.isConnected) close() }, 300)
    const keys = (e: KeyboardEvent) => {
      const n = picks.length
      const go = (i: number) => { e.preventDefault(); setActive(n ? (i + n) % n : 0) }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
      else if (e.key === 'Tab') close()
      else if (e.key === 'ArrowDown') go(active + 1)
      else if (e.key === 'ArrowUp') go(active - 1)
      else if (e.key === 'Home' && !withSearch) go(0)
      else if (e.key === 'End' && !withSearch) go(n - 1)
      else if (e.key === 'PageDown') go(Math.min(n - 1, active + 8))
      else if (e.key === 'PageUp') go(Math.max(0, active - 8))
      else if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) { e.preventDefault(); e.stopPropagation(); if (picks[active]) { choose(sel, picks[active].value); close() } }
      else if (!withSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Type the first letters to jump, as in the browser's own list.
        const now = Date.now()
        typed.current = { s: (now - typed.current.t < 700 ? typed.current.s : '') + e.key.toLowerCase(), t: now }
        const i = picks.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.s))
        if (i >= 0) go(i)
      }
    }
    document.addEventListener('mousedown', away, true)
    window.addEventListener('keydown', keys, true) // before anything on the page (a modal's or calendar's Escape)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', close as () => void)
    return () => {
      clearInterval(gone)
      document.removeEventListener('mousedown', away, true)
      window.removeEventListener('keydown', keys, true)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', close as () => void)
    }
  })

  let n = -1
  return (
    <>
      {withSearch && (
        <div className="sp-search"><Search size={15} /><input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} placeholder="Search…" aria-label="Search the choices" /></div>
      )}
      <div className="sp-list" role="listbox" ref={list} aria-label={sel.getAttribute('aria-label') ?? undefined}>
        {shown.map((it, k) => {
          if (it.kind === 'group') return <div key={`g${k}`} className="sp-group">{it.label}</div>
          const i = it.disabled ? -1 : ++n
          return (
            <div key={`o${k}`} role="option" aria-selected={it.selected} aria-disabled={it.disabled || undefined} data-i={i >= 0 ? i : undefined}
              className={`sp-opt${it.selected ? ' is-on' : ''}${i === active ? ' is-active' : ''}${it.value === '' ? ' is-blank' : ''}`}
              onMouseMove={() => { if (i >= 0 && i !== active) setActive(i) }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (it.disabled) return; choose(sel, it.value); close() }}>
              <span>{it.label}</span>{it.selected && <Check size={15} />}
            </div>
          )
        })}
        {!picks.length && <div className="sp-empty">{needle ? 'No matches' : 'Nothing to choose'}</div>}
      </div>
    </>
  )
}
