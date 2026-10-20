'use client'
// Tickets. The Help Desk (head office, branch managers): every ticket of the branch — students' questions from their
// portal and internal tickets staff raise. My Tickets (every staff member): the internal tickets I raised and the
// tickets given to me, and "Raise a ticket". Each has a priority with its SLA timer, an assignee, escalation (by the
// clock: to the branch manager when overdue, to head office a day later; or by hand) and, once answered, a rating.
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Clock, LifeBuoy, Plus, Send, Star, UserRound } from 'lucide-react'
import { Rate, Stars } from '@/components/ticket-rating'
import { assignTicketAction, closeTicketAction, escalateTicketAction, raiseInternalTicketAction, replyTicketAction, setTicketPriorityAction, ticketAssigneesAction, ticketMessagesAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { ExportButton } from '@/components/export-button'
import { useNotify } from '@/components/panel-shell'
import type { TicketMessage, TicketRow } from '@/modules/support/service'

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
export const TICKET_STATUS: Record<TicketRow['status'], { label: string; tone: string }> = {
  open: { label: 'Waiting for reply', tone: 'amber' }, answered: { label: 'Answered', tone: 'blue' }, closed: { label: 'Closed', tone: 'slate' },
}
const PRIORITY: Record<TicketRow['priority'], { label: string; tone: string }> = {
  urgent: { label: 'Urgent', tone: 'red' }, high: { label: 'High', tone: 'amber' }, normal: { label: 'Normal', tone: 'slate' }, low: { label: 'Low', tone: 'slate' },
}
const ESCALATION = ['', 'Escalated to branch manager', 'Escalated to head office'] as const

/** "Reply due in 3 h" / "Overdue by 2 h" while the ticket waits for the branch. */
export function sla(t: Pick<TicketRow, 'status' | 'dueAt'>, now = Date.now()) {
  if (t.status !== 'open' || !t.dueAt) return null
  const ms = new Date(t.dueAt).getTime() - now
  const span = (m: number) => { const h = Math.floor(Math.abs(m) / 3600000), d = Math.floor(h / 24); return d >= 1 ? `${d} d ${h % 24} h` : h >= 1 ? `${h} h` : `${Math.max(1, Math.round(Math.abs(m) / 60000))} min` }
  return ms >= 0 ? { overdue: false, text: `Reply due in ${span(ms)}`, soon: ms < 2 * 3600000 } : { overdue: true, text: `Overdue by ${span(ms)}`, soon: true }
}

type Filter = 'open' | 'answered' | 'closed' | 'all' | 'overdue' | 'escalated' | 'internal' | 'student' | 'mine'

export function HelpDesk({ rows, categories, internalCategories = [], priorities = [], showBranch, mode = 'desk', meId }: {
  rows: TicketRow[]; categories: Record<string, string>; showBranch: boolean
  internalCategories?: { key: string; label: string }[]; priorities?: { key: string; label: string; hours: number }[]
  mode?: 'desk' | 'mine'; meId?: string
}) {
  const router = useRouter()
  const notify = useNotify()
  const [filter, setFilter] = useState<Filter>('open')
  const [openId, setOpenId] = useState<string | null>(null)
  const [raising, setRaising] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t) }, []) // the SLA timers tick
  const test: Record<Filter, (r: TicketRow) => boolean> = {
    open: (r) => r.status === 'open', answered: (r) => r.status === 'answered', closed: (r) => r.status === 'closed', all: () => true,
    overdue: (r) => !!sla(r, now)?.overdue, escalated: (r) => r.status !== 'closed' && r.escalationLevel > 0, internal: (r) => r.kind === 'internal', student: (r) => r.kind === 'student',
    mine: (r) => r.assignedTo?.id === meId,
  }
  const shown = rows.filter(test[filter])
  const current = rows.find((r) => r.id === openId) ?? null
  const rated = rows.filter((r) => r.rating != null)
  const avg = rated.length ? Math.round((rated.reduce((s, r) => s + r.rating!, 0) / rated.length) * 10) / 10 : null
  const tabs: [Filter, string][] = mode === 'desk'
    ? [['open', 'Waiting'], ['overdue', 'Overdue'], ['escalated', 'Escalated'], ['mine', 'Mine'], ['answered', 'Answered'], ['closed', 'Closed'], ['internal', 'Staff'], ['all', 'All']]
    : [['open', 'Waiting'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']]
  const allCats = { ...categories, ...Object.fromEntries(internalCategories.map((c) => [c.key, c.label])) }
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{mode === 'desk' ? 'Management / Help Desk' : 'Overview / My Tickets'}</p>
          <h1>{mode === 'desk' ? 'Help Desk' : 'My Tickets'}</h1>
          <p className="subheading">{mode === 'desk'
            ? 'Students’ questions from their portal and tickets staff raise. Each has a priority with a reply-by time; overdue ones escalate to the branch manager, and a day later to head office.'
            : 'Tickets you raised for your branch manager or head office, and tickets given to you to handle.'}</p>
        </div>
        <div className="heading-actions">
          {avg != null && <span className="status-badge status-slate" title={`${rated.length} rating${rated.length === 1 ? '' : 's'}`}><Star size={13} fill="#f59e0b" color="#f59e0b" /> {avg} / 5</span>}
          {mode === 'desk' && <ExportButton list="tickets" />}
          {internalCategories.length > 0 && <button type="button" className="button primary" onClick={() => setRaising(true)}><Plus size={16} /> Raise a ticket</button>}
        </div>
      </div>
      <div className="hd-layout">
        <div className="panel hd-list">
          <div className="cd-tabs" role="tablist" style={{ flexWrap: 'wrap' }}>
            {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}<b>{rows.filter(test[k]).length}</b></button>)}
          </div>
          {shown.map((t) => {
            const s = sla(t, now)
            return (
              <button key={t.id} type="button" className={`hd-item${t.id === openId ? ' on' : ''}`} onClick={() => setOpenId(t.id)}>
                <span className="hd-item-top"><strong>{t.subject}</strong><span className={`status-badge status-${TICKET_STATUS[t.status].tone}`}><span className="status-dot" />{TICKET_STATUS[t.status].label}</span></span>
                <small>{t.ticketNo} · {t.kind === 'internal' ? `Staff: ${t.student}${t.toHeadOffice ? ' → head office' : ''}` : `${t.student}${t.regNo ? ` (${t.regNo})` : ''}`} · {allCats[t.category] ?? t.category}{showBranch && t.branch ? ` · ${t.branch}` : ''}</small>
                <small style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`status-badge status-${PRIORITY[t.priority].tone}`} style={{ padding: '1px 8px' }}>{PRIORITY[t.priority].label}</span>
                  {s && <span style={{ color: s.overdue ? '#dc2626' : s.soon ? '#d97706' : 'inherit', display: 'inline-flex', gap: 3, alignItems: 'center' }}><Clock size={12} /> {s.text}</span>}
                  {t.escalationLevel > 0 && t.status !== 'closed' && <span style={{ color: '#dc2626', display: 'inline-flex', gap: 3, alignItems: 'center' }}><AlertTriangle size={12} /> {t.escalationLevel === 2 ? 'Head office' : 'Escalated'}</span>}
                  {t.assignedTo && <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><UserRound size={12} /> {t.assignedTo.name}</span>}
                  {t.rating != null && <Stars value={t.rating} size={12} />}
                  <span>{when(t.updatedAt)}</span>
                </small>
              </button>
            )
          })}
          {!shown.length && <p className="section-hint" style={{ padding: 20, textAlign: 'center' }}>{filter === 'open' ? 'Nothing is waiting for a reply.' : 'No tickets here.'}</p>}
        </div>
        <div className="panel hd-thread">
          {current ? <Thread key={current.id} t={current} categories={allCats} priorities={priorities} now={now} onChanged={(m) => { notify(m); router.refresh() }} />
            : <div className="hd-empty"><LifeBuoy size={34} /><p>Pick a ticket to read and answer it.</p></div>}
        </div>
      </div>
      {raising && <RaiseForm categories={internalCategories} priorities={priorities} onClose={() => setRaising(false)} onDone={(m) => { setRaising(false); notify(m); router.refresh() }} />}
    </section>
  )
}

function Thread({ t, categories, priorities, now, onChanged }: { t: TicketRow; categories: Record<string, string>; priorities: { key: string; label: string; hours: number }[]; now: number; onChanged: (m: string) => void }) {
  const [msgs, setMsgs] = useState<TicketMessage[] | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [staff, setStaff] = useState<{ id: string; name: string }[] | null>(null)
  const [escalating, setEscalating] = useState(false)
  const [why, setWhy] = useState('')
  const load = () => ticketMessagesAction(t.id).then((r) => (r.ok ? setMsgs(r.data!) : setError(r.error)))
  useEffect(() => { void load() }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (t.can.manage) void ticketAssigneesAction(t.id).then((r) => r.ok && setStaff(r.data ?? [])) }, [t.id, t.can.manage])
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { setError(''); const r = await fn(); if (!r.ok) return setError(r.error ?? 'Could not save'); onChanged(msg) })
  const send = () => start(async () => {
    setError('')
    const r = await replyTicketAction(t.id, reply)
    if (!r.ok) return setError(r.error)
    setReply(''); await load(); onChanged(t.can.requester ? 'Sent' : `Answer sent to ${t.student}`)
  })
  const s = sla(t, now)
  const other = t.can.requester ? 'the branch' : t.student.split(' ')[0]
  return (
    <>
      <div className="hd-thread-head">
        <div><h2>{t.subject}</h2><small>{t.ticketNo} · {categories[t.category] ?? t.category} · {t.kind === 'internal' ? `raised by ${t.student}${t.toHeadOffice ? ', for head office' : ''}` : `${t.student}${t.regNo ? ` (${t.regNo})` : ''}`}{t.phone ? ` · ${t.phone}` : ''}</small></div>
        {t.status !== 'closed' && (t.can.answer || t.can.requester) && <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => closeTicketAction(t.id), `${t.ticketNo} closed`)}><CheckCircle2 size={14} /> Close ticket</button>}
      </div>
      {/* the ticket's handling: priority + SLA, assignee, escalation, rating */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
        {t.can.answer
          ? <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Priority<select value={t.priority} disabled={pending} onChange={(e) => act(() => setTicketPriorityAction(t.id, e.target.value), 'Priority changed')}>{priorities.map((p) => <option key={p.key} value={p.key}>{p.label} (reply in {p.hours} h)</option>)}</select></label>
          : <span className={`status-badge status-${PRIORITY[t.priority].tone}`}>{PRIORITY[t.priority].label} priority</span>}
        {s && <span style={{ color: s.overdue ? '#dc2626' : s.soon ? '#d97706' : 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center', fontWeight: 600 }}><Clock size={14} /> {s.text}</span>}
        {t.can.manage && staff
          ? <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Assigned to<select value={t.assignedTo?.id ?? ''} disabled={pending} onChange={(e) => act(() => assignTicketAction(t.id, e.target.value || null), e.target.value ? 'Ticket assigned' : 'Ticket taken back')}><option value="">Nobody (branch manager)</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          : t.assignedTo && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><UserRound size={14} /> {t.assignedTo.name}</span>}
        {t.escalationLevel > 0 && t.status !== 'closed' && <span className="status-badge status-red" title={t.escalationNote ?? ''}><AlertTriangle size={12} /> {ESCALATION[t.escalationLevel]}{t.escalationNote ? ` — ${t.escalationNote}` : ''}</span>}
        {t.status !== 'closed' && t.escalationLevel < 2 && (t.can.answer || (t.can.requester && t.kind === 'internal')) && <button type="button" className="link-button" onClick={() => setEscalating(true)}>Escalate to head office</button>}
        {t.rating != null && !t.can.requester && <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Stars value={t.rating} />{t.ratingNote && <em style={{ color: 'var(--muted)' }}>“{t.ratingNote}”</em>}</span>}
      </div>
      <div className="hd-msgs">
        {msgs === null ? <p className="section-hint">Loading…</p> : msgs.map((m) => (
          <div key={m.id} className={`hd-msg${m.requester === t.can.requester ? ' staff' : ''}`}>
            <div className="hd-bubble">{m.body}</div>
            <small>{m.requester ? (t.kind === 'internal' ? m.author ?? t.student : t.student) : m.author ?? 'Branch'} · {when(m.at)}</small>
          </div>
        ))}
      </div>
      {t.can.requester && t.status !== 'open' && <Rate t={t} onChanged={onChanged} />}
      {t.status === 'closed' && !t.can.requester ? <p className="section-hint" style={{ margin: 0 }}>This ticket is closed. If {t.student.split(' ')[0]} writes again it opens again.</p> : (t.can.answer || t.can.requester) && (
        <div className="hd-reply">
          <textarea rows={3} value={reply} placeholder={t.can.requester ? 'Write to the branch…' : `Answer ${other}…`} onChange={(e) => { setReply(e.target.value); setError('') }} />
          <Err msg={error} />
          <div className="modal-actions" style={{ marginTop: 8 }}><button type="button" className="button primary" disabled={pending || reply.trim().length < 2} onClick={send}><Send size={14} /> {pending ? 'Sending…' : t.can.requester ? 'Send' : 'Send answer'}</button></div>
        </div>
      )}
      {escalating && (
        <Modal title={`Escalate ${t.ticketNo} to head office`} onClose={() => setEscalating(false)}>
          <label className="full-label">Why<span className="required-mark">*</span><textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Needs a refund decision from head office" /></label>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setEscalating(false)}>Cancel</button><button type="button" className="button primary" disabled={pending || why.trim().length < 3} onClick={() => { setEscalating(false); act(() => escalateTicketAction(t.id, why), 'Escalated to head office') }}>Escalate</button></div>
        </Modal>
      )}
    </>
  )
}

function RaiseForm({ categories, priorities, onClose, onDone }: { categories: { key: string; label: string }[]; priorities: { key: string; label: string; hours: number }[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ category: categories[0]?.key ?? '', subject: '', priority: 'normal', toHeadOffice: false, body: '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const save = () => start(async () => {
    const r = await raiseInternalTicketAction(f as never)
    if (!r.ok) return setError(r.error)
    onDone(`Ticket ${r.data!.ticketNo} raised${f.toHeadOffice ? ' for head office' : ''}`)
  })
  return (
    <Modal title="Raise a ticket" onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 12px' }}>For your branch manager — or head office, if it is something the branch cannot sort out. The priority sets how soon a reply is due.</p>
      <div className="form-grid">
        <label>About<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
        <label>Priority<select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{priorities.map((p) => <option key={p.key} value={p.key}>{p.label} — reply within {p.hours} h</option>)}</select></label>
      </div>
      <label className="full-label">Subject<span className="required-mark">*</span><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} placeholder="e.g. Printer in lab 2 not working" /></label>
      <label className="full-label">Details<span className="required-mark">*</span><textarea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={f.toHeadOffice} onChange={(e) => setF({ ...f, toHeadOffice: e.target.checked })} style={{ width: 'auto', margin: 0 }} /> For head office (not the branch manager)</label>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Sending…' : 'Raise ticket'}</button></div>
    </Modal>
  )
}
