'use client'
// The panel frame: sidebar (one link per page the person may open), top bar, and the shared toast.
// Each page is its own URL and loads its own data; this frame stays the same between them.
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, BookOpen, Building2, Check, ChevronDown, ClipboardList, FileText, GraduationCap, LayoutDashboard,
  Globe, Inbox, Palette, Mic, DatabaseZap, LogOut, Menu, Phone, ScrollText, Settings, ShieldCheck, Tags, Target, Users, WalletCards, X, Trash2, ChartColumn, ChartLine, Trophy, ArrowRightLeft, Share2, AlarmClock, MessageSquareText, Ticket, CalendarRange, FileCheck2, FileBadge, BriefcaseBusiness, Medal, FilePenLine, Layers, LifeBuoy, Megaphone, Presentation, HandHelping, ShieldAlert, Send } from 'lucide-react'
import { setActingBranchAction } from '@/app/actions'
import { logoutAction } from '@/app/login/actions'
import { TooltipLayer } from '@/components/tooltip-layer'
import { PageSkeleton } from '@/components/page-skeleton'
import { GlobalSearch, NotificationBell, ProfileMenu } from '@/components/topbar'
import { ABOUT, labelOf, MODULES, moduleForPath, type ModuleKey } from '@/lib/panel/modules'

const ICON: Record<ModuleKey, typeof Phone> = {
  Dashboard: LayoutDashboard, 'My Classes': Presentation, 'Project Help': HandHelping, 'Random Call': Phone, Leads: Inbox, 'Web Leads': Globe, 'Lead Categories': Tags, 'My Leads': Phone, 'Lead Distribution': Users, Enquiry: ClipboardList,
  Registration: FileText, 'Enquiry Update': Activity, Fees: WalletCards, Collection: ChartColumn,
  Students: GraduationCap, Courses: BookOpen, Reports: Target, Graphs: ChartLine, Leaderboards: Trophy, Transfers: ArrowRightLeft, 'Shared Students': Share2, Overdues: AlarmClock, Calendar: CalendarRange, 'Certificate Requests': FileCheck2, 'Issue Certificate': FileBadge, 'Internship Requests': BriefcaseBusiness, 'Internship Complete': Medal, 'Letter Templates': FilePenLine, 'Course Categories': Layers, 'Help Desk': LifeBuoy, 'My Tickets': Ticket, Announcements: Megaphone, 'Message Templates': MessageSquareText, 'Bulk WhatsApp': Send, 'Seminars & Workshops': Mic, 'Certificate Designs': Palette,
  'Users & Staff': Users, 'Roles & Permissions': ShieldCheck, Branches: Building2, Logs: ScrollText, 'Sign-in Security': ShieldAlert, 'Recycle Bin': Trash2, 'Old System Import': DatabaseZap, Settings,
}
const GROUPS = ['Overview', 'Admissions', 'Documents', 'Events', 'Reports', 'Management', 'Administration']

export type ShellUser = {
  id: string; name: string; email: string; initials: string; roleLabel: string
  branchName: string; branchInitials: string; branchSub: string; hasBranch: boolean
}

const ToastContext = createContext<(m: string) => void>(() => {})
/** Show a short confirmation at the bottom of the screen (any page). */
export const useNotify = () => useContext(ToastContext)

export function PanelShell({ user, modules, branches, isSuper, actingBranchId, children }: {
  user: ShellUser; modules: ModuleKey[]; branches: { id: string; code: string; name: string }[]
  isSuper: boolean; actingBranchId: string | null; children: React.ReactNode
}) {
  const pathname = usePathname()
  const onAccount = pathname.startsWith('/account') // My account is reached from the profile menu, not the sidebar
  const active = onAccount ? null : moduleForPath(pathname) ?? 'Dashboard'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Phones and tablets show the sidebar as a drawer: it closes on a new page, on Escape, and on a tap outside it (the scrim).
  useEffect(() => { setSidebarOpen(false) }, [pathname])
  // A menu click shows the page's skeleton at once (the page itself stays mounted, hidden, in case the move is cancelled).
  const [goingTo, setGoingTo] = useState<string | null>(null)
  useEffect(() => { setGoingTo(null) }, [pathname])
  useEffect(() => {
    if (!goingTo) return
    const t = window.setTimeout(() => setGoingTo(null), 15000) // never stuck on the skeleton
    return () => window.clearTimeout(t)
  }, [goingTo])
  const go = (path: string) => (e: React.MouseEvent) => {
    setSidebarOpen(false)
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || path === pathname) return // new tab, or already here
    setGoingTo(path)
  }
  useEffect(() => {
    if (!sidebarOpen) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [sidebarOpen])
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)
  // Each message gets its full 3.2s: a newer message cancels the older one's timer instead of being hidden by it.
  function notify(message: string) {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 3200)
  }

  return (
    <ToastContext.Provider value={notify}>
      <TooltipLayer />
      <div className="app-shell">
        {sidebarOpen && <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" tabIndex={-1} />}
        <aside id="panel-sidebar" className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="brand">
            <Image className="brand-logo" src="/tce.webp" alt="techcadd" width={940} height={270} priority />
            <button type="button" className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
          </div>
          <div className="branch-select">
            <div className="branch-icon">{user.branchInitials}</div>
            {isSuper || branches.length > 1 ? (
              <div style={{ flex: 1, minWidth: 0 }}>
                <small>Working in</small>
                <select aria-label="Working branch" value={actingBranchId ?? ''} onChange={(e) => { void setActingBranchAction(e.target.value) }} style={{ width: '100%', border: 0, background: 'transparent', fontWeight: 600, fontSize: 12 }}>
                  {isSuper && <option value="">All branches (view only)</option>}
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </div>
            ) : (
              <div><strong>{user.branchName}</strong><small>{user.branchSub}</small></div>
            )}
            {!isSuper && branches.length <= 1 && <ChevronDown size={15} />}
          </div>
          <nav className="nav-list">
            {GROUPS.map((group) => {
              const items = MODULES.filter((m) => m.group === group && modules.includes(m.key))
              if (!items.length) return null
              return (
                <div className="nav-group" key={group}>
                  <p className="nav-label">{group}</p>
                  {items.map(({ key, path }) => {
                    const Icon = ICON[key]
                    return (
                      <Link key={key} href={path} prefetch={false} className={`nav-item ${(goingTo ? goingTo === path : active === key) ? 'active' : ''}`} aria-current={active === key ? 'page' : undefined} data-tip={ABOUT[key]} data-tip-side="right" onClick={go(path)}>
                        <Icon size={17} /><span>{labelOf(key)}</span>
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </nav>
          <div className="sidebar-bottom">
            <div className="user-card">
              <div className="avatar">{user.initials}</div>
              <div><strong>{user.name}</strong><span>{user.roleLabel}</span></div>
              <form action={logoutAction}><button type="submit" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></form>
            </div>
          </div>
        </aside>
        <main className="main-content">
          <header className="topbar">
            <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" aria-controls="panel-sidebar" aria-expanded={sidebarOpen}><Menu size={21} /></button>
            <GlobalSearch modules={modules} />
            <div className="top-actions">
              <div className="breadcrumb"><span>Workspace</span><strong>{active ? labelOf(active) : 'My account'}</strong></div>
              <NotificationBell />
              <ProfileMenu user={user} />
            </div>
          </header>
          {goingTo && <PageSkeleton />}
          <div className="page-slot" hidden={!!goingTo}>{children}</div>
          <footer className="panel-footer">
            <div className="pf-brand"><strong>techcadd</strong><span>Institute ERP · {user.branchName}</span></div>
            <nav aria-label="Footer">
              <Link href="/support" target="_blank">Help &amp; support</Link>
              <Link href="/account">My account</Link>
              {modules.includes('My Tickets') && <Link href="/my-tickets">Raise a ticket</Link>}
            </nav>
            <span className="pf-copy">© {new Date().getFullYear()} techcadd Computer Education. All rights reserved.</span>
          </footer>
        </main>
        {toast && <div className="toast"><div className="toast-check"><Check size={15} /></div>{toast}</div>}
      </div>
    </ToastContext.Provider>
  )
}
