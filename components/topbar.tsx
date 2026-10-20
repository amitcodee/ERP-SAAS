'use client'
// The top bar's three tools: search everything, the bell (what is waiting for me), and the profile menu.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, CheckCircle2, ChevronRight, LayoutGrid, LogOut, Search, ShieldCheck, UserRound, X } from 'lucide-react'
import { globalSearchAction, myAlertsAction, type SearchHit } from '@/app/actions'
import { logoutAction } from '@/app/login/actions'
import { labelOf, MODULES, PATH, type ModuleKey } from '@/lib/panel/modules'
import type { Alert } from '@/modules/home/service'

/** Closes a dropdown on a click or tap outside it, or on Escape. Pointer events cover mouse, touch and pen alike. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const kind = 'PointerEvent' in window ? 'pointerdown' : 'mousedown'
    document.addEventListener(kind, down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener(kind, down); document.removeEventListener('keydown', key) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  return ref
}

type Item = { key: string; group: string; title: string; sub: string; href: string }

/** Pages by name (instant), then people and records by name / phone / number (from the server, as you type). */
export function GlobalSearch({ modules }: { modules: ModuleKey[] }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const ref = useDismiss(open, () => setOpen(false))
  const term = q.trim()

  useEffect(() => {
    const my = ++seq.current
    if (term.length < 2) { setHits([]); setLoading(false); return }
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await globalSearchAction(term)
      if (my !== seq.current) return // a newer search superseded this one
      setHits(r); setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [term])

  // Ctrl+K (or /) jumps to the search box from anywhere.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      if (!e.key) return // autofill fires keydown without a key
      if ((e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) { e.preventDefault(); input.current?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  const pages: Item[] = term
    ? MODULES.filter((m) => modules.includes(m.key) && labelOf(m.key).toLowerCase().includes(term.toLowerCase())).map((m) => ({ key: `p:${m.key}`, group: 'Pages', title: labelOf(m.key), sub: m.group, href: m.path }))
    : []
  const items: Item[] = [...pages, ...hits.map((h, i) => ({ key: `h:${i}`, group: h.kind, title: h.title, sub: h.sub, href: h.href }))]
  const go = (it: Item) => { setOpen(false); setQ(''); input.current?.blur(); router.push(it.href) }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setAt((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && items[at]) { e.preventDefault(); go(items[at]) }
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
  }

  return (
    <div className="global-search" ref={ref}>
      <Search size={16} />
      <input ref={input} value={q} placeholder="Search name, phone, enquiry / reg. no…" aria-label="Search anything" role="combobox" aria-expanded={open && !!term} aria-controls="global-search-results"
        onChange={(e) => { setQ(e.target.value); setAt(0); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey} />
      {q ? <button type="button" className="search-clear" onClick={() => { setQ(''); input.current?.focus() }} aria-label="Clear search"><X size={14} /></button> : <kbd>Ctrl K</kbd>}
      {open && term && (
        <div className="top-pop search-pop" id="global-search-results" role="listbox">
          {items.map((it, i) => (
            <div key={it.key}>
              {(i === 0 || items[i - 1].group !== it.group) && <p className="pop-label">{it.group}</p>}
              <button type="button" role="option" aria-selected={i === at} className={`pop-row${i === at ? ' on' : ''}`} onMouseEnter={() => setAt(i)} onClick={() => go(it)}>
                <span className="pop-icon">{it.group === 'Pages' ? <LayoutGrid size={15} /> : <UserRound size={15} />}</span>
                <span className="pop-text"><strong>{it.title}</strong><small>{it.sub}</small></span>
                <ChevronRight size={15} />
              </button>
            </div>
          ))}
          {!items.length && <p className="pop-empty">{term.length < 2 ? 'Type at least 2 letters' : loading ? 'Searching…' : `Nothing found for “${term}”`}</p>}
          {!!items.length && loading && <p className="pop-empty">Searching…</p>}
        </div>
      )}
    </div>
  )
}

const SEEN_KEY = 'tc_alerts_seen'
const signature = (a: Alert[]) => a.map((x) => `${x.label}:${x.count}`).join('|')

/** The bell: live counts of what is waiting for this person. The red dot shows until the current list has been opened. */
export function NotificationBell() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [seen, setSeen] = useState('')
  const ref = useDismiss(open, () => setOpen(false))

  // Refreshed when the page changes (work just done clears its line) and every 2 minutes while the panel is open.
  useEffect(() => {
    let live = true
    const load = () => { void myAlertsAction().then((a) => { if (live) setAlerts(a) }) }
    load()
    const t = window.setInterval(load, 120_000)
    return () => { live = false; window.clearInterval(t) }
  }, [pathname])
  useEffect(() => { try { setSeen(window.localStorage.getItem(SEEN_KEY) ?? '') } catch { /* private mode: the dot just stays until opened */ } }, [])

  const sig = signature(alerts ?? [])
  const unread = !!alerts?.length && sig !== seen
  function toggle() {
    setOpen((v) => !v)
    if (!open && alerts) { setSeen(sig); try { window.localStorage.setItem(SEEN_KEY, sig) } catch { /* ignore */ } }
  }

  return (
    <div className="top-menu" ref={ref}>
      <button type="button" className="icon-button notification-button" onClick={toggle} aria-label={unread ? 'Notifications (new)' : 'Notifications'} aria-haspopup="true" aria-expanded={open}><Bell size={18} />{unread && <i />}</button>
      {open && (
        <div className="top-pop notif-pop">
          <div className="pop-head"><strong>Notifications</strong>{!!alerts?.length && <span>{alerts.length} waiting</span>}</div>
          {alerts === null && <p className="pop-empty">Loading…</p>}
          {alerts?.map((a) => (
            <Link key={a.label} href={PATH[a.goTo as ModuleKey] ?? '/dashboard'} className="pop-row" onClick={() => setOpen(false)}>
              <span className={`pop-count ${a.tone}`}>{a.count > 99 ? '99+' : a.count}</span>
              <span className="pop-text"><strong>{a.label}</strong><small>Open {labelOf(a.goTo as ModuleKey)}</small></span>
              <ChevronRight size={15} />
            </Link>
          ))}
          {alerts?.length === 0 && <div className="pop-empty"><CheckCircle2 size={22} /><span>You are all caught up. Nothing is waiting for you.</span></div>}
        </div>
      )}
    </div>
  )
}

export function ProfileMenu({ user }: { user: { name: string; email: string; initials: string; roleLabel: string } }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="top-menu" ref={ref}>
      <button type="button" className="top-avatar" onClick={() => setOpen((v) => !v)} aria-label="Your account" aria-haspopup="menu" aria-expanded={open}>{user.initials}</button>
      {open && (
        <div className="top-pop profile-pop" role="menu">
          <div className="profile-who">
            <div className="avatar">{user.initials}</div>
            <div><strong>{user.name}</strong><span>{user.email}</span><small>{user.roleLabel}</small></div>
          </div>
          <Link href="/account" role="menuitem" className="pop-row" onClick={() => setOpen(false)}><span className="pop-icon"><UserRound size={15} /></span><span className="pop-text"><strong>Profile</strong><small>Name, phone and your details</small></span></Link>
          <Link href="/account?tab=security" role="menuitem" className="pop-row" onClick={() => setOpen(false)}><span className="pop-icon"><ShieldCheck size={15} /></span><span className="pop-text"><strong>Security</strong><small>Password and two-step sign-in</small></span></Link>
          <form action={logoutAction}><button type="submit" role="menuitem" className="pop-row danger"><span className="pop-icon"><LogOut size={15} /></span><span className="pop-text"><strong>Sign out</strong></span></button></form>
        </div>
      )}
    </div>
  )
}
