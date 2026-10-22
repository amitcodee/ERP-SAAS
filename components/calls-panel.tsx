'use client'

import { AddButton } from '@/components/branch-gate'
import { useEffect, useRef, useState, useTransition } from 'react'
import { BranchMatches, fillForm } from '@/components/branch-matches'
import { Eye, Pencil, PhoneCall, Plus, Trash2 } from 'lucide-react'
import { callFollowUpsAction, deleteCallAction, followUpCallAction, logCallAction, promoteCallAction, queryCallsAction, updateCallAction } from '@/app/actions'
import { fmtDateTime, heat, Interest, localInput } from '@/components/enquiries-panel'
import { FOLLOW, ListToolbar, opts, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { PAGE_SIZE, usePagedList } from '@/components/use-paged-list'
import type { Summaries } from '@/modules/reports/service'
import { ConfirmDelete, Err, Modal, QuickDate } from '@/components/modal'
import type { Catalogs } from '@/modules/catalog/service'
import { DateInput } from '@/components/date-input'

export type CallRow = {
  id: string; calledAt: string; status: string | null; remarks: string | null; followUpDate: string | null; proposedFee: number | null
  enquiryId: string | null; departmentId: string | null; courseId: string | null; name: string | null; phone: string | null; altPhone: string | null
  department: string | null; course: string | null; receivedBy: string | null; branchCode: string | null; branchName: string | null
  callRemark: string | null; interested: boolean | null; interestPct: number | null; expectedVisitDate: string | null; deadReason: string | null
  followUps: number // follow-up calls made so far
  categoryId: string | null; category: string | null // lead category
}

/** The usual outcomes of a call; anything else can be typed in. */
export const CALL_STATUSES = ['Will visit', 'In process', 'No plan', 'Visited', 'Dead lead']

/** The lead details of a call as the form holds them. */
type Lead = { status: string; interested: boolean | null; interestPct: number; expectedVisitDate: string; deadReason: string; callRemark: string; categoryId: string }
const NEW_LEAD: Lead = { status: '', interested: null, interestPct: 50, expectedVisitDate: '', deadReason: '', callRemark: '', categoryId: '' }
const leadOf = (r: CallRow): Lead => ({ status: r.status ?? '', interested: r.interested, interestPct: r.interestPct ?? 50, expectedVisitDate: r.expectedVisitDate ?? '', deadReason: r.deadReason ?? '', callRemark: r.callRemark ?? '', categoryId: r.categoryId ?? '' })
const isDead = (l: Lead) => l.status === 'Dead lead'
const leadPayload = (l: Lead) => ({
  status: l.status.trim() || null, callRemark: l.callRemark.trim() || null, categoryId: l.categoryId || null,
  interested: isDead(l) ? false : l.interested, interestPct: !isDead(l) && l.interested ? l.interestPct : null,
  expectedVisitDate: l.status === 'Will visit' ? l.expectedVisitDate || null : null, deadReason: isDead(l) ? l.deadReason.trim() || null : null,
})

/** Status dropdown with an "Other" choice that opens a text box. */
function StatusPick({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const [manual, setManual] = useState(!!value && !CALL_STATUSES.includes(value))
  return (
    <>
      <label>Status{required && <span className="required-mark">*</span>}
        <select value={manual ? '__other' : value} required={required && !manual} onChange={(e) => { const v = e.target.value; setManual(v === '__other'); onChange(v === '__other' ? '' : v) }}>
          <option value="">Select status</option>
          {CALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          <option value="__other">Other (type it)…</option>
        </select>
      </label>
      {manual && <label>Status (typed)<input value={value} autoFocus maxLength={100} required={required} onChange={(e) => onChange(e.target.value)} placeholder="Type the status" /></label>}
    </>
  )
}

/** Lead category dropdown (head office keeps the list in Settings). A category that was switched off stays selectable on the record that has it. */
export function CategoryPick({ value, onChange, categories, current }: { value: string; onChange: (v: string) => void; categories: { id: string; value: string }[]; current?: string | null }) {
  return (
    <label>Lead category
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{categories.length ? '—' : 'No categories yet (add under Lead Categories)'}</option>
        {value && !categories.some((c) => c.id === value) && <option value={value}>{current ?? 'Current category'}</option>}
        {categories.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}
      </select>
    </label>
  )
}

/** Goes inside the form grid: the status, and what that status asks for ("Will visit" = when). */
function LeadGrid({ lead, set, required, categories }: { lead: Lead; set: (l: Lead) => void; required?: boolean; categories: { id: string; value: string }[] }) {
  return (
    <>
      <StatusPick value={lead.status} onChange={(status) => set({ ...lead, status })} required={required} />
      {lead.status === 'Will visit' && <label>Expected visit date<span className="required-mark">*</span><DateInput type="date" required value={lead.expectedVisitDate} onChange={(e) => set({ ...lead, expectedVisitDate: e.target.value })} /></label>}
      <CategoryPick value={lead.categoryId} onChange={(categoryId) => set({ ...lead, categoryId })} categories={categories} />
    </>
  )
}

/** Goes below the form grid: how interested the caller is (or why the lead died) and what the caller said. */
function LeadRest({ lead, set }: { lead: Lead; set: (l: Lead) => void }) {
  const choice = (label: string, on: boolean, pick: () => void) => <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={pick}>{label}</button>
  return (
    <div className="lead-fields" style={{ marginTop: 15 }}>
      {isDead(lead) ? (
        <label className="full-label" style={{ marginTop: 0 }}>Why is this lead dead?<span className="required-mark">*</span><textarea required value={lead.deadReason} maxLength={500} onChange={(e) => set({ ...lead, deadReason: e.target.value })} /></label>
      ) : (
        <>
          <div className="lead-q">
            <span>Interested?</span>
            <div className="seg">{choice('Yes', lead.interested === true, () => set({ ...lead, interested: true }))}{choice('No', lead.interested === false, () => set({ ...lead, interested: false }))}{choice('Not asked yet', lead.interested === null, () => set({ ...lead, interested: null }))}</div>
          </div>
          {lead.interested === true && (
            <div className="lead-q">
              <span>How interested? <strong>{lead.interestPct}% · {heat(lead.interestPct)[0]}</strong></span>
              <input type="range" min={0} max={100} step={5} value={lead.interestPct} onChange={(e) => set({ ...lead, interestPct: Number(e.target.value) })} aria-label="Interest percentage" />
            </div>
          )}
        </>
      )}
      <label className="full-label" style={{ marginTop: 0 }}>Call remark<textarea value={lead.callRemark} maxLength={500} onChange={(e) => set({ ...lead, callRemark: e.target.value })} placeholder="What did the caller say?" /></label>
    </div>
  )
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const g = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }

/** What the "visited" step needs to turn a call into an enquiry. */
type Visit = Pick<CallRow, 'id' | 'name' | 'departmentId'>

export function CallsPanel({ rows, total, summary, catalogs, branches, canCreate, canEdit, canDelete, canPromote, needsBranch, notify }: {
  rows: CallRow[]; total: number; summary: Summaries['calls']; catalogs: Catalogs; branches: { id: string; code: string; name: string }[]
  canCreate: boolean; canEdit: boolean; canDelete: boolean; canPromote: boolean; needsBranch: boolean; notify: (m: string) => void
}) {
  const showBranch = branches.length > 0 // head office: calls of every branch
  const list = usePagedList({ rows, total }, queryCallsAction)
  const [adding, setAdding] = useState(false)
  const [promoting, setPromoting] = useState<Visit | null>(null)
  const [viewing, setViewing] = useState<CallRow | null>(null)
  const [editing, setEditing] = useState<CallRow | null>(null)
  const [following, setFollowing] = useState<CallRow | null>(null)
  const [deleting, setDeleting] = useState<CallRow | null>(null)
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Admissions / Calls</p><h1>Random calls</h1><p className="subheading">Log every call and its follow-ups. Open View to add a follow-up or mark the visit.</p></div>
        <div className="heading-actions">{canCreate && <AddButton needsBranch={needsBranch} branches={catalogs.branches} onGo={() => setAdding(true)}><Plus size={17} /> Log call</AddButton>}</div>
      </div>
      <div className="table-summary">
        <div><strong>{summary.total.toLocaleString('en-IN')}</strong><span>Calls logged</span></div>
        <div><strong className="text-green">{summary.converted}</strong><span>Visited (now enquiries)</span></div>
        <div><strong className="text-amber">{summary.total - summary.converted}</strong><span>Not visited yet</span></div>
      </div>
      <div className="panel table-panel">
        <ListToolbar list={list} exportList={'calls'} placeholder="Search name, phone, status or remarks…" dateLabel="Call date"
          filters={[
            ...(showBranch ? [{ key: 'branch', label: 'Branch', options: opts(branches, (b) => b.id, (b) => `${b.code} — ${b.name}`) }] : []),
            { key: 'converted', label: 'Visit', options: [{ value: 'no', label: 'Not visited yet' }, { value: 'yes', label: 'Visited (enquiry)' }] },
            { key: 'dept', label: 'Department', options: opts(catalogs.departments, (d) => d.id, (d) => d.name) },
            { key: 'course', label: 'Course', options: opts(catalogs.courses.filter((c) => !list.filter('dept') || c.departmentId === list.filter('dept')), (c) => c.id, (c) => c.title) },
            { key: 'status', label: 'Status', options: CALL_STATUSES.map((s) => ({ value: s, label: s })) },
            { key: 'interest', label: 'Interest', options: [{ value: 'yes', label: 'Interested' }, { value: 'no', label: 'Not interested' }, { value: 'unset', label: 'Not asked yet' }] },
            { key: 'category', label: 'Category', options: opts(catalogs.leadCategories, (o) => o.id, (o) => o.value) },
            { key: 'follow', label: 'Next follow-up', options: FOLLOW },
            { key: 'mine', label: 'Taken by', options: [{ value: 'yes', label: 'Taken by me' }, { value: 'assigned', label: 'Given to me to follow up' }] },
          ]}
          sorts={[
            { key: 'date', label: 'Newest first', dir: 'desc' }, { key: 'date', label: 'Oldest first', dir: 'asc' },
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'followup', label: 'Follow-up soonest', dir: 'asc' },
            { key: 'fee', label: 'Proposed fee, highest', dir: 'desc' }, { key: 'interest', label: 'Most interested', dir: 'desc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><th>S.No.</th>{showBranch && <th>Branch</th>}<SortTh list={list} k="date" first="desc">Date</SortTh><SortTh list={list} k="name">Caller</SortTh><th>Interested in</th><th>Status</th><SortTh list={list} k="interest" first="desc">Interest / category</SortTh><SortTh list={list} k="followup">Next follow-up</SortTh><th>Taken by</th><th>Actions</th></tr></thead>
            <tbody>
              {list.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>{list.page * PAGE_SIZE + i + 1}</td>
                  {showBranch && <td title={r.branchName ?? ''}><strong className="id-text">{r.branchCode ?? '—'}</strong></td>}
                  <td>{fmt(r.calledAt)}</td>
                  <td><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.phone}</span></div></td>
                  <td>{r.course ?? r.department ?? '—'}{r.proposedFee ? <small>₹{(r.proposedFee / 100).toLocaleString('en-IN')} proposed</small> : null}</td>
                  <td>{r.enquiryId ? <span className="status-badge status-green"><span className="status-dot" />Visited · enquiry</span> : r.status ?? '—'}{r.expectedVisitDate && <small>Visit on {fmt(r.expectedVisitDate)}</small>}{r.deadReason && <small className="lead-remark" title={r.deadReason}>{r.deadReason}</small>}{r.remarks ? <small>{r.remarks}</small> : null}</td>
                  <td><Interest r={r} />{r.category && <small><strong>{r.category}</strong></small>}{r.callRemark && <small className="lead-remark" title={r.callRemark}>{r.callRemark}</small>}</td>
                  <td>{fmt(r.followUpDate)}{r.followUps > 0 && <small>{r.followUps} follow-up{r.followUps > 1 ? 's' : ''} done</small>}</td>
                  <td>{r.receivedBy ?? '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="filter-button icon-only" onClick={() => setViewing(r)} title="View" aria-label={`View call of ${r.name}`}><Eye size={15} /></button>
                      {canEdit && <button className="filter-button icon-only" onClick={() => setEditing(r)} title="Edit" aria-label={`Edit call of ${r.name}`}><Pencil size={15} /></button>}
                      {canDelete && !r.enquiryId && <button className="filter-button icon-only danger" onClick={() => setDeleting(r)} title="Delete" aria-label={`Delete call of ${r.name}`}><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={showBranch ? 10 : 9} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No calls match these filters.' : 'No calls logged yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="calls" />
      </div>
      {adding && <CallForm catalogs={catalogs} onClose={() => setAdding(false)} onDone={(m, visit) => { setAdding(false); notify(m); if (visit && canPromote) setPromoting(visit) }} />}
      {viewing && <CallView row={viewing} canEdit={canEdit} canPromote={canPromote} onEdit={() => { setEditing(viewing); setViewing(null) }}
        onFollowUp={() => { setFollowing(viewing); setViewing(null) }} onVisited={() => { setPromoting(viewing); setViewing(null) }} onClose={() => setViewing(null)} />}
      {deleting && <ConfirmDelete title={`Delete call — ${deleting.name}`} text={`The call of ${deleting.name} (${deleting.phone}) and its follow-ups will be removed from every list and report.`} onClose={() => setDeleting(null)}
        onConfirm={async () => { const res = await deleteCallAction(deleting.id); if (!res.ok) return res.error; setDeleting(null); notify('Call deleted') }} />}
      {editing && <CallEdit row={editing} catalogs={catalogs} onClose={() => setEditing(null)} onDone={(m, visit) => { setEditing(null); notify(m); if (visit && canPromote) setPromoting(visit) }} />}
      {following && <FollowUpForm row={following} categories={catalogs.leadCategories} onClose={() => setFollowing(null)} onDone={(m, visit) => { setFollowing(null); notify(m); if (visit && canPromote) setPromoting(visit) }} />}
      {promoting && <PromoteForm row={promoting} catalogs={catalogs} onClose={() => setPromoting(null)} onDone={(m) => { setPromoting(null); notify(m) }} />}
    </section>
  )
}

function CallForm({ catalogs, onClose, onDone }: { catalogs: Catalogs; onClose: () => void; onDone: (m: string, visit?: Visit) => void }) {
  const [deptId, setDeptId] = useState('')
  const [lead, setLead] = useState<Lead>(NEW_LEAD)
  const [followUp, setFollowUp] = useState('')
  const [phone, setPhone] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const fee = g(fd, 'fee')
    start(async () => {
      const res = await logCallAction({
        person: { firstName: g(fd, 'firstName') ?? '', lastName: g(fd, 'lastName'), phone: g(fd, 'phone') ?? '', altPhone: g(fd, 'altPhone') },
        qualification: g(fd, 'qualification'), collegeName: g(fd, 'college'),
        departmentId: deptId || null, courseId: g(fd, 'courseId'), proposedFee: fee ? Math.round(Number(fee) * 100) : null,
        ...leadPayload(lead), remarks: g(fd, 'remarks'), followUpDate: followUp || null,
      })
      if (!res.ok) return setError(res.error)
      // Saved as "Visited": go straight on to making the enquiry.
      onDone('Call logged', lead.status === 'Visited' ? { id: res.data!, name: `${g(fd, 'firstName') ?? ''} ${g(fd, 'lastName') ?? ''}`.trim(), departmentId: deptId || null } : undefined)
    })
  }
  return (
    <Modal title="Log random call" onClose={onClose}>
      <form ref={formRef} onSubmit={submit}>
        <div className="form-grid">
          <p className="form-legend">Caller</p>
          <label>First name<span className="required-mark">*</span><input name="firstName" required autoFocus placeholder="e.g. Aman" /></label>
          <label>Last name<input name="lastName" placeholder="Optional" /></label>
          <label>Contact no.<span className="required-mark">*</span><input name="phone" type="tel" required placeholder="10-digit mobile" onChange={(e) => setPhone(e.target.value)} /></label>
          <label>Alternate no.<input name="altPhone" type="tel" placeholder="Optional" /></label>
          <BranchMatches phone={phone} onUse={(m) => fillForm(formRef.current, { firstName: m.firstName, lastName: m.lastName, altPhone: m.altPhone })} />
          <label>Qualification<input name="qualification" placeholder="e.g. B.Tech, 12th" /></label>
          <label>College / school name<input name="college" placeholder="Optional" /></label>
          <p className="form-legend">Interested in</p>
          <label>Department<select value={deptId} onChange={(e) => setDeptId(e.target.value)}><option value="">Select department</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Course<select name="courseId" defaultValue=""><option value="">Select course</option>{catalogs.courses.filter((c) => !deptId || c.departmentId === deptId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Proposed fee (₹)<input name="fee" type="number" min="0" placeholder="0" /></label>
          <p className="form-legend">Call outcome</p>
          <LeadGrid lead={lead} set={setLead} categories={catalogs.leadCategories} />
          {!isDead(lead) && <QuickDate label="Next follow-up date" value={followUp} onChange={setFollowUp} picks={[0, 1, 3, 7]} />}
        </div>
        <LeadRest lead={lead} set={setLead} />
        <label className="full-label">Your remark<textarea name="remarks" placeholder="Your own note about this call" /></label>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save call'}</button></div>
      </form>
    </Modal>
  )
}

type FollowUp = {
  id: string; calledAt: string; by: string | null; status: string | null; callRemark: string | null; remarks: string | null
  interested: boolean | null; interestPct: number | null; nextFollowUp: string | null; expectedVisitDate: string | null; deadReason: string | null
}

function CallView({ row, canEdit, canPromote, onEdit, onFollowUp, onVisited, onClose }: { row: CallRow; canEdit: boolean; canPromote: boolean; onEdit: () => void; onFollowUp: () => void; onVisited: () => void; onClose: () => void }) {
  const [history, setHistory] = useState<FollowUp[] | null>(row.followUps ? null : [])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!row.followUps) return
    let live = true
    callFollowUpsAction(row.id).then((res) => { if (!live) return; if (res.ok) setHistory(res.data ?? []); else setError(res.error) })
    return () => { live = false }
  }, [row.id, row.followUps])
  const items: [string, React.ReactNode][] = [
    ['Caller', row.name ?? '—'], ['Contact no.', row.phone ?? '—'], ['Alternate no.', row.altPhone ?? '—'],
    ['Branch', row.branchCode ? `${row.branchCode} — ${row.branchName}` : '—'], ['Call date', fmt(row.calledAt)], ['Taken by', row.receivedBy ?? '—'],
    ['Department', row.department ?? '—'], ['Course', row.course ?? '—'], ['Proposed fee', row.proposedFee ? `₹${(row.proposedFee / 100).toLocaleString('en-IN')}` : '—'],
    ['Status', row.status ?? '—'], ['Interest', <Interest key="i" r={row} />], ['Next follow-up', fmt(row.followUpDate)],
    ...(row.expectedVisitDate ? [['Expected visit', fmt(row.expectedVisitDate)] as [string, React.ReactNode]] : []),
    ['Lead category', row.category ?? '—'], ['Visited', row.enquiryId ? 'Yes — now an enquiry' : 'Not visited yet'],
  ]
  return (
    <Modal title="Call details" onClose={onClose}>
      <dl className="detail-list">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {row.deadReason && <div className="detail-note"><span>Why the lead is dead</span>{row.deadReason}</div>}
      <div className="detail-note"><span>Call remark</span>{row.callRemark ?? '—'}</div>
      <div className="detail-note"><span>Your remark</span>{row.remarks ?? '—'}</div>
      {row.followUps > 0 && (
        <>
          <p className="eyebrow" style={{ margin: '18px 0 0' }}>Follow-up calls ({row.followUps})</p>
          {!history && !error && <p className="section-hint" style={{ margin: '8px 0 0' }}>Loading…</p>}
          {history?.map((f) => (
            <div className="detail-note" key={f.id} style={{ marginTop: 8 }}>
              <span>{fmtDateTime(f.calledAt)}{f.by ? ` · ${f.by}` : ''} · {f.status ?? '—'}{f.interested ? ` · ${f.interestPct ?? 0}% interested` : f.interested === false ? ' · not interested' : ''}</span>
              {[f.callRemark && `Caller: ${f.callRemark}`, f.remarks && `Remark: ${f.remarks}`, f.expectedVisitDate && `Expected visit: ${fmt(f.expectedVisitDate)}`, f.deadReason && `Dead: ${f.deadReason}`, f.nextFollowUp && `Next follow-up: ${fmt(f.nextFollowUp)}`].filter(Boolean).join('\n') || '—'}
            </div>
          ))}
          <Err msg={error} />
        </>
      )}
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>Close</button>
        {canEdit && <button type="button" className="button secondary" onClick={onEdit}><Pencil size={14} /> Edit</button>}
        {canPromote && !row.enquiryId && <button type="button" className="button secondary" title="The person came to the branch: make this call an enquiry" onClick={onVisited}>Mark visited</button>}
        {canEdit && !row.enquiryId && <button type="button" className="button primary" onClick={onFollowUp}><PhoneCall size={14} /> Add follow-up</button>}
      </div>
    </Modal>
  )
}

/** A follow-up call: what was said this time and when to call next. The call row then shows this latest state. */
function FollowUpForm({ row, categories, onClose, onDone }: { row: CallRow; categories: { id: string; value: string }[]; onClose: () => void; onDone: (m: string, visit?: Visit) => void }) {
  const [lead, setLead] = useState<Lead>({ ...leadOf(row), callRemark: '' })
  const [calledAt, setCalledAt] = useState(localInput(new Date()))
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const needsNext = !isDead(lead) && lead.status !== 'Visited'
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const res = await followUpCallAction({
        callId: row.id, calledAt: calledAt ? new Date(calledAt).toISOString() : null, ...leadPayload(lead), status: lead.status.trim(),
        remarks: g(fd, 'remarks'), nextFollowUp: needsNext ? next || null : null,
      })
      if (!res.ok) return setError(res.error)
      onDone('Follow-up saved', lead.status === 'Visited' ? { id: row.id, name: row.name, departmentId: row.departmentId } : undefined)
    })
  }
  return (
    <Modal title={`Follow-up call — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="section-hint" style={{ margin: '0 0 14px' }}>{row.name} · {row.phone} · first called {fmt(row.calledAt)}{row.followUps ? ` · ${row.followUps} follow-up${row.followUps > 1 ? 's' : ''} so far` : ''}</p>
        <div className="form-grid">
          <QuickDate label="When did you call?" time value={calledAt} onChange={setCalledAt} picks={[-1, 0]} max={localInput(new Date())} />
          <LeadGrid lead={lead} set={setLead} required categories={categories} />
          {needsNext && <QuickDate label="Next follow-up date" required value={next} onChange={setNext} picks={[0, 1, 3, 7]} />}
        </div>
        <LeadRest lead={lead} set={setLead} />
        <label className="full-label">Your remark<textarea name="remarks" placeholder="Your own note about this call" /></label>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save follow-up'}</button></div>
      </form>
    </Modal>
  )
}

function CallEdit({ row, catalogs, onClose, onDone }: { row: CallRow; catalogs: Catalogs; onClose: () => void; onDone: (m: string, visit?: Visit) => void }) {
  const [deptId, setDeptId] = useState(row.departmentId ?? '')
  const [lead, setLead] = useState<Lead>(leadOf(row))
  const [followUp, setFollowUp] = useState(row.followUpDate ?? '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const fee = g(fd, 'fee')
    start(async () => {
      const res = await updateCallAction({
        id: row.id, departmentId: deptId || null, courseId: g(fd, 'courseId'), proposedFee: fee ? Math.round(Number(fee) * 100) : null,
        ...leadPayload(lead), remarks: g(fd, 'remarks'), followUpDate: followUp || null,
      })
      if (!res.ok) return setError(res.error)
      onDone('Call updated', lead.status === 'Visited' && !row.enquiryId ? { id: row.id, name: row.name, departmentId: deptId || null } : undefined)
    })
  }
  return (
    <Modal title={`Edit call — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="section-hint" style={{ margin: '0 0 14px' }}>{row.name} · {row.phone} · called {fmt(row.calledAt)}</p>
        <div className="form-grid">
          <label>Department<select value={deptId} onChange={(e) => setDeptId(e.target.value)}><option value="">—</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Course<select name="courseId" defaultValue={row.courseId ?? ''}><option value="">—</option>{catalogs.courses.filter((c) => !deptId || c.departmentId === deptId).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Proposed fee (₹)<input name="fee" type="number" min="0" defaultValue={row.proposedFee ? row.proposedFee / 100 : ''} /></label>
          <LeadGrid lead={lead} set={setLead} categories={catalogs.leadCategories} />
          {!isDead(lead) && <QuickDate label="Next follow-up date" value={followUp} onChange={setFollowUp} picks={[0, 1, 3, 7]} />}
        </div>
        <LeadRest lead={lead} set={setLead} />
        <label className="full-label">Your remark<textarea name="remarks" defaultValue={row.remarks ?? ''} /></label>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </Modal>
  )
}

function PromoteForm({ row, catalogs, onClose, onDone }: { row: Visit; catalogs: Catalogs; onClose: () => void; onDone: (m: string) => void }) {
  const [deptId, setDeptId] = useState(row.departmentId ?? '')
  const [modeId, setModeId] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await promoteCallAction(row.id, deptId || null, modeId || null)
      if (!res.ok) return setError(res.error)
      onDone(`Enquiry ${res.data} created`)
    })
  }
  return (
    <Modal title={`Visited — make enquiry: ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="section-hint" style={{ margin: '-8px 0 14px' }}>The person came to the branch, so this call becomes a visited enquiry.</p>
        <div className="form-grid">
          <label>Department<span className="required-mark">*</span><select value={deptId} onChange={(e) => setDeptId(e.target.value)} required><option value="" disabled>Select department</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Mode of classes<select value={modeId} onChange={(e) => setModeId(e.target.value)}><option value="">—</option>{catalogs.classModes.map((m) => <option key={m.id} value={m.id}>{m.value}</option>)}</select></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Creating…' : 'Create enquiry'}</button></div>
      </form>
    </Modal>
  )
}
