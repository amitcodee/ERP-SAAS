'use client'
// The student portal: an app-style page in sections (in the address as ?tab=). A sidebar on a computer, a bottom bar
// on a phone. Home (progress, what's next, notice board), Course (batch, trainer, branch), Fees (plan, receipts),
// Attendance (month calendar), Grades, Documents (ID card, certificate, letters, profile), Help (tickets) and Account.
// A student with several enrolments picks one on top. Styles: the "pt-" block in globals.css.
import { useEffect, useMemo, useState, useTransition } from 'react'
import Image from 'next/image'
import { BirthdayCelebration } from '@/components/birthday-celebration'
import { Rate } from '@/components/ticket-rating'
import { InterviewPrep } from '@/components/interview-prep'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight, Award, BadgeCheck, BookMarked, BookOpen, Briefcase, ExternalLink, HandHelping, Link2, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock,
  FileText, GraduationCap, Home, IdCard, LifeBuoy, LogOut, Mail, MapPin, Megaphone, MoreHorizontal, Phone, Pin, Printer, Receipt,
  Send, ShieldCheck, Sparkles, User, Wallet, X,
} from 'lucide-react'
import { askHelpAction, chooseHelperAction, closeHelpAction, closeTicketAction, raiseTicketAction, replyTicketAction, requestCertificateAction, submitMyProjectAction, ticketMessagesAction, startFeePaymentAction } from '@/app/actions'
import { logoutAction } from '@/app/login/actions'
import { ChangePasswordForm } from '@/components/change-password'
import { Err } from '@/components/modal'
import { PortalProfile } from '@/components/portal-profile'
import { WEEKDAYS } from '@/components/timetable'
import { paymentChannel } from '@/modules/fees/plan'
import type { MyProfile, PortalItem } from '@/modules/portal/service'
import type { Study } from '@/modules/portal/study'
import { namedProject } from '@/lib/project-title'
import type { Announcement, TicketMessage, TicketRow } from '@/modules/support/service'
import type { HelpRequest, NoteRow } from '@/modules/teaching/service'
import { useBrand } from '@/components/brand-context'
import { BrandMark } from '@/components/brand-mark'

const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN')
const fmt = (d: string | null) => (d ? new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const short = (d: string) => new Date(d.length > 10 ? d : `${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const istNow = () => new Date(Date.now() + 5.5 * 3600_000)
const todayIso = () => istNow().toISOString().slice(0, 10)
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
const pctOf = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, Math.round((a / b) * 100))) : 0)

const TABS = [
  ['home', 'Home', Home], ['course', 'My course', BookOpen], ['learn', 'Syllabus & notes', BookMarked], ['fees', 'Fees', Wallet], ['attendance', 'Attendance', CalendarCheck],
  ['grades', 'Grades', Award], ['documents', 'Documents', FileText], ['interview', 'Interview prep', Briefcase], ['help', 'Help desk', LifeBuoy], ['trainer', 'Ask a trainer', HandHelping], ['account', 'Account', User],
] as const
type Tab = (typeof TABS)[number][0]
const BOTTOM: Tab[] = ['home', 'course', 'fees', 'attendance']
const SUBTITLE: Record<Tab, string> = {
  home: 'Your day at a glance', course: 'Your course, batch and trainer', learn: 'What you have covered, and your trainer’s notes', fees: 'What you paid and what is next', attendance: 'Every class, day by day',
  grades: 'Tests, assignments and your project', documents: 'ID card, certificate and letters', interview: 'Practise, polish your resume and get job-ready', help: 'Ask your branch anything', trainer: 'Project or study help from any trainer', account: 'Your details and password',
}

type Props = {
  name: string; email: string; items: PortalItem[]; study: Study[]; profile: MyProfile | null
  announcements: Announcement[]; tickets: TicketRow[]; categories: { key: string; label: string }[]
  notes: NoteRow[]; help: HelpRequest[]; helpKinds: { key: string; label: string }[]
  /** The institute takes fees online (Settings → Online payments). */
  payOnline: boolean
}

export function StudentPortal(p: Props) {
  const brand = useBrand()
  const router = useRouter()
  const asked = useSearchParams().get('tab')
  const [tab, setTab] = useState<Tab>((TABS.find((t) => t[0] === asked)?.[0] ?? 'home') as Tab)
  const [regId, setRegId] = useState(p.study[0]?.registrationId ?? p.items[0]?.fee.registrationId ?? '')
  const [toast, setToast] = useState('')
  const [more, setMore] = useState(false)
  // the profile pop-up: shown until the profile is complete; "Later" hides it only until the next section
  const [laterOn, setLaterOn] = useState<string | null>(null)
  const askProfile = !!p.profile?.pending.length && laterOn !== tab && tab !== 'documents'
  const go = (t: Tab) => {
    setTab(t); setMore(false)
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u) } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const s = p.study.find((x) => x.registrationId === regId) ?? p.study[0] ?? null
  const item = p.items.find((x) => x.fee.registrationId === regId) ?? p.items[0] ?? null
  const say = (m: string) => { setToast(m); router.refresh() }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 6000); return () => clearTimeout(t) }, [toast])
  const answered = p.tickets.filter((t) => t.status === 'answered').length
  const offered = p.help.filter((h) => h.status === 'open' && h.offers.length > 0).length // trainers offered: the student picks one
  const badge = (k: Tab) => { const c = k === 'help' ? answered : k === 'trainer' ? offered : 0; return c > 0 ? <b className="pt-badge">{c}</b> : null }
  const current = TABS.find((t) => t[0] === tab)!
  const avatar = (cls = '') => p.profile?.photoId
    ? <img src={`/documents/${p.profile.photoId}`} alt="" className={`pt-avatar ${cls}`} />
    : <span className={`pt-avatar pt-initials ${cls}`}>{initials(p.name)}</span>

  return (
    <div className="pt">
      {/* sidebar (computer) */}
      <aside className="pt-side">
        <div className="pt-logo"><BrandMark brand={brand} height={34} /><span>Student portal</span></div>
        <nav className="pt-nav" aria-label="Portal sections">
          {TABS.map(([k, l, I]) => (
            <button key={k} type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}>
              <I size={18} /> <span>{l}</span>{badge(k)}
            </button>
          ))}
        </nav>
        <div className="pt-side-help">
          <Sparkles size={18} />
          <strong>Need a hand?</strong>
          <p>Questions about fees, classes or your certificate go straight to your branch.</p>
          <button type="button" onClick={() => go('help')}>Ask the branch <ArrowRight size={14} /></button>
        </div>
        <div className="pt-side-me">
          {avatar()}
          <div><strong>{p.name}</strong><small>{p.email}</small></div>
          <form action={logoutAction}><button type="submit" className="pt-icon" title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></form>
        </div>
      </aside>

      <div className="pt-main">
        <header className="pt-bar">
          <div className="pt-bar-title">
            <div className="pt-logo-mobile"><BrandMark brand={brand} height={30} /></div>
            <h1>{tab === 'home' ? 'Dashboard' : current[1]}</h1>
            <p>{SUBTITLE[tab]}</p>
          </div>
          <div className="pt-bar-right">
            {p.study.length > 1 && (
              <label className="pt-switch"><GraduationCap size={16} />
                <select value={regId} onChange={(e) => setRegId(e.target.value)} aria-label="Course">
                  {p.study.map((x) => <option key={x.registrationId} value={x.registrationId}>{x.course} · {x.regNo}</option>)}
                </select><ChevronDown size={15} />
              </label>
            )}
            <button type="button" className="pt-me-btn" onClick={() => go('account')} aria-label="My account">{avatar('sm')}</button>
          </div>
        </header>

        <main className="pt-content">
          {toast && <div role="status" className="pt-toast"><Check size={16} /> {toast}<button type="button" onClick={() => setToast('')} aria-label="Close"><X size={14} /></button></div>}
          {!s || !item ? (
            <div className="pt-card pt-empty"><span className="pt-empty-ic"><GraduationCap size={30} /></span><h2>No enrolment yet</h2><p>We could not find a course on your account. Please contact your branch office.</p></div>
          ) : (
            <div className="pt-fade" key={`${tab}-${regId}`}>
              {tab === 'home' && <HomeTab p={p} s={s} item={item} go={go} />}
              {tab === 'course' && <CourseTab s={s} />}
              {tab === 'learn' && <LearnTab s={s} notes={p.notes} />}
              {tab === 'fees' && <FeesTab s={s} item={item} payOnline={p.payOnline} say={say} />}
              {tab === 'attendance' && <AttendanceTab s={s} min={item.cert?.eligibility.minAttendancePct ?? 80} />}
              {tab === 'grades' && <GradesTab s={s} say={say} />}
              {tab === 'documents' && <DocumentsTab p={p} s={s} item={item} say={say} />}
              {tab === 'interview' && <InterviewPrep course={s.course} regId={s.registrationId} onAskTrainer={() => go('trainer')} />}
              {tab === 'help' && <HelpTab p={p} s={s} say={say} />}
              {tab === 'trainer' && <TrainerHelp p={p} s={s} say={say} />}
              {tab === 'account' && <AccountTab p={p} s={s} avatar={avatar('lg')} />}
            </div>
          )}
        </main>
      </div>

      {/* bottom bar (phone) */}
      <nav className="pt-bottom" aria-label="Portal sections">
        {BOTTOM.map((k) => { const [, l, I] = TABS.find((t) => t[0] === k)!; return <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => go(k)}><I size={20} /><span>{k === 'course' ? 'Course' : l}</span></button> })}
        <button type="button" className={!BOTTOM.includes(tab) ? 'on' : ''} onClick={() => setMore(true)}><MoreHorizontal size={20} /><span>More</span>{answered + offered > 0 && <b className="pt-badge dot" />}</button>
      </nav>
      {/* the student's birthday: balloons, confetti and a card (a small pill brings it back once closed) */}
      <BirthdayCelebration birthday={p.profile?.birthday} />
      {askProfile && p.profile && (
        <div className="pt-pop-bg">
          <div className="pt-pop" role="dialog" aria-modal="true" aria-label="Complete your profile">
            <div className="pt-pop-head"><span className="pt-task-ic"><ShieldCheck size={20} /></span><div><strong>Complete your profile</strong><small>Your ID card and records need these. This keeps coming back until they are done.</small></div></div>
            <PortalProfile name={p.name} profile={p.profile} card={PROFILE_CARD} onMsg={say} onLater={() => setLaterOn(tab)} />
          </div>
        </div>
      )}
      {more && (
        <div className="pt-sheet-bg" onClick={() => setMore(false)}>
          <div className="pt-sheet" onClick={(e) => e.stopPropagation()}>
            <i className="pt-grip" />
            {TABS.filter(([k]) => !BOTTOM.includes(k)).map(([k, l, I]) => (
              <button key={k} type="button" onClick={() => go(k)}><span className="pt-tile-ic"><I size={18} /></span>{l}{badge(k)}<ChevronRight size={16} /></button>
            ))}
            <form action={logoutAction}><button type="submit" className="pt-sheet-out"><LogOut size={18} /> Sign out</button></form>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- building blocks

function Card({ title, icon: I, children, aside, className = '' }: { title?: string; icon?: typeof Home; children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <section className={`pt-card ${className}`}>
      {title && <div className="pt-card-head"><h2>{I && <span className="pt-ic"><I size={16} /></span>}{title}</h2>{aside}</div>}
      {children}
    </section>
  )
}

type Tone = 'indigo' | 'green' | 'amber' | 'red' | 'sky' | 'violet'
function Kpi({ icon: I, label, value, sub, tone, onClick }: { icon: typeof Home; label: string; value: string; sub?: string; tone: Tone; onClick?: () => void }) {
  return (
    <button type="button" className={`pt-kpi t-${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="pt-kpi-ic"><I size={19} /></span>
      <span className="pt-kpi-txt"><small>{label}</small><strong>{value}</strong>{sub && <em>{sub}</em>}</span>
      {onClick && <ChevronRight size={16} className="pt-kpi-go" />}
    </button>
  )
}

/** A progress ring with the value in the middle. */
function Ring({ pct, size = 92, stroke = 9, label, value, tone = 'indigo', light }: { pct: number; size?: number; stroke?: number; label?: string; value: string; tone?: Tone; light?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  return (
    <div className={`pt-ring t-${tone}${light ? ' light' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="track" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="val" strokeDasharray={c} strokeDashoffset={c - (c * Math.max(0, Math.min(100, pct))) / 100} />
      </svg>
      <div><strong>{value}</strong>{label && <small>{label}</small>}</div>
    </div>
  )
}

const Bar = ({ pct, tone = 'indigo' }: { pct: number; tone?: Tone }) => <div className={`pt-meter t-${tone}`}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
const Pill = ({ tone, children }: { tone?: Tone | 'grey'; children: React.ReactNode }) => <span className={`pt-pill t-${tone ?? 'grey'}`}>{children}</span>
const Empty = ({ icon: I, title, text }: { icon: typeof Home; title: string; text: string }) => (
  <div className="pt-empty-in"><span className="pt-empty-ic"><I size={24} /></span><strong>{title}</strong><p>{text}</p></div>
)
const timing = (b: Study['batches'][number]) => (b.days?.length && b.start ? `${b.days.map((d) => WEEKDAYS[d - 1]).join(' · ')}  ${b.start} – ${b.end}` : b.timing ?? 'Timing to be announced')

function courseProgress(s: Study) {
  const start = s.joinedOn ?? s.enrolledOn
  if (!s.endsOn) return null
  const total = new Date(s.endsOn).getTime() - new Date(start).getTime()
  return total > 0 ? pctOf(Date.now() - new Date(start).getTime(), total) : null
}

/** The next class day of the student's batches, from now. */
function nextClass(s: Study) {
  const now = istNow()
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getTime() + add * 86400_000)
    const wd = ((d.getUTCDay() + 6) % 7) + 1
    const hm = now.toISOString().slice(11, 16)
    const b = s.batches.filter((x) => x.days?.includes(wd) && x.start && (add > 0 || (x.end ?? x.start) > hm)).sort((x, y) => (x.start! < y.start! ? -1 : 1))[0]
    if (b) return { batch: b, day: add === 0 ? 'Today' : add === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) }
  }
  return null
}

const greeting = () => { const h = istNow().getUTCHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' }

// ---- Home

function HomeTab({ p, s, item, go }: { p: Props; s: Study; item: PortalItem; go: (t: Tab) => void }) {
  const f = item.fee, c = item.cert, el = c?.eligibility
  const min = el?.minAttendancePct ?? 80
  const next = nextClass(s)
  const prog = courseProgress(s)
  const certLabel = c?.certificateId ? (c.revoked ? 'Revoked' : 'Issued') : c?.requestStatus === 'pending' ? 'Requested' : el?.eligible ? 'Ready' : 'In progress'
  const todo = p.profile?.pending ?? []
  const today = todayTopics(s)
  const nextInst = s.installments.find((i) => i.status !== 'paid')
  return (
    <>
      <section className="pt-hero">
        <div className="pt-hero-glow" aria-hidden />
        <div className="pt-hero-main">
          {p.profile?.photoId ? <img src={`/documents/${p.profile.photoId}`} alt="" className="pt-hero-photo" /> : <span className="pt-hero-photo pt-initials">{initials(p.name)}</span>}
          <div>
            <small>{greeting()}</small>
            <h2>{p.name.split(' ')[0]} 👋</h2>
            <p>{s.course}</p>
            <div className="pt-hero-tags"><span><IdCard size={13} /> {s.regNo}</span><span><MapPin size={13} /> {s.branch.name}</span><span className="ok"><i className="dot" />{s.status.replace('_', ' ')}</span></div>
          </div>
        </div>
        <div className="pt-hero-rings">
          <div><Ring light pct={prog ?? 0} value={prog == null ? '—' : `${prog}%`} tone="sky" /><span>Course done</span></div>
          <div><Ring light pct={s.attendance.pct} value={s.attendance.sessions ? `${s.attendance.pct}%` : '—'} tone={s.attendance.sessions && s.attendance.pct < min ? 'amber' : 'green'} /><span>Attendance</span></div>
        </div>
      </section>

      {todo.length > 0 && (
        <button type="button" className="pt-task" onClick={() => go('documents')}>
          <span className="pt-task-ic"><ShieldCheck size={20} /></span>
          <span className="pt-task-txt"><strong>Complete your profile</strong><small>The institute still needs {todo.length} thing{todo.length === 1 ? '' : 's'} for your ID card and records.</small>
            <span className="pt-task-steps">{(['photo', 'aadhaarNo', 'aadhaarCard'] as const).filter((k) => k !== 'aadhaarNo' || todo.includes(k)).map((k) => <em key={k} className={todo.includes(k) ? '' : 'done'}>{todo.includes(k) ? null : <Check size={11} />}{k === 'photo' ? 'Photo' : k === 'aadhaarNo' ? 'Aadhaar no.' : 'Aadhaar card'}</em>)}</span>
          </span>
          <span className="pt-task-go">Finish now <ArrowRight size={15} /></span>
        </button>
      )}
      {f.daysOverdue > 0 && <div className="pt-alert"><Wallet size={18} /><span><strong>Payment overdue.</strong> {inr(f.nextDueAmount ?? 0)} was due on {fmt(f.nextDue)} ({f.daysOverdue} days ago). Please pay at the branch office.</span></div>}

      <div className="pt-kpis">
        <Kpi icon={CalendarCheck} tone={!s.attendance.sessions ? 'indigo' : s.attendance.pct >= min ? 'green' : 'amber'} label="Attendance" value={s.attendance.sessions ? `${s.attendance.pct}%` : '—'} sub={s.attendance.sessions ? `${s.attendance.present}/${s.attendance.sessions} classes · need ${min}%` : 'No class marked yet'} onClick={() => go('attendance')} />
        <Kpi icon={Wallet} tone={f.daysOverdue > 0 ? 'red' : f.balance > 0 ? 'amber' : 'green'} label={f.balance > 0 ? 'Fees due' : 'Fees'} value={f.balance > 0 ? inr(f.balance) : 'All paid'} sub={f.nextDue ? `Next ${inr(f.nextDueAmount ?? 0)} by ${short(f.nextDue)}` : f.balance > 0 ? 'Balance left' : 'Nothing left to pay'} onClick={() => go('fees')} />
        <Kpi icon={Award} tone="violet" label="Grades" value={avgScore(s) == null ? '—' : `${avgScore(s)}%`} sub={`${s.grades.length} graded so far`} onClick={() => go('grades')} />
        <Kpi icon={BadgeCheck} tone={c?.certificateId && !c.revoked ? 'green' : 'sky'} label="Certificate" value={certLabel} sub={c?.certNo ?? (el?.eligible ? 'You can request it' : `${el?.reasons.length ?? 0} step${el?.reasons.length === 1 ? '' : 's'} left`)} onClick={() => go('documents')} />
      </div>

      <div className="pt-cols">
        <div className="pt-col">
          <Card title="Up next" icon={Clock}>
            <div className="pt-next">
              <div className="pt-next-item">
                <span className="pt-date"><b>{next ? (next.day === 'Today' || next.day === 'Tomorrow' ? next.day.slice(0, 3) : next.day.slice(0, 3)) : '—'}</b><small>class</small></span>
                <div><strong>{next ? `${next.batch.name}` : s.batches.length ? 'No class this week' : 'Batch not assigned yet'}</strong>
                  <small>{next ? `${next.day} · ${next.batch.start} – ${next.batch.end}${next.batch.room ? ` · Room ${next.batch.room}` : ''}` : 'Your branch puts you in a batch.'}</small>
                  {next?.batch.trainer && <small>with {next.batch.trainer}</small>}</div>
              </div>
              {s.batches.length > 0 && (
                <div className="pt-next-item">
                  <span className="pt-date"><b><BookMarked size={16} /></b><small>topic</small></span>
                  <div><strong>{today.length ? today.join(', ') : 'Today’s topic not marked yet'}</strong>
                    <small>{today.length ? 'Taught in class today, marked by your trainer' : 'Your trainer marks it after the class'}</small></div>
                </div>
              )}
              <div className="pt-next-item">
                <span className={`pt-date ${nextInst && nextInst.dueDate < todayIso() ? 'bad' : ''}`}><b>{nextInst ? short(nextInst.dueDate).split(' ')[0] : '✓'}</b><small>{nextInst ? short(nextInst.dueDate).split(' ')[1] : 'fees'}</small></span>
                <div><strong>{nextInst ? `Installment ${inr(nextInst.amount)}` : f.balance > 0 ? `Balance ${inr(f.balance)}` : 'Fees fully paid'}</strong>
                  <small>{nextInst ? `Due ${fmt(nextInst.dueDate)}${nextInst.dueDate < todayIso() ? ' · overdue' : ''}` : f.balance > 0 ? 'Ask the branch about your payment plan' : 'Thank you!'}</small></div>
              </div>
            </div>
          </Card>
          <Card title="Notice board" icon={Megaphone} aside={p.announcements.length ? <Pill tone="indigo">{p.announcements.length} new</Pill> : undefined}>
            <Notices list={p.announcements} />
          </Card>
        </div>
        <Card title="Quick actions" icon={Sparkles} className="pt-col-side">
          <div className="pt-actions">
            <a href={`/registrations/${s.registrationId}/id-card`} target="_blank" rel="noreferrer" className="t-indigo"><span><IdCard size={19} /></span>ID card</a>
            <button type="button" onClick={() => go('fees')} className="t-green"><span><Receipt size={19} /></span>Receipts</button>
            <button type="button" onClick={() => go('attendance')} className="t-sky"><span><CalendarDays size={19} /></span>Attendance</button>
            <button type="button" onClick={() => go('grades')} className="t-violet"><span><Award size={19} /></span>Grades</button>
            <button type="button" onClick={() => go('documents')} className="t-amber"><span><BadgeCheck size={19} /></span>Certificate</button>
            <button type="button" onClick={() => go('help')} className="t-red"><span><LifeBuoy size={19} /></span>Get help</button>
            <button type="button" onClick={() => go('interview')} className="t-indigo"><span><Briefcase size={19} /></span>Interview prep</button>
          </div>
        </Card>
      </div>
    </>
  )
}

/** What the trainer marked as taught today: syllabus topics ticked today, else the class topic written today. */
function todayTopics(s: Study) {
  const d = todayIso()
  const ticked = s.syllabus.filter((t) => t.coveredOn === d).map((t) => t.title)
  return ticked.length ? ticked : [...new Set(s.classes.filter((c) => c.date === d && c.topic).map((c) => c.topic!))]
}

function avgScore(s: Study) {
  const m = s.grades.filter((g) => g.kind !== 'capstone' && g.score != null && g.maxScore)
  return m.length ? Math.round(m.reduce((a, g) => a + (g.score! / g.maxScore!) * 100, 0) / m.length) : null
}

function Notices({ list }: { list: Announcement[] }) {
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null)
  if (!list.length) return <Empty icon={Megaphone} title="All quiet" text="Notices from your branch (holidays, exams, events) show up here." />
  return (
    <div className="pt-notices">
      {list.map((a) => (
        <div key={a.id} className={`pt-notice${a.pinned ? ' pinned' : ''}${open === a.id ? ' open' : ''}`}>
          <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
            <span className="pt-notice-dot" />
            <span className="pt-notice-t"><strong>{a.pinned && <Pin size={12} />} {a.title}</strong><small>{fmt(a.createdAt)} · {a.branch ?? 'All branches'}</small></span>
            <ChevronDown size={16} className="pt-chev" />
          </button>
          {open === a.id && <p>{a.body}</p>}
        </div>
      ))}
    </div>
  )
}

// ---- Course

function CourseTab({ s }: { s: Study }) {
  const prog = courseProgress(s)
  const steps = [['Enrolled', s.enrolledOn], ['Classes started', s.joinedOn], ['Course ends', s.endsOn]] as const
  const today = todayIso()
  return (
    <>
      <section className="pt-card pt-course">
        <div className="pt-course-top">
          <span className="pt-course-ic"><BookOpen size={26} /></span>
          <div><small>{s.department ?? 'Course'}</small><h2>{s.course}</h2>
            <div className="pt-chips"><Pill tone="indigo">{s.regNo}</Pill>{s.courseHours ? <Pill tone="sky">{s.courseHours} hours</Pill> : null}{s.classMode ? <Pill tone="violet">{s.classMode}</Pill> : null}<Pill tone="green">{s.status.replace('_', ' ')}</Pill></div></div>
          {prog != null && <Ring pct={prog} value={`${prog}%`} label="done" tone="indigo" />}
        </div>
        <ol className="pt-steps">
          {steps.map(([l, d]) => <li key={l} className={d && d <= today ? 'done' : ''}><span className="pt-step-dot">{d && d <= today ? <Check size={12} /> : null}</span><small>{l}</small><strong>{fmt(d)}</strong></li>)}
        </ol>
      </section>

      <Card title="Batch & trainer" icon={GraduationCap}>
        {!s.batches.length ? <Empty icon={GraduationCap} title="No batch yet" text="Your branch will put you in a batch soon. If it takes long, ask on the Help desk." /> : (
          <div className="pt-batches">
            {s.batches.map((b) => (
              <div key={b.name} className="pt-batch">
                <div className="pt-batch-h"><strong>{b.name}</strong><span><Clock size={14} /> {timing(b)}</span>{b.room && <span><MapPin size={14} /> Room {b.room}</span>}
                  {b.days?.length ? <div className="pt-week">{WEEKDAYS.map((w, k) => <i key={w} className={b.days!.includes(k + 1) ? 'on' : ''}>{w[0]}</i>)}</div> : null}</div>
                <div className="pt-person">
                  <span className="pt-avatar pt-initials md">{initials(b.trainer ?? '?')}</span>
                  <div><small>Your trainer</small><strong>{b.trainer ?? 'To be assigned'}</strong>{b.trainerEmail && <em>{b.trainerEmail}</em>}</div>
                  <div className="pt-person-act">
                    {b.trainerEmail && <a href={`mailto:${b.trainerEmail}`} title={`E-mail ${b.trainer}`} aria-label="E-mail trainer"><Mail size={16} /></a>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <BranchCard s={s} />
    </>
  )
}

function BranchCard({ s }: { s: Study }) {
  const b = s.branch
  return (
    <Card title="Your branch" icon={MapPin}>
      <div className="pt-branch">
        <div><strong>{b.name}</strong>{(b.address || b.city) && <p>{[b.address, b.city].filter(Boolean).join(', ')}</p>}</div>
        <div className="pt-branch-act">
          {b.phone && <a href={`tel:${b.phone}`}><Phone size={15} /> {b.phone}</a>}
          {b.email && <a href={`mailto:${b.email}`}><Mail size={15} /> {b.email}</a>}
        </div>
      </div>
    </Card>
  )
}

// ---- Fees

function FeesTab({ s, item, payOnline, say }: { s: Study; item: PortalItem; payOnline: boolean; say: (m: string) => void }) {
  const f = item.fee
  const total = f.charged - f.discounted
  const today = todayIso()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  // back from the payment page: how it went (the receipt is on the list below once it is recorded)
  const back = useSearchParams()
  useEffect(() => {
    const r = back.get('payment')
    if (!r) return
    say(r === 'paid' ? `Payment received${back.get('receipt') ? `: receipt ${back.get('receipt')}` : ''}. Thank you!` : r === 'review' ? 'Payment received. The office will confirm it and add the receipt.' : 'The payment was not completed. If money was taken, it is confirmed here within a few minutes.')
    try { const u = new URL(window.location.href); u.searchParams.delete('payment'); u.searchParams.delete('receipt'); window.history.replaceState(null, '', u) } catch { /* ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pay = () => start(async () => {
    setError('')
    const r = await startFeePaymentAction(f.registrationId)
    if (!r.ok) return setError(r.error)
    window.location.href = r.data!.url
  })
  return (
    <>
      {payOnline && item.payNow > 0 && (
        <section className="pt-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><strong style={{ display: 'block' }}>Pay {inr(item.payNow)} online</strong><small style={{ color: 'var(--pt-muted, #6b7394)' }}>UPI, card, net banking or wallet. Your receipt appears here at once.</small></div>
          <button type="button" className="pt-btn" disabled={pending} onClick={pay}><Wallet size={16} /> {pending ? 'Opening…' : 'Pay now'}</button>
          {error && <div style={{ flexBasis: '100%' }}><Err msg={error} /></div>}
        </section>
      )}
      <section className="pt-card pt-fees">
        <Ring pct={pctOf(f.paid, total)} size={128} stroke={12} value={`${pctOf(f.paid, total)}%`} label="paid" tone={f.balance > 0 ? 'indigo' : 'green'} />
        <div className="pt-fees-nums">
          <div><small>Total fees</small><strong>{inr(total)}</strong>{f.discounted > 0 && <em>after {inr(f.discounted)} discount</em>}</div>
          <div><small>Paid</small><strong className="c-green">{inr(f.paid)}</strong></div>
          <div><small>Balance</small><strong className={f.daysOverdue > 0 ? 'c-red' : f.balance > 0 ? 'c-amber' : 'c-green'}>{f.balance > 0 ? inr(f.balance) : 'Nothing due'}</strong>{f.nextDue && <em>next {inr(f.nextDueAmount ?? 0)} by {short(f.nextDue)}</em>}</div>
        </div>
      </section>
      <div className="pt-cols even">
        <Card title="Payment plan" icon={CalendarDays}>
          {!s.installments.length ? <Empty icon={CalendarDays} title={f.balance > 0 ? 'No dates set' : 'All paid'} text={f.balance > 0 ? 'Ask the branch office about your payment plan.' : 'Your fees are fully paid. Thank you!'} /> : (
            <ol className="pt-timeline">
              {s.installments.map((i, k) => {
                const st = i.status === 'paid' ? 'paid' : i.dueDate < today ? 'over' : 'up'
                return (
                  <li key={k} className={st}>
                    <span className="pt-tl-dot">{st === 'paid' ? <Check size={12} /> : k + 1}</span>
                    <div><strong>{inr(i.amount)}</strong><small>{st === 'paid' ? 'Paid' : st === 'over' ? 'Overdue since' : 'Due on'} {fmt(i.dueDate)}</small></div>
                    <Pill tone={st === 'paid' ? 'green' : st === 'over' ? 'red' : 'grey'}>{st === 'paid' ? 'Paid' : st === 'over' ? 'Overdue' : 'Upcoming'}</Pill>
                  </li>
                )
              })}
            </ol>
          )}
        </Card>
        <Card title="Receipts" icon={Receipt} aside={item.receipts.length ? <Pill tone="green">{item.receipts.length}</Pill> : undefined}>
          {!item.receipts.length ? <Empty icon={Receipt} title="No payments yet" text="Every payment you make gets a receipt here." /> : (
            <div className="pt-list">
              {item.receipts.map((r) => {
                const online = paymentChannel(r.mode) === 'online'
                return (
                  <div key={r.receiptNo} className="pt-list-row">
                    <span className="pt-tile-ic t-green"><Receipt size={17} /></span>
                    <div><strong>{r.cancelled ? <s>{inr(r.amount)}</s> : inr(r.amount)}</strong><small>{fmt(r.paidAt)} · {r.paperSlip ? `Slip · ${r.mode}` : online ? 'Online' : r.mode}{r.cancelled ? ' · Cancelled' : ''}</small><small className="mono">{r.receiptNo}</small></div>
                    <div className="pt-list-act">
                      <a href={`/receipts/${encodeURIComponent(r.receiptNo)}`} target="_blank" rel="noreferrer">View</a>
                      <a href={`/receipts/${encodeURIComponent(r.receiptNo)}/pdf`} aria-label="Download PDF">PDF</a>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="pt-note">All fees are non-refundable. Each receipt has a QR code anyone can scan to check it.</p>
        </Card>
      </div>
    </>
  )
}

// ---- Attendance

function AttendanceTab({ s, min }: { s: Study; min: number }) {
  const months = useMemo(() => {
    const m = [...new Set(s.classes.map((c) => c.date.slice(0, 7)))]
    const now = todayIso().slice(0, 7)
    return m.includes(now) || !m.length ? [now, ...m.filter((x) => x !== now)].sort().reverse() : m
  }, [s.classes])
  const [mi, setMi] = useState(0)
  const month = months[mi] ?? todayIso().slice(0, 7)
  const byDay = new Map<string, { present: number; absent: number; topics: string[] }>()
  for (const c of s.classes.filter((x) => x.date.startsWith(month))) {
    const d = byDay.get(c.date) ?? { present: 0, absent: 0, topics: [] }
    if (c.present) d.present++; else d.absent++
    if (c.topic) d.topics.push(c.topic)
    byDay.set(c.date, d)
  }
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const today = todayIso()
  const monthList = s.classes.filter((c) => c.date.startsWith(month))
  const mPresent = monthList.filter((c) => c.present).length
  const tone: Tone = !s.attendance.sessions ? 'indigo' : s.attendance.pct >= min ? 'green' : 'amber'
  return (
    <>
      <section className="pt-card pt-att">
        <Ring pct={s.attendance.pct} size={128} stroke={12} value={s.attendance.sessions ? `${s.attendance.pct}%` : '—'} label="overall" tone={tone} />
        <div className="pt-att-nums">
          <div><span className="pt-sw g" /><small>Present</small><strong>{s.attendance.present}</strong></div>
          <div><span className="pt-sw r" /><small>Absent</small><strong>{s.attendance.sessions - s.attendance.present}</strong></div>
          <div><span className="pt-sw i" /><small>Classes</small><strong>{s.attendance.sessions}</strong></div>
        </div>
        <div className="pt-att-goal">
          <div className="pt-goal-label"><span>Certificate needs {min}%</span><span>{s.attendance.sessions ? (s.attendance.pct >= min ? 'On track ✓' : `${min - s.attendance.pct}% short`) : '—'}</span></div>
          <div className="pt-goal"><Bar pct={s.attendance.pct} tone={tone} /><b className="pt-goal-mark" style={{ left: `${min}%` }} title={`${min}% needed`} /></div>
        </div>
      </section>
      <Card title={new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} icon={CalendarDays}
        aside={<div className="pt-mnav"><button type="button" disabled={mi >= months.length - 1} onClick={() => setMi(mi + 1)} aria-label="Earlier month"><ChevronLeft size={16} /></button><button type="button" disabled={mi === 0} onClick={() => setMi(mi - 1)} aria-label="Later month"><ChevronRight size={16} /></button></div>}>
        <div className="pt-cal">
          {WEEKDAYS.map((w) => <b key={w}>{w}</b>)}
          {Array.from({ length: lead }, (_, k) => <span key={`l${k}`} className="pad" />)}
          {Array.from({ length: days }, (_, k) => {
            const iso = `${month}-${String(k + 1).padStart(2, '0')}`
            const d = byDay.get(iso)
            const cls = d ? (d.absent && d.present ? 'part' : d.absent ? 'abs' : 'pre') : ''
            return <span key={iso} className={`${cls}${iso === today ? ' today' : ''}`} title={d ? `${d.present ? 'Present' : 'Absent'}${d.topics.length ? ` · ${d.topics.join(', ')}` : ''}` : undefined}>{k + 1}</span>
          })}
        </div>
        <div className="pt-legend"><span><i className="pre" /> Present</span><span><i className="abs" /> Absent</span><span><i className="today" /> Today</span>{monthList.length > 0 && <span className="right">{mPresent} of {monthList.length} this month</span>}</div>
      </Card>
      <Card title="Class log" icon={CalendarCheck}>
        {!monthList.length ? <Empty icon={CalendarCheck} title="No classes marked this month" text="Your trainer marks attendance after each class." /> : (
          <div className="pt-list">
            {monthList.map((c, k) => (
              <div key={k} className="pt-list-row">
                <span className={`pt-date sm ${c.present ? 'ok' : 'bad'}`}><b>{c.date.slice(8)}</b><small>{new Date(`${c.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</small></span>
                <div><strong>{c.topic ?? 'Class'}</strong><small>{c.batch}</small></div>
                <Pill tone={c.present ? 'green' : 'red'}>{c.present ? 'Present' : 'Absent'}</Pill>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

// ---- Grades

function GradesTab({ s, say }: { s: Study; say: (m: string) => void }) {
  const avg = avgScore(s)
  const cap = s.grades.filter((g) => g.kind === 'capstone')
  const label = { assignment: 'Assignment', test: 'Test', capstone: 'Capstone project' } as const
  const marked = s.grades.filter((g) => g.kind !== 'capstone')
  return (
    <>
      <div className="pt-kpis three">
        <Kpi icon={Award} tone={avg == null ? 'indigo' : avg >= 60 ? 'green' : 'amber'} label="Average score" value={avg == null ? '—' : `${avg}%`} sub={avg == null ? 'No marks yet' : avg >= 75 ? 'Excellent work!' : avg >= 60 ? 'Good going' : 'Keep practising'} />
        <Kpi icon={FileText} tone="sky" label="Tests & assignments" value={String(marked.length)} sub="graded" />
        <Kpi icon={BadgeCheck} tone={cap.some((c) => c.approved) ? 'green' : 'violet'} label="Capstone project" value={cap.some((c) => c.approved) ? 'Approved' : cap.length ? 'Submitted' : 'Not yet'} sub="needed for the certificate" />
      </div>
      <ProjectCard s={s} say={say} />
      {s.grades.some((g) => g.kind !== 'capstone' && g.score != null) && <div className="pt-form-act" style={{ justifyContent: 'flex-end' }}><a className="pt-btn ghost" href={`/registrations/${s.registrationId}/report-card`} target="_blank" rel="noreferrer"><FileText size={15} /> My report card</a></div>}
      <Card title="All grades" icon={Award}>
        {!s.grades.length ? <Empty icon={Award} title="No grades yet" text="Your trainer adds marks after tests and assignments." /> : (
          <div className="pt-grades">
            {s.grades.map((g, k) => {
              const pct = g.score != null && g.maxScore ? pctOf(g.score, g.maxScore) : null
              const tone: Tone = pct == null ? 'indigo' : pct >= 75 ? 'green' : pct >= 50 ? 'amber' : 'red'
              return (
                <div key={k} className="pt-grade">
                  <span className={`pt-tile-ic t-${g.kind === 'capstone' ? 'violet' : g.kind === 'test' ? 'sky' : 'indigo'}`}>{g.kind === 'capstone' ? <BadgeCheck size={17} /> : g.kind === 'test' ? <FileText size={17} /> : <BookOpen size={17} />}</span>
                  <div className="pt-grade-t"><strong>{g.title}</strong><small>{label[g.kind]} · {fmt(g.at)}{g.sheetDocId ? <> · <a href={`/documents/${g.sheetDocId}`} target="_blank" rel="noreferrer">answer sheet</a></> : null}</small>
                    {pct != null && <Bar pct={pct} tone={tone} />}</div>
                  {g.kind === 'capstone' ? <Pill tone={g.approved ? 'green' : 'amber'}>{g.approved ? 'Approved' : 'Under review'}</Pill>
                    : pct == null ? <Pill>—</Pill> : <div className={`pt-score c-${tone}`}><strong>{pct}%</strong><small>{g.score}/{g.maxScore}</small></div>}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}

/**
 * The capstone project: the student names it (and what it was built with); the trainer checks and approves it, and the
 * project certificate prints it. Fixed once approved.
 */
function ProjectCard({ s, say }: { s: Study; say: (m: string) => void }) {
  const cap = s.grades.find((g) => g.kind === 'capstone') // the latest (grades come newest first)
  const named = namedProject(cap?.title)
  const [editing, setEditing] = useState(!named)
  const [form, setForm] = useState({ title: named ?? '', tools: cap?.tools ?? '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    setError('')
    const r = await submitMyProjectAction(s.registrationId, form)
    if (!r.ok) return setError(r.error)
    setEditing(false); say('Project sent to your trainer to check')
  })
  if (cap?.approved) return (
    <Card title="Your project" icon={BadgeCheck} aside={<Pill tone="green">Approved</Pill>}>
      <p className="pt-note"><strong>{named ?? cap.title}</strong>{cap.tools ? ` · ${cap.tools}` : ''}</p>
      <p className="pt-note">Approved by your trainer. Your project certificate prints this title.</p>
    </Card>
  )
  return (
    <Card title="Your project" icon={BadgeCheck} aside={named ? <Pill tone="amber">Waiting for your trainer</Pill> : undefined}>
      {!editing ? (
        <>
          <p className="pt-note"><strong>{named}</strong>{cap?.tools ? ` · ${cap.tools}` : ''}</p>
          <p className="pt-note">Your trainer checks it and approves it. Until then you can still change it.</p>
          <div className="pt-form-act"><button type="button" className="pt-btn ghost" onClick={() => setEditing(true)}>Change</button></div>
        </>
      ) : (
        <>
          <p className="pt-note">Name the project you built. After your trainer approves it, this title is printed on your project certificate, so check the spelling.</p>
          <div className="pt-form">
            <label>Project title<input value={form.title} maxLength={120} placeholder="e.g. Student Management System" onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Tools used<input value={form.tools} maxLength={300} placeholder="e.g. React, Node.js, Express.js, MySQL" onChange={(e) => setForm({ ...form, tools: e.target.value })} /></label>
          </div>
          <Err msg={error} />
          <div className="pt-form-act">
            {named && <button type="button" className="pt-btn ghost" onClick={() => { setForm({ title: named, tools: cap?.tools ?? '' }); setEditing(false) }}>Cancel</button>}
            <button type="button" className="pt-btn" disabled={pending || form.title.trim().length < 3} onClick={save}><Send size={15} /> {pending ? 'Sending…' : 'Send to my trainer'}</button>
          </div>
        </>
      )}
    </Card>
  )
}

// ---- Documents

function DocumentsTab({ p, s, item, say }: { p: Props; s: Study; item: PortalItem; say: (m: string) => void }) {
  const [pending, start] = useTransition()
  const c = item.cert, el = c?.eligibility
  const issued = s.letters.filter((l) => l.offerIssuedAt || l.completedAt)
  const certReady = !!(c?.certificateId && c.verificationHash)
  return (
    <>
      <div className="pt-docs">
        <div className="pt-doc t-indigo">
          <span className="pt-doc-ic"><IdCard size={24} /></span>
          <strong>Student ID card</strong>
          <p>{p.profile?.photoId ? 'With your photo and a QR code to verify it.' : 'Add your photo below so it shows on the card.'}</p>
          <a className="pt-btn" href={`/registrations/${s.registrationId}/id-card`} target="_blank" rel="noreferrer"><Printer size={15} /> Open & print</a>
        </div>
        <div className={`pt-doc ${certReady && !c!.revoked ? 't-green' : 't-amber'}`}>
          <span className="pt-doc-ic"><BadgeCheck size={24} /></span>
          <strong>Course certificate</strong>
          {certReady ? <>
            <p>{c!.revoked ? 'This certificate was revoked.' : `Issued · ${c!.certNo}`}</p>
            <div className="pt-doc-act"><a className="pt-btn" href={`/verify/${c!.verificationHash}/certificate`} target="_blank" rel="noreferrer"><Printer size={15} /> View</a>
              {c!.projectCertificate && <a className="pt-btn ghost" href={`/verify/${c!.verificationHash}/certificate?kind=project`} target="_blank" rel="noreferrer">Project</a>}</div>
          </> : c?.requestStatus === 'pending' ? <p>Requested. It appears here once the branch issues it.</p>
            : el?.eligible ? <>
              <p>Everything is complete. You can ask for it now.</p>
              <button className="pt-btn" disabled={pending} onClick={() => start(async () => { const r = await requestCertificateAction(s.registrationId); say(r.ok ? 'Certificate requested. It appears here once issued.' : r.error) })}>{pending ? 'Requesting…' : 'Request certificate'}</button>
            </> : <ul className="pt-todo">{el?.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
        </div>
        <div className={`pt-doc ${issued.length ? 't-violet' : 't-grey'}`}>
          <span className="pt-doc-ic"><FileText size={24} /></span>
          <strong>Internship letters</strong>
          {!issued.length ? <p>{s.letters.length ? 'Being prepared. They appear here once issued.' : 'No internship letters on this enrolment.'}</p> : issued.map((l) => (
            <div key={l.id} className="pt-doc-act">
              {l.offerIssuedAt && <a className="pt-btn" href={`/letters/${l.id}/internship_offer`} target="_blank" rel="noreferrer">Selection letter</a>}
              {l.completedAt && <a className="pt-btn ghost" href={`/letters/${l.id}/internship_completion`} target="_blank" rel="noreferrer">Completion</a>}
            </div>
          ))}
        </div>
      </div>
      {p.profile && <div className="pt-profile-wrap"><h3><ShieldCheck size={17} /> My profile & documents</h3><PortalProfile name={p.name} profile={p.profile} card={PROFILE_CARD} onMsg={say} /></div>}
    </>
  )
}
/** PortalProfile draws its own boxes: the same look as the portal cards. */
const PROFILE_CARD: React.CSSProperties = { background: '#fff', border: '1px solid #e9ebf6', borderRadius: 20, padding: 20, marginBottom: 16, boxShadow: '0 1px 2px #10186a08, 0 12px 32px -22px #10186a40' }

// ---- Help

const FAQ = [
  ['How do I pay my fees?', 'Pay at your branch office (cash, card or UPI), or online under Fees when your institute takes online payments. Every payment gets a receipt here under Fees, with a QR code anyone can scan to check it.'],
  ['My attendance looks wrong.', 'Your trainer marks attendance after each class. If a day is wrong, raise a question (Attendance) with the date.'],
  ['When do I get my certificate?', 'When your fees are paid, attendance is above what is needed and your capstone project is approved, request it under Documents.'],
  ['I forgot my password.', 'On the sign-in page choose “Forgot password” and enter your e-mail. You get a link to set a new one.'],
  ['How do I change my photo?', 'Under Documents, upload a new photo. It replaces the old one on your ID card.'],
] as const

function HelpTab({ p, s, say }: { p: Props; s: Study; say: (m: string) => void }) {
  const [raising, setRaising] = useState(!p.tickets.length)
  const [form, setForm] = useState({ category: 'fees', subject: '', body: '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [open, setOpen] = useState<string | null>(p.tickets.find((t) => t.status === 'answered')?.id ?? null)
  const raise = () => start(async () => {
    setError('')
    const r = await raiseTicketAction({ registrationId: s.registrationId, category: form.category as never, subject: form.subject, body: form.body })
    if (!r.ok) return setError(r.error)
    setForm({ category: 'fees', subject: '', body: '' }); setRaising(false); say(`Question ${r.data!.ticketNo} sent. The branch answers here, and you get an e-mail.`)
  })
  return (
    <>
      <section className="pt-help-hero">
        <div><span className="pt-help-ic"><LifeBuoy size={22} /></span><h2>How can we help, {p.name.split(' ')[0]}?</h2><p>Ask your branch about fees, classes, attendance or your certificate. They reply right here.</p></div>
        {!raising && <button type="button" className="pt-btn light" onClick={() => setRaising(true)}><Send size={15} /> Ask a question</button>}
      </section>
      {raising && (
        <Card title="New question" icon={Send} aside={p.tickets.length > 0 ? <button type="button" className="pt-x" onClick={() => setRaising(false)} aria-label="Cancel"><X size={16} /></button> : undefined}>
          <div className="pt-cats">{p.categories.map((c) => <button key={c.key} type="button" className={form.category === c.key ? 'on' : ''} onClick={() => setForm({ ...form, category: c.key })}>{c.label}</button>)}</div>
          <div className="pt-form">
            <label>Subject<input value={form.subject} maxLength={150} placeholder="e.g. My receipt for October is missing" onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
            <label>Your question<textarea rows={4} value={form.body} maxLength={4000} placeholder="Tell us what you need. Add dates or amounts if it helps." onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          </div>
          <Err msg={error} />
          <div className="pt-form-act"><button type="button" className="pt-btn" disabled={pending || form.subject.trim().length < 3 || form.body.trim().length < 2} onClick={raise}><Send size={15} /> {pending ? 'Sending…' : 'Send to the branch'}</button></div>
        </Card>
      )}
      {p.tickets.length > 0 && (
        <Card title="My questions" icon={CircleHelp} aside={<Pill tone="indigo">{p.tickets.length}</Pill>}>
          <div className="pt-tickets">
            {p.tickets.map((t) => (
              <div key={t.id} className={`pt-ticket${open === t.id ? ' open' : ''}`}>
                <button type="button" className="pt-ticket-h" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
                  <span className={`pt-tile-ic t-${t.status === 'answered' ? 'sky' : t.status === 'closed' ? 'grey' : 'amber'}`}><CircleHelp size={17} /></span>
                  <span className="pt-ticket-t"><strong>{t.subject}</strong><small>{t.ticketNo} · {p.categories.find((c) => c.key === t.category)?.label ?? t.category} · {when(t.updatedAt)}</small></span>
                  <Pill tone={t.status === 'answered' ? 'sky' : t.status === 'closed' ? 'grey' : 'amber'}>{t.status === 'answered' ? 'New reply' : t.status === 'closed' ? 'Closed' : 'Waiting'}</Pill>
                </button>
                {open === t.id && <Thread t={t} say={say} />}
              </div>
            ))}
          </div>
        </Card>
      )}
      <div className="pt-cols even">
        <BranchCard s={s} />
        <Card title="Common questions" icon={CircleHelp}>
          <div className="pt-faq">{FAQ.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={16} /></summary><p>{a}</p></details>)}</div>
        </Card>
      </div>
    </>
  )
}

function Thread({ t, say }: { t: TicketRow; say: (m: string) => void }) {
  const [msgs, setMsgs] = useState<TicketMessage[] | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const load = () => ticketMessagesAction(t.id).then((r) => (r.ok ? setMsgs(r.data!) : setError(r.error)))
  useEffect(() => { void load() }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => start(async () => { setError(''); const r = await replyTicketAction(t.id, reply); if (!r.ok) return setError(r.error); setReply(''); await load(); say('Sent to the branch') })
  const close = () => start(async () => { const r = await closeTicketAction(t.id); if (!r.ok) return setError(r.error); say(`${t.ticketNo} closed. Glad we could help!`) })
  return (
    <div className="pt-chat">
      {t.status === 'open' && t.dueAt && <p className="pt-note">The branch usually replies by {when(t.dueAt)}.</p>}
      {msgs === null ? <p className="pt-note">Loading…</p> : msgs.map((m) => (
        <div key={m.id} className={`pt-msg ${m.fromStaff ? 'them' : 'me'}`}>
          {m.fromStaff && <span className="pt-avatar pt-initials xs">TC</span>}
          <div><div className="pt-bubble">{m.body}</div><small>{m.fromStaff ? 'Branch office' : 'You'} · {when(m.at)}</small></div>
        </div>
      ))}
      <div className="pt-compose">
        <textarea rows={2} value={reply} placeholder={t.status === 'closed' ? 'Write again to reopen it…' : 'Write a reply…'} onChange={(e) => { setReply(e.target.value); setError('') }} />
        <button type="button" className="pt-send" disabled={pending || reply.trim().length < 2} onClick={send} aria-label="Send"><Send size={17} /></button>
      </div>
      <Err msg={error} />
      {t.status !== 'closed' && <button type="button" className="pt-link" disabled={pending} onClick={close}><Check size={14} /> My question is answered — close it</button>}
      {/* once the branch has answered: how was the help? */}
      {t.status !== 'open' && <Rate t={t} onChanged={say} />}
    </div>
  )
}

// ---- Account

function AccountTab({ p, s, avatar }: { p: Props; s: Study; avatar: React.ReactNode }) {
  return (
    <div className="pt-cols even">
      <section className="pt-card pt-account">
        {avatar}
        <h2>{p.name}</h2>
        <p>{p.email}</p>
        <div className="pt-chips center"><Pill tone="indigo">{s.regNo}</Pill><Pill tone="sky">{s.branch.name}</Pill></div>
        <dl className="pt-dl">
          <div><dt>Course</dt><dd>{s.course}</dd></div>
          <div><dt>Enrolled</dt><dd>{fmt(s.enrolledOn)}</dd></div>
          {p.profile?.aadhaarLast4 && <div><dt>Aadhaar</dt><dd>•••• {p.profile.aadhaarLast4}</dd></div>}
        </dl>
        <p className="pt-note">To correct your name, phone or e-mail, ask your branch on the Help desk.</p>
        <form action={logoutAction}><button className="pt-btn ghost wide" type="submit"><LogOut size={15} /> Sign out</button></form>
      </section>
      <Card title="Change password" icon={ShieldCheck}><ChangePasswordForm /></Card>
    </div>
  )
}

// ---- Syllabus & notes

function LearnTab({ s, notes }: { s: Study; notes: NoteRow[] }) {
  const done = s.syllabus.filter((t) => t.coveredOn).length
  const pct = s.syllabus.length ? pctOf(done, s.syllabus.length) : 0
  const next = s.syllabus.find((t) => !t.coveredOn)
  const last = [...s.syllabus].filter((t) => t.coveredOn).sort((a, b) => (a.coveredOn! < b.coveredOn! ? 1 : -1))[0]
  return (
    <>
      <section className="pt-card pt-fees">
        <Ring pct={pct} size={120} stroke={11} value={`${pct}%`} label="covered" tone="violet" />
        <div className="pt-fees-nums">
          <div><small>Topics covered</small><strong>{done} / {s.syllabus.length}</strong></div>
          <div><small>{last?.coveredOn === todayIso() ? 'Today’s topic' : 'Last class'}</small><strong className="pt-small">{last ? last.title : '—'}</strong>{last && <em>{last.coveredOn === todayIso() ? 'Today' : fmt(last.coveredOn)}</em>}</div>
          <div><small>Coming up</small><strong className="pt-small">{next ? next.title : s.syllabus.length ? 'All done 🎉' : '—'}</strong></div>
        </div>
      </section>
      <div className="pt-cols">
        <Card title="Syllabus" icon={BookMarked} aside={s.syllabusFile && s.courseId ? <a className="pt-btn ghost" href={`/api/syllabus/${s.courseId}`}><FileText size={14} /> Syllabus PDF</a> : undefined}>
          {!s.syllabus.length ? <Empty icon={BookMarked} title="Syllabus coming soon" text="Your branch adds the course topics. You will see each one ticked as your trainer teaches it." /> : (
            <ol className="pt-syl">
              {s.syllabus.map((t, i) => (
                <li key={i} className={t.coveredOn ? 'done' : t === next ? 'next' : ''}>
                  {(i === 0 || s.syllabus[i - 1].module !== t.module) && t.module && <h4>{t.module}</h4>}
                  <div><span className="pt-syl-dot">{t.coveredOn ? <Check size={12} /> : i + 1}</span><strong>{t.title}</strong><small>{t.coveredOn ? `Taught ${fmt(t.coveredOn)}` : t === next ? 'Next' : ''}</small></div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Notes from your trainer" icon={FileText} aside={notes.length ? <Pill tone="indigo">{notes.length}</Pill> : undefined}>
          {!notes.length ? <Empty icon={FileText} title="No notes yet" text="Links and files your trainer shares with your batch show up here." /> : (
            <div className="pt-list">
              {notes.map((n) => (
                <div key={n.id} className="pt-list-row">
                  <span className="pt-tile-ic t-violet">{n.url ? <Link2 size={17} /> : <FileText size={17} />}</span>
                  <div><strong>{n.title}</strong>{n.body && <small>{n.body}</small>}<small>{n.by ?? 'Trainer'} · {fmt(n.at)}</small></div>
                  <div className="pt-list-act">
                    {n.url && <a href={n.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>}
                    {n.fileName && <a href={`/api/notes/${n.id}`}>File</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ---- help from trainers (project, a stuck topic, career)

function TrainerHelp({ p, s, say }: { p: Props; s: Study; say: (m: string) => void }) {
  const [asking, setAsking] = useState(false)
  const [form, setForm] = useState({ kind: 'project', title: '', details: '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const ask = () => start(async () => {
    setError('')
    const r = await askHelpAction({ kind: form.kind as never, title: form.title, details: form.details, registrationId: s.registrationId })
    if (!r.ok) return setError(r.error)
    setAsking(false); setForm({ kind: 'project', title: '', details: '' }); say(`Request ${r.data!.no} sent to every trainer. Pick one when they offer.`)
  })
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { const r = await fn(); say(r.ok ? done : r.error ?? 'Could not save') })
  const kind = (k: string) => p.helpKinds.find((x) => x.key === k)?.label ?? k
  return (
    <Card title="Ask a trainer" icon={HandHelping} aside={!asking ? <button type="button" className="pt-btn" onClick={() => setAsking(true)}><HandHelping size={15} /> Ask for help</button> : <button type="button" className="pt-x" onClick={() => setAsking(false)} aria-label="Cancel"><X size={16} /></button>}>
      <p className="pt-note" style={{ margin: '-6px 0 12px' }}>Stuck on a project, a topic, or getting ready for interviews? Every trainer of every branch sees your request. Those who can help offer, and you pick one.</p>
      {asking && (
        <div className="pt-ask">
          <div className="pt-cats">{p.helpKinds.map((k) => <button key={k.key} type="button" className={form.kind === k.key ? 'on' : ''} onClick={() => setForm({ ...form, kind: k.key })}>{k.label}</button>)}</div>
          <div className="pt-form">
            <label>What do you need help with?<input value={form.title} maxLength={150} placeholder="e.g. My e-commerce project: login is not working" onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Details<textarea rows={4} value={form.details} maxLength={4000} placeholder="What you have tried, the tools you use, when you are free…" onChange={(e) => setForm({ ...form, details: e.target.value })} /></label>
          </div>
          <Err msg={error} />
          <div className="pt-form-act"><button type="button" className="pt-btn" disabled={pending || form.title.trim().length < 3 || form.details.trim().length < 5} onClick={ask}><Send size={15} /> {pending ? 'Sending…' : 'Send to all trainers'}</button></div>
        </div>
      )}
      {p.help.length > 0 && (
        <div className="pt-helps">
          {p.help.map((h) => (
            <div key={h.id} className="pt-help">
              <div className="pt-help-h">
                <span className={`pt-tile-ic t-${h.status === 'assigned' ? 'green' : h.status === 'open' ? 'amber' : 'grey'}`}><HandHelping size={17} /></span>
                <div><strong>{h.title}</strong><small>{h.no} · {kind(h.kind)} · {when(h.at)}</small></div>
                <Pill tone={h.status === 'assigned' ? 'green' : h.status === 'open' ? (h.offers.length ? 'sky' : 'amber') : 'grey'}>{h.status === 'open' ? (h.offers.length ? `${h.offers.length} offer${h.offers.length === 1 ? '' : 's'}` : 'Waiting for trainers') : h.status === 'assigned' ? 'Trainer chosen' : h.status === 'done' ? 'Done' : 'Cancelled'}</Pill>
              </div>
              {h.status === 'open' && h.offers.length > 0 && (
                <div className="pt-offers">
                  <small>Pick the trainer you want:</small>
                  {h.offers.map((o) => (
                    <div key={o.trainerId} className="pt-offer">
                      <span className="pt-avatar pt-initials md">{initials(o.trainer)}</span>
                      <div><strong>{o.trainer}</strong><small>{o.branch ?? ''}</small>{o.message && <p>“{o.message}”</p>}</div>
                      <button type="button" className="pt-btn" disabled={pending} onClick={() => act(() => chooseHelperAction(h.id, o.trainerId), `${o.trainer} will help you. Their contact is shown here.`)}>Choose</button>
                    </div>
                  ))}
                </div>
              )}
              {h.chosen && h.status !== 'cancelled' && (
                <div className="pt-person" style={{ marginTop: 10 }}>
                  <span className="pt-avatar pt-initials md">{initials(h.chosen.trainer)}</span>
                  <div><small>Helping you</small><strong>{h.chosen.trainer}</strong><em>{h.chosen.branch}</em></div>
                  <div className="pt-person-act">
                    {h.chosen.email && <a href={`mailto:${h.chosen.email}`} aria-label="E-mail"><Mail size={16} /></a>}
                  </div>
                </div>
              )}
              {(h.status === 'open' || h.status === 'assigned') && (
                <div className="pt-help-act">
                  {h.status === 'assigned' && <button type="button" className="pt-link" disabled={pending} onClick={() => act(() => closeHelpAction(h.id, 'done'), 'Great! Marked as done.')}><Check size={14} /> I got the help — done</button>}
                  {h.status === 'open' && <button type="button" className="pt-link muted" disabled={pending} onClick={() => act(() => closeHelpAction(h.id, 'cancelled'), 'Request cancelled')}><X size={14} /> Cancel request</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
