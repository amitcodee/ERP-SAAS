'use client'

import { useEffect, useState, useTransition } from 'react'
import { CalendarCheck, CalendarDays, Eye, GraduationCap, HandHelping } from 'lucide-react'
import { AttendancePanel } from '@/components/attendance-panel'
import { AttendanceCalendar } from '@/components/attendance-calendar'
import { createStudentLoginAction, queryStudentsAction, studentHelpAction } from '@/app/actions'
import { DetailsModal, Modal as WideModal } from '@/components/registration-modals'
import { ListToolbar, opts, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { usePagedList } from '@/components/use-paged-list'
import type { Summaries } from '@/modules/reports/service'
import { Err, Modal } from '@/components/modal'
import type { CertOverviewRow } from '@/modules/certificates/service'
import type { StudentHelpRow } from '@/modules/teaching/service'

const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** One chip per document: green when issued, orange while still to be made (amber when it is asked for and waiting). */
function Documents({ r }: { r: CertOverviewRow }) {
  const certIssued = !!r.certificateId && !r.revoked
  const chips: { label: string; state: 'done' | 'todo' | 'waiting' | 'off'; note: string }[] = [
    { label: 'Course certificate', state: r.revoked ? 'off' : certIssued ? 'done' : r.requestStatus === 'pending' ? 'waiting' : 'todo', note: r.revoked ? 'Revoked' : certIssued ? `Issued · ${r.certNo}` : r.requestStatus === 'pending' ? 'Requested, waiting to be issued' : 'Not issued yet' },
  ]
  if (r.projectCertificate) chips.push({ label: 'Project certificate', state: r.revoked ? 'off' : certIssued ? 'done' : 'todo', note: certIssued ? 'Issued with the course certificate' : 'Comes with the course certificate' })
  if (r.internship.offer) chips.push({ label: 'Internship selection', state: r.internship.offerIssued ? 'done' : 'todo', note: r.internship.offerIssued ? 'Issued' : 'Not made yet' })
  if (r.internship.completion) chips.push({ label: 'Internship completion', state: r.internship.completionIssued ? 'done' : r.internship.completionRequested ? 'waiting' : 'todo', note: r.internship.completionIssued ? 'Issued' : r.internship.completionRequested ? 'Requested, waiting to be issued' : 'Not made yet' })
  return (
    <div className="doc-chips">
      {chips.map((c) => <span key={c.label} className={`doc-chip ${c.state}`} title={`${c.label}: ${c.note}`}><span className="status-dot" />{c.label}</span>)}
    </div>
  )
}

type BatchesView = Omit<React.ComponentProps<typeof AttendancePanel>, 'notify' | 'top'>
type ListProps = { rows: CertOverviewRow[]; total: number; summary: Summaries['students']; departments: { id: string; name: string }[]; canCreateLogin: boolean; canSeeAttendance: boolean }

/**
 * Students, with a second tab for Batches & attendance (the academic manager puts students in a batch with a
 * trainer; the trainer marks attendance there). The tab sits in the address (?tab=batches).
 */
export function StudentsPanel({ list, batchesView, initialTab, notify }: { list: ListProps | null; batchesView: BatchesView | null; initialTab: 'students' | 'batches'; notify: (m: string) => void }) {
  const [tab, setTab] = useState<'students' | 'batches'>(list ? (batchesView ? initialTab : 'students') : 'batches')
  const go = (t: 'students' | 'batches') => {
    setTab(t)
    try { const u = new URL(window.location.href); if (t === 'batches') u.searchParams.set('tab', 'batches'); else u.searchParams.delete('tab'); window.history.replaceState(null, '', u) } catch { /* ignore */ }
  }
  const top = list && batchesView ? (
    <div className="seg-tabs page-tabs" role="tablist" aria-label="Students">
      <button type="button" role="tab" aria-selected={tab === 'students'} className={tab === 'students' ? 'on' : ''} onClick={() => go('students')}><GraduationCap size={15} /> Students</button>
      <button type="button" role="tab" aria-selected={tab === 'batches'} className={tab === 'batches' ? 'on' : ''} onClick={() => go('batches')}><CalendarDays size={15} /> Batches &amp; attendance</button>
    </div>
  ) : null
  if (tab === 'batches' && batchesView) return <AttendancePanel {...batchesView} notify={notify} top={top} />
  return list ? <StudentsList {...list} notify={notify} top={top} /> : null
}

function StudentsList({ rows, total, summary, departments, canCreateLogin, canSeeAttendance, notify, top }: ListProps & { notify?: (m: string) => void; top?: React.ReactNode }) {
  const list = usePagedList({ rows, total }, queryStudentsAction)
  const [loginFor, setLoginFor] = useState<CertOverviewRow | null>(null)
  const [viewing, setViewing] = useState<CertOverviewRow | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<CertOverviewRow | null>(null)
  const [helpFor, setHelpFor] = useState<CertOverviewRow | null>(null)

  return (
    <section className="page-container table-page">
      {top}
      <div className="page-heading"><div><p className="eyebrow">Management / Students</p><h1>Students &amp; certificates</h1><p className="subheading">A certificate needs zero fee balance, the attendance minimum and an approved capstone. Blockers are shown exactly.</p></div></div>
      <div className="table-summary">
        <div><strong>{summary.total.toLocaleString('en-IN')}</strong><span>Registrations</span></div>
        <div><strong className="text-green">{summary.eligible}</strong><span>Eligible now</span></div>
        <div><strong className="text-amber">{summary.awaiting}</strong><span>Awaiting approval</span></div>
        <div><strong className="text-blue">{summary.issued}</strong><span>Issued</span></div>
      </div>
      <div className="panel table-panel">
        <ListToolbar list={list} exportList={'students'} placeholder="Search name, phone, registration ID or certificate no.…" dateLabel="Enrolled"
          filters={[
            { key: 'cert', label: 'Certificate', options: [{ value: 'eligible', label: 'Eligible now' }, { value: 'blocked', label: 'Not yet eligible' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'issued', label: 'Issued' }, { value: 'revoked', label: 'Revoked' }] },
            { key: 'status', label: 'Registration', options: [{ value: 'active', label: 'Active' }, { value: 'on_hold', label: 'On hold' }, { value: 'discontinued', label: 'Discontinued' }, { value: 'completed', label: 'Completed' }, { value: 'transferred', label: 'Transferred' }] },
            { key: 'dept', label: 'Department', options: opts(departments, (d) => d.id, (d) => d.name) },
          ]}
          sorts={[
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'reg', label: 'Registration ID', dir: 'asc' },
            { key: 'attendance', label: 'Attendance, highest', dir: 'desc' }, { key: 'attendance', label: 'Attendance, lowest', dir: 'asc' },
            { key: 'enrolled', label: 'Enrolled, latest', dir: 'desc' }, { key: 'balance', label: 'Fee balance, highest', dir: 'desc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="name">Student</SortTh><th>Course</th><SortTh list={list} k="enrolled" first="desc">Joined</SortTh><th>Ends</th><th>Documents</th><th /></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.registrationId}>
                  <td><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.regNo}</span></div></td>
                  <td>{r.course}</td>
                  <td>{day(r.joined)}</td>
                  <td>{day(r.ends)}</td>
                  <td><Documents r={r} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {canCreateLogin && (r.hasLogin ? <span className="status-badge status-slate"><span className="status-dot" />Has login</span> : <button className="filter-button" onClick={() => setLoginFor(r)}>Portal login</button>)}
                      {canSeeAttendance && <button type="button" className="filter-button icon-only" title="Attendance: the calendar marked by the trainer" aria-label={`Attendance of ${r.name}`} onClick={() => setAttendanceFor(r)}><CalendarCheck size={15} /></button>}
                      <button type="button" className="filter-button icon-only" title="Project help: what the student asked and the trainer who helped" aria-label={`Help requests of ${r.name}`} onClick={() => setHelpFor(r)}><HandHelping size={15} /></button>
                      <button type="button" className="filter-button icon-only" title="View the full profile" aria-label={`View ${r.name}`} onClick={() => setViewing(r)}><Eye size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No students match these filters.' : 'No students registered yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="students" />
      </div>
      {loginFor && <LoginModal row={loginFor} onClose={() => setLoginFor(null)} onDone={(m) => { setLoginFor(null); notify?.(m) }} />}
      {attendanceFor && <AttendanceCalendar registrationId={attendanceFor.registrationId} title={`${attendanceFor.name} (${attendanceFor.regNo})`} onClose={() => setAttendanceFor(null)} />}
      {helpFor && <HelpModal row={helpFor} onClose={() => setHelpFor(null)} />}
      {viewing && <DetailsModal row={{ id: viewing.registrationId, regNo: viewing.regNo, name: viewing.name }} onClose={() => setViewing(null)} />}
    </section>
  )
}

/** One click: the login is made and its details e-mailed to the student, at the e-mail shown (it can be changed here). */
function LoginModal({ row, onClose, onDone }: { row: CertOverviewRow; onClose: () => void; onDone: (m: string) => void }) {
  const [email, setEmail] = useState(row.email ?? '')
  const [error, setError] = useState('')
  const [shown, setShown] = useState<{ email: string; tempPassword: string; error?: string } | null>(null)
  const [pending, start] = useTransition()
  function send(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await createStudentLoginAction(row.registrationId, email)
      if (!res.ok) return setError(res.error)
      const d = res.data!
      if (d.emailed) return onDone(`Portal login sent to ${d.email}`)
      setShown({ email: d.email, tempPassword: d.tempPassword!, error: d.error })
    })
  }
  return (
    <Modal title="Send portal login" onClose={shown ? () => onDone('Portal login created') : onClose}>
      {shown ? (
        <>
          <p className="section-hint" style={{ margin: '-8px 0 12px' }}>The login was made but the e-mail could not be sent{shown.error ? ` (${shown.error})` : ''}. Give these to the student now; the password is shown only once.</p>
          <div className="review-card" style={{ flexDirection: 'column', alignItems: 'flex-start' }}><span>Email: <strong>{shown.email}</strong></span><span>One-time password: <code style={{ fontSize: 14, userSelect: 'all' }}>{shown.tempPassword}</code></span></div>
          <div className="modal-actions"><button className="button primary" onClick={() => onDone('Portal login created')}>Done</button></div>
        </>
      ) : (
        <form onSubmit={send}>
          <label className="full-label">{row.email ? <>Send <strong>{row.name}</strong>&apos;s portal login to</> : <>No e-mail is on record for <strong>{row.name}</strong>. Their e-mail</>}<span className="required-mark">*</span>
            <input type="email" required autoFocus={!row.email} value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} /></label>
          <p className="section-hint" style={{ margin: '6px 0 0' }}>They get the sign-in link and a one-time password, and choose their own password on first sign-in. This e-mail becomes their login and the e-mail on their record; it must not be used by any other login.</p>
          <Err msg={error} />
          <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Sending…' : 'Send login'}</button></div>
        </form>
      )}
    </Modal>
  )
}

const STATUS: Record<StudentHelpRow['status'], [string, string]> = { open: ['Waiting for a trainer', 'amber'], assigned: ['Trainer helping', 'blue'], done: ['Solved', 'green'], cancelled: ['Cancelled', 'slate'] }

/** A student's project / study help requests and which trainer took each one. */
function HelpModal({ row, onClose }: { row: CertOverviewRow; onClose: () => void }) {
  const [list, setList] = useState<StudentHelpRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { studentHelpAction(row.registrationId).then((r) => { if (r.ok) setList(r.data ?? []); else { setError(r.error); setList([]) } }) }, [row.registrationId])
  return (
    <WideModal wide title={`Project help — ${row.name} (${row.regNo})`} onClose={onClose}>
      <Err msg={error} />
      {list === null ? <p className="section-hint">Loading…</p> : !list.length ? <p className="section-hint">This student has not asked trainers for help yet.</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Request</th><th>Asked on</th><th>Status</th><th>Trainer who helped</th></tr></thead>
          <tbody>{list.map((h) => (
            <tr key={h.id}>
              <td style={{ whiteSpace: 'normal', maxWidth: 320 }}><strong>{h.title}</strong><small style={{ display: 'block' }}>{h.no} · {h.kind}</small><small style={{ display: 'block', color: '#64748b' }}>{h.details}</small></td>
              <td>{day(h.at)}</td>
              <td><span className={`status-badge status-${STATUS[h.status][1]}`}><span className="status-dot" />{STATUS[h.status][0]}</span></td>
              <td style={{ whiteSpace: 'normal' }}>{h.trainer
                ? <><strong>{h.trainer}</strong>{h.trainerBranch && <small style={{ display: 'block' }}>{h.trainerBranch}</small>}{h.trainerEmail && <small style={{ display: 'block' }}><a href={`mailto:${h.trainerEmail}`}>{h.trainerEmail}</a></small>}</>
                : h.offers.length ? <small>Offered: {h.offers.join(', ')} (student to choose)</small> : <small style={{ color: '#8b98aa' }}>—</small>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
    </WideModal>
  )
}
