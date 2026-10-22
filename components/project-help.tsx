'use client'
// Project Help (trainers of every branch): students ask for help with a project, a topic or their career. Any
// trainer offers; the student picks one; the chosen trainer then sees the student's contact and marks it done.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, HandHelping, Mail, Send, X } from 'lucide-react'
import { closeHelpAction, offerHelpAction, withdrawOfferAction } from '@/app/actions'
import { Err } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { HelpRequest } from '@/modules/teaching/service'

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const STATUS: Record<HelpRequest['status'], [string, string]> = { open: ['Looking for a trainer', 'amber'], assigned: ['Trainer chosen', 'blue'], done: ['Done', 'green'], cancelled: ['Cancelled', 'slate'] }

export function ProjectHelp({ rows, kinds }: { rows: HelpRequest[]; kinds: Record<string, string> }) {
  const [view, setView] = useState<'open' | 'mine'>('open')
  const list = rows.filter((r) => (view === 'open' ? r.status === 'open' : r.iOffered || r.mineChosen))
  const mine = rows.filter((r) => r.mineChosen && r.status === 'assigned').length
  return (
    <section className="page-container table-page">
      <div className="page-heading"><div><p className="eyebrow">Students &amp; classes / Project help</p><h1>Project Help</h1><p className="subheading">Students of every branch ask for help with a project, a topic or their career. Offer to help; if several trainers offer, the student picks one.</p></div></div>
      <div className="cd-tabs" role="tablist" style={{ marginBottom: 14 }}>
        <button type="button" role="tab" aria-selected={view === 'open'} className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>Open requests<b>{rows.filter((r) => r.status === 'open').length}</b></button>
        <button type="button" role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>My offers & students<b>{mine || rows.filter((r) => r.iOffered || r.mineChosen).length}</b></button>
      </div>
      <div className="ph-list">
        {list.map((r) => <Request key={r.id} r={r} kinds={kinds} />)}
        {!list.length && <div className="panel hd-empty"><HandHelping size={34} /><p>{view === 'open' ? 'No student is waiting for help right now.' : 'You have not offered help yet.'}</p></div>}
      </div>
    </section>
  )
}

function Request({ r, kinds }: { r: HelpRequest; kinds: Record<string, string> }) {
  const router = useRouter()
  const notify = useNotify()
  const [msg, setMsg] = useState('')
  const [offering, setOffering] = useState(false)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => { setError(''); const x = await fn(); if (!x.ok) return setError(x.error ?? 'Could not save'); setOffering(false); notify(done); router.refresh() })
  const [label, tone] = STATUS[r.status]
  return (
    <article className="panel ph-card">
      <div className="ph-head">
        <div><span className="ph-kind">{kinds[r.kind] ?? r.kind}</span><h2>{r.title}</h2><small>{r.no} · {r.student}{r.course ? ` · ${r.course}` : ''}{r.branch ? ` · ${r.branch}` : ''} · {when(r.at)}</small></div>
        <span className={`status-badge status-${tone}`}><span className="status-dot" />{label}</span>
      </div>
      <p className="ph-details">{r.details}</p>
      {r.offers.length > 0 && <p className="section-hint" style={{ margin: '0 0 10px' }}>{r.offers.length} trainer{r.offers.length === 1 ? '' : 's'} offered: {r.offers.map((o) => o.trainer).join(', ')}</p>}
      {r.mineChosen && (
        <div className="ph-chosen">
          <strong><Check size={15} /> {r.student.split(' ')[0]} chose you. Get in touch:</strong>
          <div className="row-actions">
            {r.studentContact?.email && <a className="filter-button" href={`mailto:${r.studentContact.email}`}><Mail size={13} /> {r.studentContact.email}</a>}
            {r.status === 'assigned' && <button type="button" className="button primary small" disabled={pending} onClick={() => act(() => closeHelpAction(r.id, 'done'), 'Marked done. Thank you for helping!')}><Check size={13} /> Mark done</button>}
          </div>
        </div>
      )}
      {r.status === 'open' && (r.iOffered ? (
        <div className="row-actions"><span className="status-badge status-blue"><span className="status-dot" />You offered — waiting for the student</span>
          <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => withdrawOfferAction(r.id), 'Offer withdrawn')}><X size={13} /> Withdraw</button></div>
      ) : offering ? (
        <div className="ph-offer">
          <textarea rows={2} value={msg} maxLength={1000} placeholder="A short note for the student: when you can help, how (call, meet at the branch…)" onChange={(e) => setMsg(e.target.value)} />
          <div className="row-actions"><button type="button" className="button secondary small" onClick={() => setOffering(false)}>Cancel</button><button type="button" className="button primary small" disabled={pending} onClick={() => act(() => offerHelpAction(r.id, msg || null), 'Offer sent: the student picks a trainer')}><Send size={13} /> Send offer</button></div>
        </div>
      ) : <button type="button" className="button primary small" onClick={() => setOffering(true)}><HandHelping size={14} /> I can help</button>)}
      <Err msg={error} />
    </article>
  )
}
