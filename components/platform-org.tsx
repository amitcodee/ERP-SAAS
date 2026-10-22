'use client'
// The platform console's actions on one organisation: its status, and support sessions (open one, get a link into
// the org, end it). Each asks for a reason, which goes into the org's own audit log.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { activateOrgAction, approveOrgAction, endSupportAction, setOrgStatusAction, startSupportAction, supportLinkAction } from '@/app/platform/actions'
import type { SupportRow } from '@/modules/platform/service'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '—')

const STATUS: Record<string, string> = {
  pending: 'waiting for approval', trial: 'free trial', active: 'active', past_due: 'payment due (grace days)', read_only: 'closed until paid', suspended: 'blocked', cancelled: 'cancelled',
}

export function PlatformOrgActions({ org, sessions, me }: { org: { id: string; status: string }; sessions: SupportRow[]; me: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reason, setReason] = useState('')
  const [until, setUntil] = useState('')
  const [noEnd, setNoEnd] = useState(false)
  const [sup, setSup] = useState({ reason: '', mode: 'read' as 'read' | 'write', minutes: 30 })
  const [link, setLink] = useState<string | null>(null)
  const open = sessions.find((s) => s.open)
  const done = (r: { ok: boolean; error?: string }, text: string) => { setMsg(r.ok ? { ok: true, text } : { ok: false, text: r.error ?? 'Failed' }); if (r.ok) router.refresh() }
  const status = (to: 'suspended' | 'active' | 'read_only', text: string) => start(async () => { const r = await setOrgStatusAction(org.id, to, reason); done(r, text); if (r.ok) setReason('') })

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {msg && <p role="status" className={msg.ok ? 'section-hint' : 'login-error'} style={{ margin: 0 }}>{msg.text}</p>}
      <div className="panel" style={{ display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Status: {STATUS[org.status] ?? org.status}</h2>
        {org.status === 'pending' && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: 12, borderRadius: 12, background: '#eef0ff' }}>
            <span style={{ flex: '1 1 260px' }}>Signed up and waiting for your approval. Approve: its free trial starts now (or it is active at once if it has paid).</span>
            <button type="button" className="button primary" disabled={pending} onClick={() => start(async () => { const r = await approveOrgAction(org.id); done(r, r.ok && r.data?.status === 'active' ? 'Approved: active (already paid)' : `Approved: the ${r.ok ? r.data?.trialDays : ''}-day trial has started`) })}>Approve</button>
          </div>
        )}
        <p className="section-hint" style={{ margin: 0 }}>Active until a date: like a paid period (a reminder a week before, then closed until paid). No end: never billed. Close: only the owner can sign in, to Plan &amp; billing. Block: nobody can sign in. The reason goes in the institute’s audit log.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required), e.g. paid ₹5,000 by bank transfer" aria-label="Reason" style={{ flex: '1 1 260px' }} />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>Active until <input type="date" value={noEnd ? '' : until} disabled={noEnd} onChange={(e) => setUntil(e.target.value)} aria-label="Active until" /></label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} /> no end</label>
          <button type="button" className="button primary" disabled={pending || reason.trim().length < 3 || (!noEnd && !until)} onClick={() => start(async () => { const r = await activateOrgAction(org.id, noEnd ? null : until, reason); done(r, noEnd ? 'Active, with no end' : `Active until ${until}`); if (r.ok) setReason('') })}>Activate</button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {org.status !== 'read_only' && org.status !== 'suspended' && org.status !== 'pending' && <button type="button" className="button secondary" disabled={pending || reason.trim().length < 3} onClick={() => status('read_only', 'Closed: only Plan & billing')}>Close (until paid)</button>}
          {org.status !== 'suspended' && <button type="button" className="button secondary" disabled={pending || reason.trim().length < 3} onClick={() => status('suspended', 'Blocked')}>{org.status === 'pending' ? 'Reject (block)' : 'Block'}</button>}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Support session</h2>
        <p className="section-hint">Work inside the institute as its head office, for at most an hour. Its admins see a banner while you are in and can end it; everything you do is in their audit log under your name ({me}). Read-only unless you need to change something.</p>
        {open ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0 }}><strong>Open</strong> by {open.by}, {open.mode === 'read' ? 'read-only' : 'can change things'}, until {when(open.expiresAt)}: “{open.reason}”</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="button primary" disabled={pending} onClick={() => start(async () => { const r = await supportLinkAction(org.id, open.id); if (r.ok && r.data) setLink(r.data); else done(r, '') })}>Get a link into the institute</button>
              <button type="button" className="button secondary" disabled={pending} onClick={() => start(async () => { done(await endSupportAction(open.id), 'Support session ended'); setLink(null) })}>End session</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input value={sup.reason} onChange={(e) => setSup({ ...sup, reason: e.target.value })} placeholder="Why (e.g. ticket 123: fees not adding up)" aria-label="Why" style={{ flex: '1 1 260px' }} />
            <select value={sup.mode} onChange={(e) => setSup({ ...sup, mode: e.target.value as 'read' | 'write' })} aria-label="Mode"><option value="read">Read-only</option><option value="write">Can change things</option></select>
            <select value={sup.minutes} onChange={(e) => setSup({ ...sup, minutes: Number(e.target.value) })} aria-label="Length"><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select>
            <button type="button" className="button primary" disabled={pending || sup.reason.trim().length < 5} onClick={() => start(async () => { const r = await startSupportAction(org.id, sup); if (r.ok && r.data) { setLink(r.data); setSup({ ...sup, reason: '' }); router.refresh() } else done(r, '') })}>Start</button>
          </div>
        )}
        {link && <p className="section-hint" style={{ margin: '12px 0 0' }}>Open within 5 minutes, once: <a href={link} target="_blank" rel="noreferrer">enter the institute</a></p>}
      </div>

      <div className="panel table-scroll">
        <h2 style={{ marginTop: 0 }}>Earlier sessions</h2>
        <table>
          <thead><tr><th>Started</th><th>By</th><th>Mode</th><th>Reason</th><th>Ended</th></tr></thead>
          <tbody>
            {sessions.map((s) => <tr key={s.id}><td>{when(s.startedAt)}</td><td>{s.by}</td><td>{s.mode === 'read' ? 'Read-only' : 'Changes'}</td><td>{s.reason}</td><td>{s.open ? 'open' : s.endedAt ? `${when(s.endedAt)} (${s.endedBy})` : `ran out ${when(s.expiresAt)}`}</td></tr>)}
            {!sessions.length && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
