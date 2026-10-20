'use client'
// One event: its sign-up link and QR code to share (copy, download, print a poster), open / close sign-ups (live on
// the public page at once), and who signed up with their score and certificate. While sign-ups are open the list
// refreshes itself every 15 seconds.
import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Award, Copy, Download, ExternalLink, Mail, Pencil, Printer, Radio, Search, Square } from 'lucide-react'
import { resendEventCertificateAction, setEventOpenAction } from '@/app/event-actions'
import { ExportButton } from '@/components/export-button'
import { useNotify } from '@/components/panel-shell'
import { fmtWhen, isLive } from '@/components/events-panel'
import type { EventFull, ParticipantRow } from '@/modules/events/service'

const KIND: Record<string, string> = { seminar: 'Seminar', workshop: 'Workshop', webinar: 'Webinar', bootcamp: 'Bootcamp', competition: 'Competition', other: 'Event' }

export function EventDetail({ event: e, participants, link, qr, canUpdate }: { event: EventFull; participants: ParticipantRow[]; link: string; qr: string; canUpdate: boolean }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const live = isLive(e)
  // live: the list refreshes while sign-ups are open
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, 15000)
    return () => clearInterval(t)
  }, [live, router])

  const list = useMemo(() => participants.filter((p) => !q || `${p.name} ${p.email} ${p.mobile ?? ''} ${p.organisation ?? ''} ${p.certNo ?? ''}`.toLowerCase().includes(q.toLowerCase())), [participants, q])
  const toggle = () => start(async () => {
    const r = await setEventOpenAction(e.id, !e.isOpen)
    if (!r.ok) return setError(r.error)
    notify(e.isOpen ? 'Sign-ups closed' : 'Sign-ups open'); router.refresh()
  })
  const resend = (p: ParticipantRow) => start(async () => {
    const r = await resendEventCertificateAction(p.id)
    if (!r.ok) return setError(r.error)
    setError(''); notify(`Certificate e-mail on its way to ${p.email}`); setTimeout(() => router.refresh(), 2500)
  })
  const copy = async () => { try { await navigator.clipboard.writeText(link); notify('Link copied') } catch { setError('Copy the link by hand: ' + link) } }
  const downloadQr = () => {
    // the QR code as a PNG, 1024 px, with a white margin
    const img = new window.Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 1024
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 1024, 1024); g.drawImage(img, 64, 64, 896, 896)
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `${e.title.replace(/[^\w]+/g, '-').slice(0, 60)}-QR.png`; a.click()
    }
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.replace('<svg', '<svg width="896" height="896"'))}`
  }


  return (
    <section className="page-container table-page">
      <style>{CSS}</style>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Events / <Link href="/events">Seminars &amp; Workshops</Link> / {KIND[e.kind]}</p>
          <h1>{e.title}</h1>
          <p className="subheading">{fmtWhen(e.startsAt)}{e.endsAt ? ` – ${fmtWhen(e.endsAt)}` : ''} · {e.mode === 'online' ? 'Online' : e.mode === 'hybrid' ? 'At the venue and online' : 'At the venue'}{e.venue ? ` · ${e.venue}` : ''}{e.speaker ? ` · ${e.speaker}` : ''}{e.branch ? ` · ${e.branch}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canUpdate && <Link href={`/events/${e.id}/edit`} className="button secondary"><Pencil size={14} /> Edit</Link>}
          {canUpdate && <button type="button" className={`button ${e.isOpen ? 'secondary' : 'primary'}`} onClick={toggle} disabled={pending}>{e.isOpen ? <><Square size={14} /> Close sign-ups</> : <><Radio size={14} /> Open sign-ups</>}</button>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {e.certificate && !e.designId && <p className="fee-note" role="status">This event gives certificates but has no design: Edit → Certificate, and pick one. Until then nobody gets a certificate.</p>}

      <div className="ed-top">
        <div className="panel ed-share">
          <div className="ed-qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code of the sign-up link" role="img" />
          <div className="ed-share-body">
            <h2>{live ? <span className="status-badge status-green"><span className="status-dot" />Live: taking sign-ups</span> : <span className="status-badge status-red"><span className="status-dot" />Sign-ups closed</span>}</h2>
            <p className="section-hint">Share the link, or show the QR code on the screen / print it: people scan it with their phone camera, fill in their details{e.hasQuiz ? ', take the quiz' : ''} and get their certificate by e-mail.{e.closesAt ? ` Sign-ups close on their own at ${fmtWhen(e.closesAt)}.` : ''}</p>
            <div className="ed-link"><code>{link}</code></div>
            <div className="ed-buttons">
              <button type="button" className="button secondary" onClick={copy}><Copy size={14} /> Copy link</button>
              <a className="button secondary" href={link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open the page</a>
              <button type="button" className="button secondary" onClick={downloadQr}><Download size={14} /> QR code (PNG)</button>
              <a className="button secondary" href={`/events/${e.id}/poster`} target="_blank" rel="noreferrer"><Printer size={14} /> Print poster</a>
            </div>
          </div>
        </div>
        <div className="ed-stats">
          <div className="panel"><span>Signed up</span><b>{e.joined}</b></div>
          {e.hasQuiz && <div className="panel"><span>Passed ({e.passPercent}%+)</span><b>{e.passed}</b><small>{e.joined ? Math.round((e.passed * 100) / e.joined) : 0}% · {e.questions} questions{e.quizMinutes ? ` · ${e.quizMinutes} min` : ''}</small></div>}
          <div className="panel"><span>Certificates</span><b>{e.certified}</b><small>{e.certificate ? `${e.design ?? 'no design'} · ${e.hasQuiz && e.certFor === 'passed' ? 'pass only' : 'everyone'}` : 'none given'}</small></div>
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div><h2>Participants</h2><span>{live ? 'Refreshes every 15 seconds while sign-ups are open.' : 'Newest first.'}</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', border: '1px solid var(--line)', borderRadius: 999, height: 38, background: '#fff' }}><Search size={14} /><input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search" aria-label="Search participants" style={{ border: 0, outline: 0 }} /></label>
            <ExportButton list="event-participants" query={{ f: { event: e.id } }} />
          </div>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Name</th><th>Contact</th>{e.hasQuiz && <th>Score</th>}<th>Certificate</th><th>E-mail</th><th>Signed up</th>{canUpdate && <th />}</tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.name}</b>{p.organisation && <div className="section-hint">{p.organisation}</div>}</td>
                <td>{p.email}{p.mobile && <div className="section-hint">{p.mobile}</div>}</td>
                {e.hasQuiz && <td>{p.score ?? '—'} / {p.total ?? '—'} {p.passed ? <span className="status-badge status-green">Passed</span> : <span className="status-badge status-red">Not passed</span>}</td>}
                <td>{p.certNo ? <a href={`/e/c/${p.hash}`} target="_blank" rel="noreferrer"><Award size={13} /> {p.certNo}</a> : '—'}</td>
                <td>{p.mailedAt ? <span className="status-badge status-green" title={fmtWhen(p.mailedAt)}>Sent</span> : p.mailError ? <span className="status-badge status-red" title={p.mailError}>Failed</span> : p.certNo ? <span className="status-badge status-amber">Sending…</span> : '—'}</td>
                <td>{fmtWhen(p.createdAt)}</td>
                {canUpdate && <td>{(p.certNo || (e.certificate && e.designId && (!e.hasQuiz || e.certFor === 'all' || p.passed))) && <button type="button" className="button secondary ed-small" onClick={() => resend(p)} disabled={pending} title={p.certNo ? 'E-mail the certificate again' : 'Issue the certificate and e-mail it'}><Mail size={13} /> {p.certNo ? 'Resend' : 'Issue & send'}</button>}</td>}
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28 }} className="section-hint">{participants.length ? 'Nobody matches.' : 'Nobody has signed up yet. Share the link or the QR code.'}</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  )
}

const CSS = `
.ed-top { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; margin-bottom: 16px; }
@media (max-width: 900px) { .ed-top { grid-template-columns: 1fr; } }
.ed-share { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.ed-qr { width: 170px; height: 170px; padding: 10px; border: 1px solid var(--line); border-radius: 14px; background: #fff; flex: none; }
.ed-qr svg { width: 100%; height: 100%; display: block; }
.ed-share-body { flex: 1 1 260px; min-width: 0; }
.ed-share-body h2 { margin: 0 0 8px; }
.ed-link { margin: 10px 0; padding: 10px 12px; border-radius: 10px; background: var(--tint-2); border: 1px dashed var(--line); overflow-wrap: anywhere; font-size: 13px; }
.ed-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
.ed-buttons .button { height: 36px; padding: 0 14px; }
.ed-stats { display: grid; gap: 10px; align-content: start; }
.ed-stats .panel { display: grid; gap: 2px; padding: 14px 16px; }
.ed-stats span { color: var(--muted); font-size: 12px; font-weight: 700; }
.ed-stats b { color: var(--ink); font-size: 26px; }
.ed-stats small { color: var(--muted); font-size: 11.5px; }
.ed-small { height: 30px !important; padding: 0 10px !important; font-size: 12px !important; }
`
