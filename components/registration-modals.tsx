'use client'
// The pop-ups of the registrations table: the student's full details, back-dating, and a fee-change request to accounts.
import { Modal } from '@/components/modal'
import { useEffect, useState, useTransition } from 'react'
import { IdCard, IndianRupee, UserRound, X } from 'lucide-react'
import { registrationDetailsAction, updateRegistrationDatesAction } from '@/app/actions'
import { BranchMatches } from '@/components/branch-matches'
import { DateInput } from '@/components/date-input'
import { MIN_FIRST_PAYMENT, planLabel } from '@/modules/fees/plan'
import { formatAadhaar } from '@/modules/people/aadhaar'
import type { RegistrationDetails } from '@/modules/registrations/service'
import { REG_STATUS_LABEL, type RegistrationStatus } from '@/modules/registrations/status'
import type { RegistrationRow } from '@/components/registrations-panel'

const inr = (paise: number | null) => (paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN'))
const fmt = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const clock = (hhmm: string, plusMin = 0) => { const [h, m] = hhmm.split(':').map(Number); const t = (h * 60 + m + plusMin) % 1440; const hh = Math.floor(t / 60); return `${hh % 12 || 12}${t % 60 ? `:${String(t % 60).padStart(2, '0')}` : ''} ${hh < 12 ? 'AM' : 'PM'}` }
const hours = (min: number) => (min % 60 ? `${min / 60} hours` : `${min / 60} hour${min === 60 ? '' : 's'}`)

export { Modal } from '@/components/modal'
const Err = ({ msg }: { msg: string }) => (msg ? <p role="alert" className="form-problem">{msg}</p> : null)
const Section = ({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) => (
  <section className="reg-view-block"><h3>{title}</h3><dl className="detail-list">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl></section>
)

/** Everything on record about the student and this registration. */
export function DetailsModal({ row, onClose, actions }: { row: Pick<RegistrationRow, 'id' | 'regNo' | 'name'>; onClose: () => void; actions?: React.ReactNode }) {
  const [d, setD] = useState<RegistrationDetails | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { registrationDetailsAction(row.id).then((r) => (r.ok && r.data ? setD(r.data) : setError(r.ok ? 'Not found' : r.error))) }, [row.id])
  return (
    <Modal wide title={`${row.regNo} · ${row.name}`} onClose={onClose}>
      <Err msg={error} />
      {!d && !error && <p className="section-hint">Loading…</p>}
      {d && (
        <div className="reg-view">
          <div className="reg-view-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="reg-view-photo">{d.photoId ? <img src={`/documents/${d.photoId}`} alt={d.name} /> : <UserRound size={40} />}</div>
            <div>
              <strong>{d.name}</strong>
              <span>{d.course ?? d.department ?? '—'} · {d.branch}</span>
              <div className="reg-view-badges">
                <span className={`status-badge ${d.status !== 'active' ? 'status-slate' : d.active ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{d.status === 'active' && !d.active ? 'Inactive (no fee yet)' : REG_STATUS_LABEL[d.status as RegistrationStatus] ?? d.status}</span>
                {d.kind === 'upgrade' && <span className="status-badge status-blue">Upgrade{d.upgradedFrom ? ` from ${d.upgradedFrom}` : ''}</span>}
                {d.enquiryNo && <span className="status-badge status-slate">From {d.enquiryNo}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {actions ?? <>
                  <a className="button secondary" href={`/registrations/${d.id}/id-card`} target="_blank" rel="noreferrer"><IdCard size={15} /> ID card</a>
                  <a className="button secondary" href={`/fees/${d.id}`}><IndianRupee size={15} /> Fees page</a>
                </>}
              </div>
            </div>
          </div>
          {/* the same student in other branches (or a second record here): by mobile, e-mail, date of birth */}
          <BranchMatches phone={d.phone} email={d.email} dob={d.dob} firstName={d.firstName} excludePersonId={d.personId} />
          <Section title="Student" rows={[
            ['Father\'s name', d.fatherName], ['Mother\'s name', d.motherName], ['Date of birth', fmt(d.dob)], ['Gender', d.gender ? d.gender[0].toUpperCase() + d.gender.slice(1) : null],
            ['Aadhaar no.', d.aadhaarNo ? formatAadhaar(d.aadhaarNo) : null], ['Email ID', d.email], ['Currently', d.occupation], ['Qualification', d.qualification], ['Workplace / college', d.schoolOrCollege], ['Address', d.address],
          ]} />
          <Section title="Contact" rows={[['Mobile no.', d.phone], ['WhatsApp / alternate no.', d.altPhone], ['Parent / guardian no.', d.guardianPhone]]} />
          <Section title="Course and classes" rows={[
            ['Department', d.department], ['Course', d.course], ...(d.customModules.length ? [['Modules', d.customModules.join(', ')] as [string, React.ReactNode]] : []), ['Mode of classes', d.classMode],
            ['Registered on', fmt(d.enrollmentDate)], ['Joining date', fmt(d.joiningDate)], ['Expected to finish', fmt(d.expectedEndDate)],
            ['Class time', d.classMinutesPerDay ? `${hours(d.classMinutesPerDay)} a day, ${d.classDaysPerWeek ?? '—'} days a week${d.classStartTime ? ` (${clock(d.classStartTime)} to ${clock(d.classStartTime, d.classMinutesPerDay)})` : ''}` : null],
            ['Course hours', d.courseHours ? `${d.courseHours} hours` : null], ['Registered by', d.createdBy],
          ]} />
          <Section title="Fees" rows={[
            ['Total fees (before offer)', inr(d.listFee)], ['Discount', d.listFee != null && d.listFee > d.totalFee ? inr(d.listFee - d.totalFee) : 'None'], ['Fees to pay', inr(d.totalFee)],
            ['of which GST', d.gstAmount != null ? inr(d.gstAmount) : null], ['Paid', inr(d.paid)], ['Balance', d.balance > 0 ? inr(d.balance) : 'Cleared'], ['Payment plan', planLabel(d.feePlan)],
          ]} />
          {d.installments.length > 0 && (
            <section className="reg-view-block"><h3>Installments</h3>
              <ol className="plan-lines">{d.installments.map((i, k) => <li className="plan-line" key={k}><i>{k + 1}</i><span>{i.status === 'paid' ? 'Paid' : 'To pay'}</span><span>{fmt(i.dueDate)}</span><strong>{inr(i.amount)}</strong></li>)}</ol>
            </section>
          )}
          <section className="reg-view-block"><h3>Certificates and internship letters</h3>
            <dl className="detail-list">
              <div><dt>Course certificate</dt><dd>{d.letters.certificate ? <>{d.letters.certificate.revoked ? 'Revoked' : 'Issued'} {fmt(d.letters.certificate.issuedAt.slice(0, 10))} · <a href={`/verify/${d.letters.certificate.hash}/certificate`} target="_blank" rel="noreferrer">{d.letters.certificate.certNo}</a></> : 'Not issued yet'}</dd></div>
              <div><dt>Project certificate</dt><dd>{d.projectCertificate ? (d.letters.certificate ? <a href={`/verify/${d.letters.certificate.hash}/certificate?kind=project`} target="_blank" rel="noreferrer">Included — open</a> : 'Included (with the course certificate)') : 'Not included'}</dd></div>
              <div><dt>Internship selection letter</dt><dd>{!d.letters.offer && !(d.letters.intern?.wantsOffer) ? 'Not needed' : !d.letters.intern ? `Needed (${d.letters.offerTemplate}) — not set up yet` : d.letters.intern.offerIssuedAt ? <>Issued {fmt(d.letters.intern.offerIssuedAt.slice(0, 10))} · <a href={`/letters/${d.letters.intern.id}/internship_offer`} target="_blank" rel="noreferrer">Open letter</a></> : <>Waiting to be issued · <a href={`/letters/${d.letters.intern.id}/internship_offer`} target="_blank" rel="noreferrer">See draft</a></>}</dd></div>
              <div><dt>Internship completion letter</dt><dd>{!d.letters.completion && !d.letters.intern ? 'Not needed' : !d.letters.intern ? `Needed (${d.letters.completionTemplate}) — not set up yet` : d.letters.intern.completedAt ? <>Issued {fmt(d.letters.intern.completedAt.slice(0, 10))} · <a href={`/letters/${d.letters.intern.id}/internship_completion`} target="_blank" rel="noreferrer">Open letter</a></> : d.letters.intern.status === 'completion_requested' ? <>Requested, waiting to be issued · <a href={`/letters/${d.letters.intern.id}/internship_completion`} target="_blank" rel="noreferrer">See draft</a></> : 'After the internship ends'}</dd></div>
              {d.letters.intern && <div><dt>Internship</dt><dd>{d.letters.intern.designation} · {d.letters.intern.refNo}</dd></div>}
            </dl>
            {(d.letters.offer || d.letters.completion) && !d.letters.intern && <p className="section-hint" style={{ margin: '8px 0 0' }}>Set up the letters in Documents → Internship Requests → From registrations.</p>}
          </section>
          {d.status === 'active' && !d.active && <p className="section-hint" style={{ margin: 0 }}>This student becomes active once at least {inr(MIN_FIRST_PAYMENT)} of the fee is received.</p>}
        </div>
      )}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
    </Modal>
  )
}

/** Back-dating: correct the registration, joining and finish dates (e.g. so the certificate can be made earlier). */
export function DatesForm({ row, onClose, onDone }: { row: RegistrationRow; onClose: () => void; onDone: (m: string) => void }) {
  const [d, setD] = useState({ enrollmentDate: row.enrollmentDate.slice(0, 10), joiningDate: row.joiningDate ?? '', expectedEndDate: row.expectedEndDate ?? '', note: '' })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!d.enrollmentDate) return setError('Choose the registration date.')
    if (d.note.trim().length < 3) return setError('Say why the dates are changed.')
    start(async () => {
      const res = await updateRegistrationDatesAction({ registrationId: row.id, enrollmentDate: d.enrollmentDate, joiningDate: d.joiningDate || null, expectedEndDate: d.expectedEndDate || null, note: d.note })
      if (!res.ok) return setError(res.error)
      onDone(`Dates of ${row.regNo} updated`)
    })
  }
  return (
    <Modal title={`Edit dates · ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name}. Only the dates can be changed here; they may be set in the past (back-dated), for example to make the certificate earlier. The change and its reason are kept in the history.</p>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <label>Registration date<span className="required-mark">*</span><DateInput type="date" value={d.enrollmentDate} onChange={(e) => setD({ ...d, enrollmentDate: e.target.value })} /></label>
          <label>Joining date<DateInput type="date" value={d.joiningDate} onChange={(e) => setD({ ...d, joiningDate: e.target.value })} /></label>
          <label>Expected finish date<DateInput type="date" value={d.expectedEndDate} onChange={(e) => setD({ ...d, expectedEndDate: e.target.value })} /></label>
        </div>
        <label className="full-label">Reason<span className="required-mark">*</span><textarea value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="Why the dates are being changed" /></label>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save dates'}</button></div>
      </form>
    </Modal>
  )
}
