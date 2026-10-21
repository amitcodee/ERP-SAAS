'use client'
// Internship letters (Documents). Two pages share this screen:
//   requests: add interns, issue their selection letter, and ask for the completion certificate when they finish.
//   complete: the completion certificates to issue, and every issued one.
// Every letter is made from its template (Letter Templates) with the intern's details filled in.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Ban, FileBadge, FileText, Pencil, Plus, Search, Send } from 'lucide-react'
import { cancelInternshipAction, createInternshipAction, issueCompletionAction, issueOfferAction, requestCompletionAction, updateInternshipAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { InternInput, InternListRow, LetterCompany, RegistrationLetterRow, TemplateRef } from '@/modules/letters/service'

const day = (k: string | null) => (k ? new Date(k.length > 10 ? k : `${k}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const inr = (paise: number | null) => (paise == null ? '—' : '₹' + (paise / 100).toLocaleString('en-IN'))

const STATUS: Record<string, { label: string; tone: string; what: string }> = {
  offer_requested: { label: 'Selection letter to issue', tone: 'amber', what: 'Added; a manager issues the selection letter.' },
  offer_issued: { label: 'Interning', tone: 'blue', what: 'Selection letter issued; the internship is on.' },
  completion_requested: { label: 'Completion requested', tone: 'violet', what: 'Finished; a manager issues the completion certificate.' },
  completed: { label: 'Completed', tone: 'green', what: 'Completion certificate issued.' },
  cancelled: { label: 'Cancelled', tone: 'red', what: 'The internship was cancelled.' },
}

export function InternshipsPanel({ page, data, fromReg, templates, companies, filters, can, showBranch, needsBranch }: {
  page: 'requests' | 'complete'
  fromReg: RegistrationLetterRow[]
  templates: TemplateRef[]
  companies: LetterCompany[] // the active ones, the main company (the institute) first
  data: { tab: string; counts: Record<string, number>; rows: InternListRow[] }
  filters: { tab: string; q: string }
  can: { request: boolean; issue: boolean }
  showBranch: boolean
  needsBranch: boolean
}) {
  const router = useRouter()
  const path = usePathname()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<{ row: InternListRow | null; prefill?: InternInput } | null>(null)
  const [completing, setCompleting] = useState<InternListRow | null>(null)
  const [cancelling, setCancelling] = useState<InternListRow | null>(null)
  const [q, setQ] = useState(filters.q)
  const go = (patch: Partial<typeof filters>) => router.push(`${path}?${new URLSearchParams(Object.entries({ ...filters, ...patch }).filter(([, v]) => v))}`)
  const act = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id)
    start(async () => { const res = await fn(); setBusy(null); if (!res.ok) return notify(res.error ?? 'Could not save'); notify(done); router.refresh() })
  }

  const tabs: [string, string][] = page === 'requests'
    ? [['from', 'From registrations'], ['offer', 'Selection letter to issue'], ['active', 'Interning now'], ['ending', 'Ending this or next month'], ['requested', 'Completion requested'], ['all', 'All interns']]
    : [['from', 'From registrations'], ['requested', 'Completion to issue'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All interns']]
  const current = filters.tab || tabs[0][0]

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Documents / {page === 'requests' ? 'Internship Requests' : 'Internship Complete'}</p>
          <h1>{page === 'requests' ? 'Internship requests' : 'Internship complete'}</h1>
          <p className="subheading">{page === 'requests'
            ? 'Add an intern and their selection letter is ready to issue, made from the standard letter with their details filled in. When the internship ends, ask for the completion certificate here.'
            : 'Interns who finished: issue their completion certificate (made from the standard certificate with their details and work filled in). Issued letters stay here to print again.'}</p>
        </div>
        {page === 'requests' && can.request && <button type="button" className="button primary" disabled={needsBranch} title={needsBranch ? 'Pick the branch first (top left)' : ''} onClick={() => setForm({ row: null })}><Plus size={16} /> Add intern</button>}
      </div>

      <ol className="cd-steps" aria-label="How internship letters work">
        <li className={page === 'requests' ? 'on' : ''}><Plus size={15} /><div><strong>1. Add the intern</strong><span>Details once: role, dates, stipend, place. Branch staff.</span></div></li>
        <li className={page === 'requests' ? 'on' : ''}><FileText size={15} /><div><strong>2. Selection letter</strong><span>A manager issues it; it is made and frozen at that moment.</span></div></li>
        <li className={page === 'complete' ? 'on' : ''}><FileBadge size={15} /><div><strong>3. Completion certificate</strong><span>Requested at the end with the work done; a manager issues it.</span></div></li>
      </ol>

      <div className="cd-tabs" role="tablist">
        {tabs.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={current === v} className={current === v ? 'on' : ''} onClick={() => go({ tab: v })}>{l}<b>{v === 'from' ? fromReg.length : data.counts[v] ?? 0}</b></button>)}
      </div>

      {current === 'from' ? (
        <div className="panel table-panel">
          <div className="panel-header"><div><h2>Students registered with internship letters</h2><span>Ticked at registration (or later from the Registration list). Set up their letters: the registration fills in what it knows; add the role, stipend and hours.</span></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Student</th><th>Course</th>{showBranch && <th>Branch</th>}<th>Letters needed</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {fromReg.map((r) => (
                <tr key={r.registrationId}>
                  <td><strong>{r.name}</strong><small>{r.regNo} · {r.phone}</small></td>
                  <td>{r.course ?? '—'}</td>
                  {showBranch && <td>{r.branch}</td>}
                  <td>{r.offer && <small>Selection — {templates.find((t) => t.kind === 'internship_offer' && t.id === r.offerTemplateId)?.name ?? 'Standard'}</small>}{r.completion && <small>Completion — {templates.find((t) => t.kind === 'internship_completion' && t.id === r.completionTemplateId)?.name ?? 'Standard'}</small>}<small>{companies.find((c) => c.id === r.prefill.companyId)?.name ?? companies[0]?.name}</small></td>
                  <td><div className="row-actions" style={{ justifyContent: 'flex-end' }}>{can.request ? <button type="button" className="button primary small" onClick={() => setForm({ row: null, prefill: r.prefill })}><Plus size={13} /> Set up letters</button> : <small>Branch staff set it up</small>}</div></td>
                </tr>
              ))}
              {!fromReg.length && <tr><td colSpan={showBranch ? 5 : 4} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>No student is waiting. Tick the internship letters on a registration to see them here.</td></tr>}
            </tbody>
          </table></div>
        </div>
      ) : (
      <div className="panel table-panel">
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div><h2>{tabs.find(([v]) => v === current)?.[1]}</h2><span>{data.rows.length} intern{data.rows.length === 1 ? '' : 's'}. Point at a status for what it means.</span></div>
          <form onSubmit={(e) => { e.preventDefault(); go({ q }) }}><span className="cd-search" style={{ marginTop: 0, minWidth: 260 }}><Search size={15} /><input value={q} placeholder="Name, phone, ref. no. or role" onChange={(e) => setQ(e.target.value)} /></span></form>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Intern</th><th>Role</th><th>Company</th>{showBranch && <th>Branch</th>}<th>Internship</th><th>Days left</th><th>Stipend</th><th>Status</th><th style={{ textAlign: 'right' }}>Letters &amp; actions</th></tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const s = STATUS[r.status] ?? STATUS.offer_requested
              const open = r.status !== 'completed' && r.status !== 'cancelled'
              return (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong><small>{r.refNo}{r.phone ? ` · ${r.phone}` : ''}</small></td>
                  <td>{r.designation}</td>
                  <td>{r.company}</td>
                  {showBranch && <td>{r.branch}</td>}
                  <td>{day(r.fromDate)} – {day(r.toDate)}</td>
                  <td>{r.status === 'completed' || r.status === 'cancelled' ? '—'
                    : r.daysLeft < 0 ? <span className="status-badge status-green"><span className="status-dot" />Ended {-r.daysLeft} day{r.daysLeft === -1 ? '' : 's'} ago</span>
                    : <span className={`status-badge status-${r.daysLeft <= 7 ? 'amber' : r.daysLeft <= 31 ? 'blue' : 'slate'}`}><span className="status-dot" />{r.daysLeft} day{r.daysLeft === 1 ? '' : 's'} left</span>}</td>
                  <td>{r.stipend ? `${inr(r.stipend)} / month` : 'Unpaid'}</td>
                  <td><span className={`status-badge status-${s.tone}`} title={s.what}><span className="status-dot" />{s.label}</span>{r.cancelReason && <small className="text-red">{r.cancelReason}</small>}</td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <Link className="filter-button" href={`/letters/${r.id}/internship_offer`} target="_blank" title={r.offerIssuedAt ? `Issued ${day(r.offerIssuedAt)}` : 'A draft until it is issued'}><FileText size={14} /> Selection letter</Link>
                      {(r.status === 'completion_requested' || r.status === 'completed') && <Link className="filter-button" href={`/letters/${r.id}/internship_completion`} target="_blank" title={r.completedAt ? `Issued ${day(r.completedAt)}` : 'A draft until it is issued'}><FileBadge size={14} /> Completion</Link>}
                      {open && can.request && <button type="button" className="filter-button icon-only" title="Edit the intern's details" aria-label={`Edit ${r.name}`} onClick={() => setForm({ row: r })}><Pencil size={14} /></button>}
                      {r.status === 'offer_requested' && can.issue && <button type="button" className="button primary small" disabled={pending} onClick={() => act(r.id, () => issueOfferAction(r.id), `Selection letter issued to ${r.name}`)}>{busy === r.id ? 'Issuing…' : 'Issue selection letter'}</button>}
                      {r.status === 'offer_issued' && can.request && <button type="button" className="button primary small" disabled={pending} onClick={() => setCompleting(r)}><Send size={13} /> Request completion</button>}
                      {r.status === 'completion_requested' && can.issue && <button type="button" className="button primary small" disabled={pending} onClick={() => act(r.id, () => issueCompletionAction(r.id), `Completion certificate issued to ${r.name}`)}>{busy === r.id ? 'Issuing…' : 'Issue completion certificate'}</button>}
                      {open && can.issue && <button type="button" className="filter-button icon-only" title="Cancel this internship" aria-label={`Cancel ${r.name}`} onClick={() => setCancelling(r)}><Ban size={14} /></button>}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!data.rows.length && <tr><td colSpan={showBranch ? 9 : 8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>Nobody here yet.{page === 'requests' && can.request ? ' Add an intern to make their selection letter.' : ''}</td></tr>}
          </tbody>
        </table></div>
      </div>

      )}

      {form && <InternForm row={form.row} prefill={form.prefill} templates={templates} companies={companies} onClose={() => setForm(null)} onDone={(m) => { setForm(null); notify(m); router.refresh() }} />}
      {completing && <CompleteForm row={completing} onClose={() => setCompleting(null)} onDone={(m) => { setCompleting(null); notify(m); router.refresh() }} />}
      {cancelling && <CancelForm row={cancelling} onClose={() => setCancelling(null)} onDone={(m) => { setCancelling(null); notify(m); router.refresh() }} />}
    </section>
  )
}

const EMPTY: InternInput = { name: '', gender: null, phone: '', email: '', address: '', designation: '', domain: '', trainingFrom: '', trainingTo: '', trainingLocation: '', fromDate: '', toDate: '', stipend: null, workLocation: '', workingHours: '9:00 AM to 6:00 PM', workMode: 'As assigned by the company, depending on business requirements and work responsibilities.', responsibilities: '', skills: '', project: '' }

function InternForm({ row, prefill, templates, companies, onClose, onDone }: { row: InternListRow | null; prefill?: InternInput; templates: TemplateRef[]; companies: LetterCompany[]; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState<InternInput>(row?.input ?? (prefill ? ({ ...EMPTY, ...Object.fromEntries(Object.entries(prefill).filter(([, v]) => v != null)) } as InternInput) : EMPTY))
  const [stipend, setStipend] = useState(row?.input.stipend != null ? String(row.input.stipend / 100) : '')
  const [paid, setPaid] = useState(!!row?.input.stipend)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const set = (p: Partial<InternInput>) => setF({ ...f, ...p })
  // the company the intern is taken on by: its templates, letterhead and stamp make the letters
  const companyId = f.companyId || companies[0]?.id
  const mine = (kind: TemplateRef['kind']) => templates.filter((t) => t.kind === kind && t.companyId === companyId)
  const txt = (k: keyof InternInput, label: string, opts: { req?: boolean; ph?: string; type?: string } = {}) => (
    <label>{label}{opts.req && <span className="required-mark">*</span>}<input type={opts.type ?? 'text'} required={opts.req} placeholder={opts.ph} value={(f[k] as string) ?? ''} onChange={(e) => set({ [k]: e.target.value } as Partial<InternInput>)} /></label>
  )
  return (
    <Modal title={row ? `Edit intern — ${row.name}` : 'Add intern'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        const input = { ...f, companyId, stipend: paid && stipend.trim() ? Math.round(Number(stipend) * 100) : null }
        const res = row ? await updateInternshipAction(row.id, input) : await createInternshipAction(input)
        if (!res.ok) return setErr(res.error)
        onDone(row ? 'Intern saved' : `Intern added (${(res as { data?: string }).data}). The selection letter is ready to issue.`)
      }) }}>
        <p className="section-hint">{prefill ? 'Filled in from the registration; add the role, stipend, hours and place the letter needs.' : 'Everything here fills the letters by itself.'} Fields left empty show as a gap in the letter, so fill what the letter needs.</p>
        <div className="wl-form" style={{ marginBottom: 12 }}>
          <label className="wide">Company<span className="required-mark">*</span><select value={companyId ?? ''} onChange={(e) => set({ companyId: e.target.value, offerTemplateId: null, completionTemplateId: null })}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><small className="reg-note">The letters are made from this company&apos;s templates, on its letterhead with its stamp.</small></label>
          <label>Selection letter template<select value={f.offerTemplateId ?? ''} disabled={f.wantsOffer === false} onChange={(e) => set({ offerTemplateId: e.target.value || null })}>{mine('internship_offer').map((t) => <option key={t.id ?? 'std'} value={t.id ?? ''}>{t.name}</option>)}</select>{f.wantsOffer === false && <small className="reg-note">No selection letter: only the completion certificate.</small>}</label>
          <label>Completion letter template<select value={f.completionTemplateId ?? ''} onChange={(e) => set({ completionTemplateId: e.target.value || null })}>{mine('internship_completion').map((t) => <option key={t.id ?? 'std'} value={t.id ?? ''}>{t.name}</option>)}</select></label>
        </div>
        <div className="wl-form">
          {txt('name', 'Full name', { req: true })}
          <label>Gender (for he / she in the letters)<select value={f.gender ?? ''} onChange={(e) => set({ gender: (e.target.value || null) as InternInput['gender'] })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          {txt('phone', 'Phone')}{txt('email', 'E-mail', { type: 'email' })}
          <label className="wide">Address<textarea rows={2} value={f.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></label>
          {txt('designation', 'Designation / role', { req: true, ph: 'e.g. Junior Digital Marketer' })}{txt('domain', 'Work area', { ph: 'e.g. mobile app development' })}
          {txt('trainingFrom', 'Training from', { type: 'date' })}{txt('trainingTo', 'Training to', { type: 'date' })}
          {(prefill?.registrationId || row?.input.registrationId) && <small className="reg-note wide" style={{ marginTop: -6 }}>Training dates come from the registration (joining date to expected end); change them if needed.</small>}
          {txt('trainingLocation', 'Training location', { ph: 'the branch, e.g. Jalandhar' })}{txt('workLocation', 'Working location', { ph: 'the branch address, e.g. Amritsar, Punjab' })}
          {txt('fromDate', 'Internship from', { req: true, type: 'date' })}{txt('toDate', 'Internship to', { req: true, type: 'date' })}
          <div className="reg-field">
            <span className="reg-field-label">Stipend</span>
            <div className="reg-seg" role="radiogroup" aria-label="Stipend">
              <button type="button" role="radio" aria-checked={!paid} className={!paid ? 'on' : ''} onClick={() => { setPaid(false); setStipend('') }}>No (unpaid)</button>
              <button type="button" role="radio" aria-checked={paid} className={paid ? 'on' : ''} onClick={() => setPaid(true)}>Yes</button>
            </div>
            {paid && <input className="reg-tpl" inputMode="numeric" required placeholder="₹ per month, e.g. 10000" value={stipend} onChange={(e) => setStipend(e.target.value.replace(/[^\d.]/g, ''))} />}
          </div>
          {txt('workingHours', 'Working hours')}
          <label className="wide">Work mode<input value={f.workMode ?? ''} onChange={(e) => set({ workMode: e.target.value })} /></label>
          <label className="wide">Roles and responsibilities<textarea rows={6} placeholder={'One per line, e.g.\n1. Manage social media pages.\n2. Prepare campaign reports.'} value={f.responsibilities ?? ''} onChange={(e) => set({ responsibilities: e.target.value })} /><small className="reg-note">Numbered lines (1. 2. 3.) and **bold** headings work as in the letter.</small></label>
        </div>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : row ? 'Save' : 'Add intern'}</button></div>
      </form>
    </Modal>
  )
}

function CompleteForm({ row, onClose, onDone }: { row: InternListRow; onClose: () => void; onDone: (m: string) => void }) {
  const [w, setW] = useState({ domain: row.input.domain ?? '', skills: row.input.skills ?? '', project: row.input.project ?? '' })
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Request completion certificate — ${row.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await requestCompletionAction(row.id, w); if (!res.ok) return setErr(res.error); onDone(`Completion certificate requested for ${row.name}`) }) }}>
        <p className="section-hint">The certificate tells what the intern worked on. Write it as it should read in the letter; a manager then issues it.</p>
        <div className="wl-form">
          <label className="wide">Worked on (the work area)<input required value={w.domain} placeholder="e.g. mobile application development, user interface design and backend integration" onChange={(e) => setW({ ...w, domain: e.target.value })} /></label>
          <label className="wide">Tools and skills<input required value={w.skills} placeholder="e.g. Android Studio, Kotlin, Firebase and RESTful APIs" onChange={(e) => setW({ ...w, skills: e.target.value })} /></label>
          <label className="wide">What they built or achieved<textarea rows={5} value={w.project} placeholder="e.g. Built a fully functional Android app for student course registration, with push notifications…" onChange={(e) => setW({ ...w, project: e.target.value })} /></label>
        </div>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Sending…' : 'Request certificate'}</button></div>
      </form>
    </Modal>
  )
}

function CancelForm({ row, onClose, onDone }: { row: InternListRow; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Cancel the internship of ${row.name}?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await cancelInternshipAction(row.id, reason); if (!res.ok) return setErr(res.error); onDone('Internship cancelled') }) }}>
        <label>Reason<textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Keep it</button><button className="button primary wl-danger-fill" disabled={pending}>{pending ? 'Saving…' : 'Cancel internship'}</button></div>
      </form>
    </Modal>
  )
}
