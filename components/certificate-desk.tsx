'use client'
// The certificate desk (Documents): one screen for two lists.
//   requests: every student, their joining date, course, fees (clear / due) and the certificate step they are at,
//             with the button for the next step: Request (branch staff) -> Approve (accounts) -> on to Issue Certificate.
//   issue:    students whose course is complete and whose request accounts approved -> Issue; and the issued ones.
// Filters and search live in the address, so a view can be bookmarked.
import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Ban, CheckCircle2, FileBadge, RotateCcw, Search, Send, ShieldCheck, X } from 'lucide-react'
import { approveCertificateAction, certificateWordingAction, issueCertificatesAction, clearCertificateFeesAction, rejectCertificateAction, requestCertificateAction, revokeCertificateAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { CertDesk, CertDeskRow, CertStage } from '@/modules/certificates/documents'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const day = (k: string | null) => (k ? new Date(k.length > 10 ? k : `${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const STAGE: Record<CertStage, { label: string; tone: string; what: string }> = {
  none: { label: 'Not requested', tone: 'slate', what: 'No certificate request yet.' },
  waiting: { label: 'Waiting for accounts', tone: 'amber', what: 'Requested; accounts must confirm the fees are clear.' },
  approved: { label: 'Approved by accounts', tone: 'blue', what: 'Fees confirmed clear; ready to issue once the course is complete.' },
  rejected: { label: 'Rejected', tone: 'red', what: 'The request was turned down; it can be requested again.' },
  issued: { label: 'Issued', tone: 'green', what: 'The certificate has been issued.' },
  revoked: { label: 'Revoked', tone: 'red', what: 'Head office revoked the certificate. The student no longer sees it; it can be requested and issued again (a new number).' },
}

export function CertificateDesk({ list, data: d, filters, can, showBranch, batches = [] }: {
  list: 'requests' | 'issue'
  data: CertDesk
  filters: { q: string; stage: string; fee: string; period: string; batch: string }
  /** the batches the list can be narrowed to (a batch's certificates at once) */
  batches?: { id: string; name: string }[]
  /** skipAccounts: head office / branch manager, who issue without waiting for accounts. revoke: head office only.
   *  headOffice: issues the certificates of franchise centres that wait for head office. */
  can: { request: boolean; clear: boolean; issue: boolean; skipAccounts: boolean; revoke?: boolean; headOffice?: boolean }
  showBranch: boolean
}) {
  const router = useRouter()
  const path = usePathname()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<CertDeskRow | null>(null)
  const [revoking, setRevoking] = useState<CertDeskRow | null>(null)
  const [asking, setAsking] = useState<CertDeskRow | null>(null) // the request form: the course name and tools to print
  const [q, setQ] = useState(filters.q)
  const go = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch }
    router.push(`${path}?${new URLSearchParams(Object.entries(next).filter(([, v]) => v))}`)
  }
  const act = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id)
    start(async () => {
      const res = await fn()
      setBusy(null)
      if (!res.ok) return notify(res.error ?? 'Could not save')
      notify(done)
      router.refresh()
    })
  }

  const isIssue = list === 'issue'
  // the rows shown that can be issued now, by this person: "Issue all ready"
  const issuable = d.rows.filter((r) => r.requestId && r.courseComplete && !r.blockers.length && (!r.byHeadOffice || can.headOffice)
    && ((r.stage === 'approved' && can.issue) || (r.stage === 'waiting' && can.skipAccounts && r.balance <= 0)))
  const issueAll = () => {
    if (!confirm(`Issue ${issuable.length} certificate${issuable.length === 1 ? '' : 's'} now? Each student is told by e-mail.`)) return
    setBusy('all')
    start(async () => {
      const res = await issueCertificatesAction(issuable.map((r) => r.requestId!))
      setBusy(null)
      if (!res.ok) return notify(res.error ?? 'Could not issue')
      const { issued, failed } = res.data!
      notify(`${issued.length} certificate${issued.length === 1 ? '' : 's'} issued${failed.length ? `; ${failed.length} not: ${failed.slice(0, 3).map((f) => `${f.name} (${f.reason})`).join('; ')}` : ''}`)
      router.refresh()
    })
  }
  const chips: [string, string, number][] = isIssue
    ? [['', 'All', d.total], ['ready', 'Ready to issue', d.counts.ready], ['issued', 'Issued', d.counts.issued], ['revoked', 'Revoked', d.counts.revoked]]
    : [['', 'All', d.total], ['none', 'Not requested', d.counts.none], ['waiting', 'Waiting for accounts', d.counts.waiting], ['approved', 'Approved by accounts', d.counts.approved], ['issued', 'Issued', d.counts.issued], ['rejected', 'Rejected', d.counts.rejected]]

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Certificates / {isIssue ? 'Issue Certificate' : 'Certificate Requests'}</p>
          <h1>{isIssue ? 'Issue certificate' : 'Certificate requests'}</h1>
          <p className="subheading">{isIssue
            ? 'Students whose course is complete and whose certificate request accounts has approved. Issue the certificate here; issued certificates stay listed for printing and verification.'
            : 'Every student with their joining date, course and fees. Step 1: request the certificate. Step 2: accounts approves when the fees are clear. Step 3: issue it from Issue Certificate once the course is complete.'}</p>
        </div>
      </div>

      <ol className="cd-steps" aria-label="How a certificate is given">
        <li className={!isIssue ? 'on' : ''}><Send size={15} /><div><strong>1. Request</strong><span>Branch staff ask for the student&apos;s certificate.</span></div></li>
        <li className={!isIssue ? 'on' : ''}><ShieldCheck size={15} /><div><strong>2. Accounts approves</strong><span>Accounts confirms nothing is due. Head office sees every approval.</span></div></li>
        <li className={isIssue ? 'on' : ''}><FileBadge size={15} /><div><strong>3. Issue</strong><span>When the course is complete, the certificate is issued and can be printed.</span></div></li>
      </ol>

      <div className="table-summary">
        {isIssue ? (<>
          <div><strong className="text-blue">{d.counts.ready}</strong><span>Ready to issue</span></div>
          <div><strong className="text-green">{d.counts.issued}</strong><span>Issued</span></div>
          <div><strong>{d.counts.revoked}</strong><span>Revoked</span></div>
        </>) : (<>
          <div><strong>{d.counts.none}</strong><span>Not requested yet</span></div>
          <div><strong className="text-amber">{d.counts.waiting}</strong><span>Waiting for accounts</span></div>
          <div><strong className="text-blue">{d.counts.approved}</strong><span>Approved by accounts</span></div>
          <div><strong className="text-green">{d.counts.issued}</strong><span>Issued</span></div>
          <div><strong className="text-red">{d.counts.due}</strong><span>Students with fees due</span></div>
        </>)}
      </div>

      {!isIssue && (
        <div className="cd-tabs" role="tablist" aria-label="Course completion">
          {([['this', 'Completing this month', d.counts.thisMonth], ['next', 'Completing next month', d.counts.nextMonth], ['', 'All students', d.counts.all]] as [string, string, number][]).map(([v, l, n]) => (
            <button key={l} type="button" role="tab" aria-selected={filters.period === v} className={filters.period === v ? 'on' : ''} onClick={() => go({ period: v })}>{l}<b>{n}</b></button>
          ))}
        </div>
      )}

      <div className="panel col-filters">
        <div className="col-presets" role="group" aria-label="Show">{chips.map(([v, l, n]) => <button key={l} type="button" className={filters.stage === v ? 'on' : ''} onClick={() => go({ stage: v })}>{l} · {n}</button>)}</div>
        <div className="col-controls">
          <form onSubmit={(e) => { e.preventDefault(); go({ q }) }}><label>Search<span className="cd-search"><Search size={15} /><input value={q} placeholder="Name, phone or registration no." onChange={(e) => setQ(e.target.value)} /></span></label></form>
          <label>Fees<select value={filters.fee} onChange={(e) => go({ fee: e.target.value })}><option value="">All</option><option value="clear">Fees clear</option><option value="due">Fees due</option></select></label>
          {!!batches.length && <label>Batch<select value={filters.batch} onChange={(e) => go({ batch: e.target.value })}><option value="">All students</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          {isIssue && issuable.length > 1 && <button type="button" className="button primary" style={{ alignSelf: 'end' }} disabled={pending} onClick={issueAll}><FileBadge size={15} /> {busy === 'all' ? 'Issuing…' : `Issue all ready (${issuable.length})`}</button>}
        </div>
      </div>

      <div className="panel table-panel">
        <div className="panel-header"><div><h2>{isIssue ? 'Certificates to issue and issued' : 'Students'}</h2><span>{d.rows.length < d.total ? `Showing ${d.rows.length} of ${d.total}. Search or filter to narrow.` : `${d.rows.length} student${d.rows.length === 1 ? '' : 's'}.`} Point at a status for what it means.</span></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Student</th><th>Course</th>{showBranch && <th>Branch</th>}<th>Joined</th><th>Course ends</th><th>Days remaining</th><th>Fees</th><th>Certificate</th><th>Next step</th></tr></thead>
          <tbody>
            {d.rows.map((r) => {
              const s = STAGE[r.stage]
              const ready = r.stage === 'approved' && r.courseComplete
              return (
                <tr key={r.registrationId}>
                  <td><strong>{r.name}</strong><small>{r.regNo} · {r.phone}</small></td>
                  <td>{r.course}{r.projectCertificate && <small className="cd-proj">+ Project certificate</small>}</td>
                  {showBranch && <td>{r.branch}{r.byHeadOffice && <small>Franchise: you issue</small>}</td>}
                  <td>{day(r.joined)}</td>
                  <td>{day(r.expectedEnd)}{r.courseComplete ? <small className="text-green">Complete</small> : <small>Running</small>}</td>
                  <td>{r.daysLeft == null ? <small>No end date</small>
                    : r.daysLeft <= 0 ? <span className="status-badge status-green"><span className="status-dot" />Completed{r.daysLeft < 0 ? ` ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago` : ' today'}</span>
                    : <span className={`status-badge status-${r.daysLeft <= 7 ? 'amber' : r.daysLeft <= 31 ? 'blue' : 'slate'}`}><span className="status-dot" />{r.daysLeft} day{r.daysLeft === 1 ? '' : 's'} left</span>}</td>
                  <td>{r.balance > 0
                    ? <span className="status-badge status-red" title={`Paid ${inr(r.paid)} of ${inr(r.totalFee)}`}><span className="status-dot" />{inr(r.balance)} due</span>
                    : <span className="status-badge status-green" title={`Paid ${inr(r.paid)}`}><span className="status-dot" />Clear</span>}</td>
                  <td>
                    <span className={`status-badge status-${s.tone}`} title={s.what}><span className="status-dot" />{s.label}</span>
                    {r.requestedAt && r.stage !== 'issued' && <small>Requested {day(r.requestedAt)}{r.requestedBy ? ` by ${r.requestedBy}` : ''}</small>}
                    {r.clearedAt && r.stage !== 'issued' && <small>Accounts approved {day(r.clearedAt)}{r.clearedBy ? ` (${r.clearedBy})` : ''}</small>}
                    {r.stage === 'rejected' && r.rejectionReason && <small className="text-red">Reason: {r.rejectionReason}</small>}
                    {(r.certCourseTitle || r.certTools) && r.stage !== 'issued' && <small className="text-amber" title="Asked for with the request: printed instead of the course's own">Prints: {r.certCourseTitle ?? r.course}{r.certTools ? ` · ${r.certTools.join(', ')}` : ''}</small>}
                    {r.certNo && <small className={r.revoked ? 'text-red' : undefined}>{r.certNo} · {day(r.issuedAt)}{r.revoked ? ' · revoked' : ''}</small>}
                    {r.revoked && <small className="text-red" title={r.revoked.reason ?? ''}>Revoked {day(r.revoked.at)}{r.revoked.by ? ` by ${r.revoked.by}` : ''}{r.revoked.reason ? `: ${r.revoked.reason}` : ''}</small>}
                  </td>
                  <td>
                    <div className="row-actions">
                      {(r.stage === 'none' || r.stage === 'rejected') && (can.request
                        ? <span className="cd-req">
                            {/* fees due: the request waits until they are paid */}
                            <button className="button primary small" disabled={pending || r.balance > 0} title={r.balance > 0 ? `Fees of ${inr(r.balance)} are due. Collect them first.` : 'Ask for this student\'s certificate'} onClick={() => setAsking(r)}>Request certificate</button>
                            {r.balance > 0 && <small className="text-red">Fees due: {inr(r.balance)}</small>}
                          </span>
                        : <small>Branch staff request it</small>)}
                      {r.stage === 'waiting' && can.skipAccounts && (!r.byHeadOffice || can.headOffice) && r.balance <= 0 && r.courseComplete && !r.blockers.length
                        && <button className="button primary small" disabled={pending} title="No need to wait for accounts: the fees are clear and you approve it" onClick={() => act(r.requestId!, () => approveCertificateAction(r.requestId!), `Certificate issued to ${r.name}`)}><FileBadge size={14} /> {busy === r.requestId ? 'Issuing…' : 'Issue certificate'}</button>}
                      {r.stage === 'waiting' && (can.clear
                        ? r.balance > 0
                          ? <small className="text-red">Collect {inr(r.balance)} first</small>
                          : <button className="button primary small" disabled={pending} onClick={() => act(r.requestId!, () => clearCertificateFeesAction(r.requestId!), `Approved: fees clear for ${r.name}`)}><CheckCircle2 size={14} /> {busy === r.requestId ? 'Approving…' : 'Approve (fees clear)'}</button>
                        : <small>Waiting for accounts</small>)}
                      {r.stage === 'approved' && (ready
                        ? r.byHeadOffice && !can.headOffice
                          ? <small title="A franchise centre's certificates are issued by head office, in the institute's name">Waiting for head office to issue</small>
                          : can.issue
                          ? (r.blockers.length
                            ? <small className="text-amber" title={r.blockers.join(' · ')}>Can&apos;t issue yet: {r.blockers.join(' · ')}</small>
                            : <button className="button primary small" disabled={pending} onClick={() => act(r.requestId!, () => approveCertificateAction(r.requestId!), `Certificate issued to ${r.name}`)}><FileBadge size={14} /> {busy === r.requestId ? 'Issuing…' : 'Issue certificate'}</button>)
                          : <small>Ready: a manager issues it</small>
                        : <small>Issue after the course ends</small>)}
                      {(r.stage === 'waiting' || r.stage === 'approved') && can.issue && <button className="filter-button" disabled={pending} onClick={() => setRejecting(r)}><X size={14} /> Reject</button>}
                      {r.stage === 'revoked' && (can.request
                        ? <button className="button primary small" disabled={pending || r.balance > 0} title={r.balance > 0 ? `Fees of ${inr(r.balance)} are due. Collect them first.` : 'Request a new certificate (a new number); then issue it as usual'} onClick={() => setAsking(r)}><RotateCcw size={14} /> Issue again</button>
                        : <small>The branch can request it again</small>)}
                      {r.stage === 'issued' && can.revoke && <button className="filter-button" disabled={pending} title="Head office: the certificate stops being valid and the student no longer sees it" onClick={() => setRevoking(r)}><Ban size={14} /> Revoke</button>}
                      {r.verificationHash && <a className="filter-button" href={`/verify/${r.verificationHash}/certificate`} target="_blank" rel="noreferrer">{r.revoked ? 'View revoked' : 'Print / verify'}</a>}
                      {r.verificationHash && !r.revoked && r.projectCertificate && <a className="filter-button" href={`/verify/${r.verificationHash}/certificate?kind=project`} target="_blank" rel="noreferrer">Project certificate</a>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!d.rows.length && <tr><td colSpan={showBranch ? 9 : 8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{isIssue ? 'No certificate is ready to issue yet. Requests approved by accounts appear here once the course is complete.' : 'No students match.'}</td></tr>}
          </tbody>
        </table></div>
      </div>

      {revoking && <RevokeModal row={revoking} onClose={() => setRevoking(null)} onDone={() => { setRevoking(null); router.refresh() }} />}
      {rejecting && <RejectModal row={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); router.refresh() }} />}
      {asking && <RequestModal row={asking} onClose={() => setAsking(null)} onDone={(m) => { setAsking(null); notify(m); router.refresh() }} />}
    </section>
  )
}

/** Head office revokes an issued certificate, with the reason (shown on its verify page). */
function RevokeModal({ row, onClose, onDone }: { row: CertDeskRow; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Revoke certificate ${row.certNo} — ${row.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await revokeCertificateAction(row.certificateId!, reason); if (!res.ok) return setErr(res.error); notify(`Certificate ${row.certNo} revoked`); onDone() }) }}>
        <p className="section-hint">The certificate stops being valid: its verify link shows REVOKED with this reason, and the student no longer sees it. It stays on record. The branch can then request a new one and issue it again (with a new number).</p>
        <label>Reason<span className="required-mark">*</span><textarea required minLength={3} value={reason} onChange={(e) => { setReason(e.target.value); setErr('') }} rows={3} placeholder="e.g. Wrong course name printed" /></label>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Revoking…' : 'Revoke certificate'}</button></div>
      </form>
    </Modal>
  )
}

function RejectModal({ row, onClose, onDone }: { row: CertDeskRow; onClose: () => void; onDone: () => void }) {
  const notify = useNotify()
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Reject the certificate request of ${row.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await rejectCertificateAction(row.requestId!, reason); if (!res.ok) return setErr(res.error); notify('Request rejected'); onDone() }) }}>
        <p className="section-hint">The branch sees this reason and can request again once it is sorted out.</p>
        <label>Reason<textarea required value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></label>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Reject'}</button></div>
      </form>
    </Modal>
  )
}

/**
 * Asking for a student's certificate. It prints the course's name and its tools (a customized course: its own title
 * and modules) — or, when the student learnt something else, a name and tools written here. Frozen at issue.
 */
function RequestModal({ row, onClose, onDone }: { row: CertDeskRow; onClose: () => void; onDone: (m: string) => void }) {
  const [def, setDef] = useState<{ course: string; tools: string[]; toolsLabel: string } | null>(null)
  const [custom, setCustom] = useState(false)
  const [title, setTitle] = useState('')
  const [tools, setTools] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => {
    void certificateWordingAction(row.registrationId).then((r) => {
      if (!r.ok || !r.data) return setError(r.ok ? 'Course not found' : r.error)
      setDef(r.data); setTitle(r.data.course); setTools(r.data.tools.join('\n'))
    })
  }, [row.registrationId])
  const list = tools.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
  const send = () => start(async () => {
    if (custom && title.trim().length < 2) return setError('Write the course name to print')
    const r = await requestCertificateAction(row.registrationId, custom ? { courseTitle: title, tools } : undefined)
    if (!r.ok) return setError(r.error)
    onDone(`Certificate requested for ${row.name}${custom ? ' (own course name / tools)' : ''}`)
  })
  return (
    <Modal title={`Request the certificate of ${row.name}`} onClose={onClose}>
      {!def ? <p className="section-hint">{error || 'Loading…'}</p> : (
        <>
          <p className="section-hint" style={{ margin: '-8px 0 12px' }}>{row.regNo} · {row.course}. What the certificate prints is frozen when it is issued.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="radio" checked={!custom} onChange={() => setCustom(false)} style={{ width: 'auto', marginTop: 3 }} />
              <span><strong>As the course</strong><small style={{ display: 'block' }}>{def.course}{def.tools.length ? ` · ${def.toolsLabel}: ${def.tools.join(', ')}` : ''}</small></span></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="radio" checked={custom} onChange={() => setCustom(true)} style={{ width: 'auto', marginTop: 3 }} />
              <span><strong>Own course name and tools</strong><small style={{ display: 'block' }}>When the student learnt different tools, or the certificate should carry another name.</small></span></label>
          </div>
          {custom && (
            <div style={{ marginTop: 12 }}>
              <label className="full-label">Course name on the certificate<span className="required-mark">*</span><input value={title} maxLength={150} onChange={(e) => { setTitle(e.target.value); setError('') }} /></label>
              <label className="full-label">Tools covered (one per line, or separated by commas — up to 12)<textarea rows={5} value={tools} onChange={(e) => setTools(e.target.value)} placeholder={'e.g.\nAutoCAD\nRevit\n3ds Max'} /></label>
              {list.length > 0 && <div className="chip-list" style={{ marginTop: 6 }}>{list.slice(0, 12).map((t) => <span key={t} className="chip">{t}</span>)}</div>}
            </div>
          )}
          <Err msg={error} />
          <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={pending} onClick={send}>{pending ? 'Requesting…' : 'Request certificate'}</button></div>
        </>
      )}
    </Modal>
  )
}
