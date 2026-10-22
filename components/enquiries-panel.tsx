'use client'

import { AddButton } from '@/components/branch-gate'
import { useEffect, useRef, useState, useTransition } from 'react'
import { BranchMatches, fillForm } from '@/components/branch-matches'
import Link from 'next/link'
import { Eye, Globe, MapPin, Pencil, PhoneCall, Plus, Trash2, X } from 'lucide-react'
import { createEnquiryAction, visitSummaryAction, deleteLeadAction, enquiryTimelineAction, followUpLeadAction, queryAllEnquiriesAction, queryEnquiriesAction, queryLeadsAction, queryMyLeadsAction, transitionEnquiryAction, updateLeadAction } from '@/app/actions'
import { FOLLOW, ListToolbar, opts, SortTh } from '@/components/list-toolbar'
import { ConfirmDelete, Modal, QuickDate } from '@/components/modal'
import { Pager } from '@/components/pager'
import { usePagedList } from '@/components/use-paged-list'
import type { Summaries } from '@/modules/reports/service'
import { STATUS_LABEL, TRANSITIONS, type EnquiryStatus } from '@/modules/enquiries/status'
import type { Catalogs } from '@/modules/catalog/service'
import type { VisitSummary } from '@/modules/enquiries/service'
import { DateInput } from '@/components/date-input'

export type EnquiryRow = {
  id: string
  enquiryNo: string
  status: EnquiryStatus
  createdAt: string
  nextFollowUp: string | null
  name: string
  phone: string
  firstName?: string
  lastName?: string | null
  altPhone?: string | null
  courseId?: string | null
  departmentId?: string | null
  sourceId?: string | null
  classModeId?: string | null
  course: string | null
  department: string | null
  source: string | null
  sourceUrl?: string | null // a website lead: the page its form was on
  staff: string | null
  fee: number | null // paise: agreed fee, else the proposed fee
  courseFee: number | null // paise: the course's actual (full) fee
  proposedFee: number | null // paise: the discounted / proposed fee
  // Lead details
  visited: boolean // came to the branch
  interested: boolean | null // null = not asked yet
  interestPct: number | null
  callDone: boolean
  callAt: string | null // when the call was made
  callRemark: string | null
  location: string | null
  interestedBranchId: string | null
  interestedBranch: string | null // branch code
  categoryId: string | null
  category: string | null // lead category
  registeredAt: string | null // when the admission was made (null = not registered)
  regNo: string | null
}

/** The lead details as the form holds them. */
type Lead = { visited: boolean; interested: boolean | null; interestPct: number; callDone: boolean; callAt: string; callRemark: string; location: string; interestedBranchId: string; categoryId: string }
const NEW_LEAD: Lead = { visited: false, interested: null, interestPct: 50, callDone: false, callAt: '', callRemark: '', location: '', interestedBranchId: '', categoryId: '' }
const leadPayload = (l: Lead) => ({
  visited: l.visited,
  interested: l.interested, interestPct: l.interested ? l.interestPct : null, callDone: l.callDone,
  callAt: l.callDone && l.callAt ? new Date(l.callAt).toISOString() : null,
  callRemark: l.callRemark.trim() || null, location: l.location.trim() || null, interestedBranchId: l.interestedBranchId || null, categoryId: l.categoryId || null,
})
/** Hot / warm / cold, from the percentage. */
export const heat = (pct: number) => (pct >= 70 ? ['Hot', 'status-green'] : pct >= 40 ? ['Warm', 'status-amber'] : ['Cold', 'status-slate'])

export function Interest({ r }: { r: Pick<EnquiryRow, 'interested' | 'interestPct'> }) {
  if (r.interested === null) return <span className="status-badge status-slate">Not asked</span>
  if (!r.interested) return <span className="status-badge status-red"><span className="status-dot" />Not interested</span>
  const pct = r.interestPct ?? 0
  const [word, style] = heat(pct)
  return <span className={`status-badge ${style}`} title={`${word} lead`}><span className="status-dot" />{pct}% · {word}</span>
}

const STATUS_STYLE: Record<EnquiryStatus, string> = {
  new: 'status-blue', contacted: 'status-slate', follow_up: 'status-amber', demo: 'status-violet',
  joined: 'status-green', not_joined: 'status-red', dead: 'status-slate',
}

function Badge({ status }: { status: EnquiryStatus }) {
  return <span className={`status-badge ${STATUS_STYLE[status]}`}><span className="status-dot" />{STATUS_LABEL[status]}</span>
}

/** Value for a date-and-time input, in the viewer's own time zone. */
export const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
export const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const money = (paise: number | null) => (paise ? `₹${(paise / 100).toLocaleString('en-IN')}` : '—')
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const val = (fd: FormData, k: string) => {
  const v = fd.get(k)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export function EnquiriesPanel({
  rows, total, summary, visits, catalogs, canCreate, canUpdate, canDelete = false, needsBranch, mode, notify,
}: {
  rows: EnquiryRow[]
  total: number
  summary: Summaries['enquiries']
  visits?: VisitSummary // Visited enquiries screen: the numbers for all time (the screen re-counts for a chosen period)
  catalogs: Catalogs
  canCreate: boolean
  canUpdate: boolean
  canDelete?: boolean // leads only: a lead that has not visited can be deleted
  needsBranch: boolean
  /** list = visited enquiries · leads = not visited yet (web, e-mail, other) · update = search any by phone · mine = assigned to me */
  mode: 'list' | 'leads' | 'update' | 'mine'
  notify: (m: string) => void
}) {
  const list = usePagedList({ rows, total }, mode === 'mine' ? queryMyLeadsAction : mode === 'leads' ? queryLeadsAction : mode === 'update' ? queryAllEnquiriesAction : queryEnquiriesAction)
  const [pending, start] = useTransition()
  // Visited enquiries: the headline numbers follow the chosen visit dates. A visit counts in the period it happened,
  // a registration in the period it was made (even when the person visited earlier).
  const [period, setPeriod] = useState<VisitSummary | null>(null)
  const from = list.query.from, to = list.query.to
  useEffect(() => {
    if (mode !== 'list') return
    if (!from && !to) { setPeriod(null); return }
    let live = true
    visitSummaryAction(from, to).then((r) => { if (live && r.ok && r.data) setPeriod(r.data) })
    return () => { live = false }
  }, [mode, from, to, rows])
  const v = period ?? visits
  // The lead came to the office: it becomes a visited enquiry and moves to the Enquiries screen.
  const markVisited = (r: EnquiryRow) => start(async () => {
    const res = await updateLeadAction({ enquiryId: r.id, lead: { visited: true, interested: r.interested, interestPct: r.interestPct, callDone: r.callDone, callAt: r.callAt, callRemark: r.callRemark, location: r.location, interestedBranchId: r.interestedBranchId, categoryId: r.categoryId } })
    notify(res.ok ? `${r.name} visited: ${r.enquiryNo} is now a visited enquiry` : res.error)
  })
  const [adding, setAdding] = useState(false)
  // One Edit dialog with two tabs: the lead details, and the status.
  const [edit, setEdit] = useState<{ row: EnquiryRow; tab: 'details' | 'status' } | null>(null)
  const [viewing, setViewing] = useState<EnquiryRow | null>(null)
  const [following, setFollowing] = useState<EnquiryRow | null>(null)
  const [deleting, setDeleting] = useState<EnquiryRow | null>(null)

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{mode === 'leads' ? 'Admissions / Leads' : `Admissions / ${mode === 'update' ? 'Find an enquiry' : mode === 'mine' ? 'My leads' : 'Enquiries'}`}</p>
          <h1>{mode === 'update' ? 'Enquiry update' : mode === 'mine' ? 'My leads' : mode === 'leads' ? 'Leads' : 'Visited enquiries'}</h1>
          <p className="subheading">{mode === 'update' ? 'Search by phone number, then update the status.' : mode === 'mine' ? 'Leads assigned to you (any branch). Call, then record the outcome.' : mode === 'leads' ? 'People who reached you through the website, e-mail or another source and have not visited yet. Open View to add a follow-up or mark the visit.' : 'People who came to the office. Open View to see every follow-up and add the next one until they register.'}</p>
        </div>
        <div className="heading-actions">
          {canCreate && (
            <AddButton needsBranch={needsBranch} branches={catalogs.branches} onGo={() => setAdding(true)}><Plus size={17} /> {mode === 'leads' ? 'Add lead' : 'Add visited enquiry'}</AddButton>
          )}
        </div>
      </div>


      {mode === 'list' && v && (
        <>
          <div className="table-summary">
            <div><strong>{v.visited.toLocaleString('en-IN')}</strong><span>Visited</span></div>
            <div><strong className="text-green">{v.registered.toLocaleString('en-IN')}</strong><span>Registered{v.registeredFromEarlier ? ` (${v.registeredFromEarlier} from earlier visits)` : ''}</span></div>
            <div><strong className="text-amber">{v.notRegistered.toLocaleString('en-IN')}</strong><span>Visited, not registered</span></div>
            <div><strong className="text-blue">{summary.followUp}</strong><span>In follow-up now</span></div>
          </div>
          <p className="section-hint" style={{ margin: '-4px 0 14px' }}>
            {from || to ? `Period: ${from ? fmtDate(from) : 'start'} – ${to ? fmtDate(to) : 'today'}.` : 'All time.'} A visit is counted in the month of the visit; a registration is counted in the month it was made, even if the person visited earlier. Registered rows are shown in green.
          </p>
        </>
      )}
      <div className="table-summary" style={mode === 'leads' || mode === 'list' ? { display: 'none' } : undefined}>
        <div><strong>{summary.total.toLocaleString('en-IN')}</strong><span>Total enquiries</span></div>
        <div><strong className="text-blue">{summary.new}</strong><span>New</span></div>
        <div><strong className="text-amber">{summary.followUp}</strong><span>Follow-ups</span></div>
        <div><strong className="text-green">{summary.joined}</strong><span>Joined</span></div>
      </div>

      <div className="panel table-panel">
        <ListToolbar list={list} exportList={mode === 'mine' ? 'my-leads' : mode === 'leads' ? 'leads' : mode === 'update' ? 'enquiry-update' : 'enquiries'} placeholder={mode === 'update' ? 'Search by phone no.…' : 'Search name, phone or enquiry no.…'} autoFocus={mode === 'update'} dateLabel={mode === 'list' ? 'Visit date' : 'Enquiry date'}
          filters={[
            { key: 'status', label: 'Status', options: (Object.keys(STATUS_LABEL) as EnquiryStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] })) },
            { key: 'follow', label: 'Follow-up', options: FOLLOW },
            { key: 'dept', label: 'Department', options: opts(catalogs.departments, (d) => d.id, (d) => d.name) },
            { key: 'course', label: 'Course', options: opts(catalogs.courses.filter((c) => !list.filter('dept') || c.departmentId === list.filter('dept')), (c) => c.id, (c) => c.title) },
            { key: 'source', label: 'Source', options: opts(catalogs.sources, (o) => o.id, (o) => o.value) },
            { key: 'mode', label: 'Mode', options: opts(catalogs.classModes, (o) => o.id, (o) => o.value) },
            { key: 'interest', label: 'Interest', options: [{ value: 'yes', label: 'Interested' }, { value: 'no', label: 'Not interested' }, { value: 'unset', label: 'Not asked yet' }] },
            ...(mode === 'mine' || mode === 'update' ? [{ key: 'visited', label: 'Visit', options: [{ value: 'yes', label: 'Visited' }, { value: 'no', label: 'Not visited yet' }] }] : []),
            { key: 'category', label: 'Category', options: opts(catalogs.leadCategories, (o) => o.id, (o) => o.value) },
            { key: 'call', label: 'Call', options: [{ value: 'pending', label: 'Call pending' }, { value: 'done', label: 'Call done' }] },
            { key: 'wants', label: 'Wants branch', options: opts(catalogs.branches, (b) => b.id, (b) => `${b.code} — ${b.name}`) },
            ...(mode === 'mine' ? [] : [{ key: 'assigned', label: 'Assigned', options: [{ value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Unassigned' }] }]),
          ]}
          sorts={[
            { key: 'created', label: 'Newest first', dir: 'desc' }, { key: 'created', label: 'Oldest first', dir: 'asc' },
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'followup', label: 'Follow-up soonest', dir: 'asc' },
            { key: 'status', label: 'Status', dir: 'asc' }, { key: 'fee', label: 'Fee, highest', dir: 'desc' },
            { key: 'interest', label: 'Most interested', dir: 'desc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr><SortTh list={list} k="created" first="desc">Enquiry no.</SortTh><SortTh list={list} k="name">Student</SortTh><th>Course</th><th>Source</th><SortTh list={list} k="interest" first="desc">Interest / category</SortTh><th>Call</th><th>Assigned</th><SortTh list={list} k="status">Status</SortTh><SortTh list={list} k="followup">Next follow-up</SortTh><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} className={r.registeredAt ? 'row-registered' : undefined}>
                  <td>{mode === 'update'
                    ? <><strong className="id-text">{r.enquiryNo}</strong>{r.regNo && <small className="text-green" title="Student ID">{r.regNo}</small>}</>
                    : <strong className="id-text" title={r.enquiryNo}>{r.enquiryNo.slice(-4)}</strong>}<small>{fmtDateTime(r.createdAt)}</small></td>
                  <td><div><Link href={`/lead-cycle/${r.id}`} className="lead-name-link" title="Open the lead cycle: everything that happened, start to end"><strong>{r.name}</strong></Link><span style={{ display: 'block' }}>{r.phone}</span>{r.location && <small className="lead-loc"><MapPin size={11} /> {r.location}</small>}</div></td>
                  <td>{r.course ?? r.department ?? '—'}</td>
                  <td>{r.source ?? '—'}{r.sourceUrl && <SiteChip url={r.sourceUrl} />}</td>
                  <td><Interest r={r} />{r.category && <small><strong>{r.category}</strong></small>}{r.interestedBranch && <small>Wants {r.interestedBranch}</small>}</td>
                  <td><span className={`status-badge ${r.callDone ? 'status-green' : 'status-amber'}`}><PhoneCall size={11} /> {r.callDone ? 'Done' : 'Pending'}</span>{r.callAt && <small>{fmtDateTime(r.callAt)}</small>}{r.callRemark && <small className="lead-remark" title={r.callRemark}>{r.callRemark}</small>}</td>
                  <td>{r.staff ?? '—'}</td>
                  <td><Badge status={r.status} />{r.registeredAt && <small className="text-green" title={r.regNo ?? ''}>Registered {fmtDate(r.registeredAt)}</small>}{(mode === 'mine' || mode === 'update') && <small className={r.visited ? 'text-green' : ''}>{r.visited ? 'Visited' : 'Not visited yet'}</small>}</td>
                  <td>{fmtDate(r.nextFollowUp)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="filter-button icon-only" onClick={() => setViewing(r)} title="View" aria-label={`View ${r.name}`}><Eye size={15} /></button>
                      {canUpdate && <button className="filter-button icon-only" onClick={() => setEdit({ row: r, tab: mode === 'update' && TRANSITIONS[r.status].length ? 'status' : 'details' })} title="Edit" aria-label={`Edit ${r.name}`}><Pencil size={15} /></button>}
                      {mode === 'leads' && canDelete && <button className="filter-button icon-only danger" onClick={() => setDeleting(r)} title="Delete" aria-label={`Delete lead ${r.name}`}><Trash2 size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'Nothing matches these filters.' : mode === 'leads' ? 'No leads yet.' : 'No enquiries yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="enquiries" />
      </div>

      {adding && <EnquiryForm asLead={mode === 'leads'} catalogs={catalogs} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); notify(m) }} />}
      {viewing && <LeadView row={viewing} canUpdate={canUpdate} onClose={() => setViewing(null)}
        onEdit={() => { setEdit({ row: viewing, tab: 'details' }); setViewing(null) }} onFollowUp={() => { setFollowing(viewing); setViewing(null) }}
        onStatus={() => { setEdit({ row: viewing, tab: 'status' }); setViewing(null) }} onVisited={() => { markVisited(viewing); setViewing(null) }} />}
      {following && <LeadFollowUpForm row={following} onClose={() => setFollowing(null)} onDone={(m) => { setFollowing(null); notify(m) }} />}
      {deleting && <ConfirmDelete title={`Delete lead — ${deleting.enquiryNo}`} text={`${deleting.name} (${deleting.phone}) will be removed from every list and report.`} onClose={() => setDeleting(null)}
        onConfirm={async () => { const res = await deleteLeadAction(deleting.id); if (!res.ok) return res.error; setDeleting(null); notify(`Lead ${deleting.enquiryNo} deleted`) }} />}
      {edit && (() => {
        const canStatus = TRANSITIONS[edit.row.status].length > 0
        const tabs = canStatus && (
          <div className="seg" style={{ marginBottom: 16 }}>
            <button type="button" className={edit.tab === 'details' ? 'on' : ''} aria-pressed={edit.tab === 'details'} onClick={() => setEdit({ ...edit, tab: 'details' })}>Lead details</button>
            <button type="button" className={edit.tab === 'status' ? 'on' : ''} aria-pressed={edit.tab === 'status'} onClick={() => setEdit({ ...edit, tab: 'status' })}>Status</button>
          </div>
        )
        const done = (m: string) => { setEdit(null); notify(m) }
        return edit.tab === 'status' && canStatus
          ? <TransitionForm row={edit.row} catalogs={catalogs} tabs={tabs} onClose={() => setEdit(null)} onDone={done} />
          : <LeadForm row={edit.row} catalogs={catalogs} tabs={tabs} onClose={() => setEdit(null)} onDone={done} />
      })()}
    </section>
  )
}


/** The lead questions, asked the same way when a lead is added and when it is updated after a call. */
function LeadFields({ lead, set, catalogs }: { lead: Lead; set: (l: Lead) => void; catalogs: Catalogs }) {
  const choice = (label: string, on: boolean, pick: () => void) => <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={pick}>{label}</button>
  return (
    <div className="lead-fields">
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
      <div className="lead-q">
        <span>Call done?</span>
        <div className="seg">{choice('Yes', lead.callDone, () => set({ ...lead, callDone: true, callAt: lead.callAt || localInput(new Date()) }))}{choice('No', !lead.callDone, () => set({ ...lead, callDone: false }))}</div>
      </div>
      {lead.callDone && (
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label>Call date &amp; time<DateInput type="datetime-local" value={lead.callAt} max={localInput(new Date())} onChange={(e) => set({ ...lead, callAt: e.target.value })} /></label>
        </div>
      )}
      <div className="form-grid">
        <label>Enquiry location<input value={lead.location} maxLength={200} onChange={(e) => set({ ...lead, location: e.target.value })} placeholder="Area / city the person is from" /></label>
        <label>Interested in which branch
          <select value={lead.interestedBranchId} onChange={(e) => set({ ...lead, interestedBranchId: e.target.value })}><option value="">Not decided</option>{catalogs.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select>
        </label>
        <label>Lead category
          <select value={lead.categoryId} onChange={(e) => set({ ...lead, categoryId: e.target.value })}><option value="">{catalogs.leadCategories.length ? '—' : 'No categories yet (add under Lead Categories)'}</option>{catalogs.leadCategories.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}</select>
        </label>
      </div>
      <label className="full-label">Call remark<textarea value={lead.callRemark} maxLength={500} onChange={(e) => set({ ...lead, callRemark: e.target.value })} placeholder="What did the person say on the call?" /></label>
    </div>
  )
}

/** Edit a lead: who the person is, the course and fee (a website form brings only a name and a phone), and the lead details. */
export function LeadForm({ row, catalogs, tabs, onClose, onDone }: { row: EnquiryRow; catalogs: Catalogs; tabs?: React.ReactNode; onClose: () => void; onDone: (m: string) => void }) {
  const [lead, setLead] = useState<Lead>({ visited: row.visited, interested: row.interested, interestPct: row.interestPct ?? 50, callDone: row.callDone, callAt: row.callAt ? localInput(new Date(row.callAt)) : '', callRemark: row.callRemark ?? '', location: row.location ?? '', interestedBranchId: row.interestedBranchId ?? '', categoryId: row.categoryId ?? '' })
  const rupees = (p: number | null) => (p != null ? String(p / 100) : '')
  const [b, setB] = useState({
    firstName: row.firstName ?? row.name, lastName: row.lastName ?? '', phone: row.phone, altPhone: row.altPhone ?? '',
    sourceId: row.sourceId ?? '', classModeId: row.classModeId ?? '', departmentId: row.departmentId ?? '', courseId: row.courseId ?? '',
    actual: rupees(row.courseFee), offer: rupees(row.proposedFee),
  })
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const courses = catalogs.courses.filter((c) => !b.departmentId || c.departmentId === b.departmentId)
  // Rows from screens that do not carry the person's ids: only the lead details can be edited there.
  const withBasics = row.firstName !== undefined
  function save(e: React.FormEvent) {
    e.preventDefault()
    if (b.actual && b.offer && Number(b.offer) > Number(b.actual)) return setError('The discounted fee cannot be more than the actual fee')
    start(async () => {
      const basics = withBasics ? {
        person: { firstName: b.firstName.trim(), lastName: b.lastName.trim() || null, phone: b.phone.trim(), altPhone: b.altPhone.trim() || null },
        sourceId: b.sourceId || null, classModeId: b.classModeId || null, departmentId: b.departmentId || null, courseId: b.courseId || null,
        courseFee: b.actual ? Math.round(Number(b.actual) * 100) : null, proposedFee: b.offer ? Math.round(Number(b.offer) * 100) : null,
      } : undefined
      const res = await updateLeadAction({ enquiryId: row.id, lead: leadPayload(lead), basics })
      if (!res.ok) return setError(res.error)
      onDone(`Lead saved: ${row.enquiryNo}`)
    })
  }
  const pick = (label: string, value: string, set: (v: string) => void, opts: { id: string; value: string }[]) => (
    <label>{label}<select value={value} onChange={(e) => set(e.target.value)}><option value="">—</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}</select></label>
  )
  const fromWebsite = !!row.sourceUrl || catalogs.sources.find((o) => o.id === row.sourceId)?.value === 'Website'
  return (
    <Modal title={`Edit — ${row.enquiryNo}`} onClose={onClose}>
      <form onSubmit={save}>
        <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · {row.phone} · {row.course ?? row.department ?? 'no course yet'} · <strong>{STATUS_LABEL[row.status]}</strong>{row.sourceUrl && <SiteChip url={row.sourceUrl} />}</p>
        {tabs}
        {withBasics && <>
          <div className="form-grid">
            <label>First name<span className="required-mark">*</span><input required maxLength={100} value={b.firstName} onChange={(e) => setB({ ...b, firstName: e.target.value })} /></label>
            <label>Last name<input maxLength={100} value={b.lastName} onChange={(e) => setB({ ...b, lastName: e.target.value })} placeholder="Optional" /></label>
            <label>Contact no.<span className="required-mark">*</span><input type="tel" required value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} placeholder="10-digit mobile" /></label>
            <label>Alternate no.<input type="tel" value={b.altPhone} onChange={(e) => setB({ ...b, altPhone: e.target.value })} placeholder="Optional" /></label>
            {/* a lead the website sent keeps its source: it came from the website, whatever is picked later */}
            {fromWebsite
              ? <label>{row.visited ? 'Source of enquiry' : 'Lead came from'}<select value={b.sourceId} disabled title="This lead came from the website form, so its source cannot be changed">{catalogs.sources.filter((o) => o.id === b.sourceId).map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}{!b.sourceId && <option value="">Website</option>}</select><small className="reg-note">Came from the website form — cannot be changed.</small></label>
              : pick(row.visited ? 'Source of enquiry' : 'Lead came from', b.sourceId, (v) => setB({ ...b, sourceId: v }), catalogs.sources)}
            {pick('Mode of classes', b.classModeId, (v) => setB({ ...b, classModeId: v }), catalogs.classModes)}
            <label>Department
              <select value={b.departmentId} onChange={(e) => { const d = e.target.value; setB({ ...b, departmentId: d, courseId: catalogs.courses.some((c) => c.id === b.courseId && (!d || c.departmentId === d)) ? b.courseId : '' }) }}><option value="">—</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <label>Course
              <select value={b.courseId} onChange={(e) => { const c = catalogs.courses.find((x) => x.id === e.target.value); setB({ ...b, courseId: e.target.value, departmentId: c?.departmentId ?? b.departmentId, actual: c?.baseFee ? String(c.baseFee / 100) : b.actual }) }}><option value="">{courses.length ? '—' : 'No courses defined yet'}</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
            </label>
            <label>Actual fee (₹)<input type="number" min="0" step="1" value={b.actual} onChange={(e) => setB({ ...b, actual: e.target.value })} placeholder="Full course fee" /></label>
            <label>Discounted / proposed fee (₹)<input type="number" min="0" step="1" value={b.offer} onChange={(e) => setB({ ...b, offer: e.target.value })} placeholder="Fee offered to the student" />
              {b.actual && b.offer && Number(b.actual) >= Number(b.offer) && <small style={{ color: 'var(--muted)', fontWeight: 400 }}>Discount: ₹{(Number(b.actual) - Number(b.offer)).toLocaleString('en-IN')}{Number(b.actual) > 0 ? ` (${Math.round(((Number(b.actual) - Number(b.offer)) / Number(b.actual)) * 100)}%)` : ''}</small>}
            </label>
          </div>
          <h3 className="form-section">Lead details</h3>
        </>}
        <LeadFields lead={lead} set={setLead} catalogs={catalogs} />
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save lead'}</button>
        </div>
      </form>
    </Modal>
  )
}

type TimelineRow = { id: string; at: string; by: string | null; fromStatus: EnquiryStatus | null; toStatus: EnquiryStatus; followUpDate: string | null; note: string | null }

/** Everything about one lead, its follow-up history, and what can be done next. */
function LeadView({ row, canUpdate, onClose, onEdit, onFollowUp, onStatus, onVisited }: {
  row: EnquiryRow; canUpdate: boolean; onClose: () => void; onEdit: () => void; onFollowUp: () => void; onStatus: () => void; onVisited: () => void
}) {
  const [history, setHistory] = useState<TimelineRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    enquiryTimelineAction(row.id).then((res) => { if (!live) return; if (res.ok) setHistory(res.data ?? []); else setError(res.error) })
    return () => { live = false }
  }, [row.id])
  const items: [string, React.ReactNode][] = [
    ['Name', row.name], ['Contact no.', row.phone], [row.visited ? 'Enquiry no.' : 'Lead no.', row.enquiryNo],
    ['Added on', fmtDateTime(row.createdAt)], ['Came from', row.sourceUrl ? <span key="src">{row.source ?? 'Website'}<SiteChip url={row.sourceUrl} /></span> : row.source ?? '—'], ['Assigned to', row.staff ?? '—'],
    ['Course', row.course ?? row.department ?? '—'], ['Actual fee', money(row.courseFee)], ['Discounted / proposed fee', money(row.proposedFee)],
    ['Status', <Badge key="s" status={row.status} />],
    ['Interest', <Interest key="i" r={row} />], ['Last call', row.callDone ? fmtDateTime(row.callAt) : 'Not called yet'], ['Next follow-up', fmtDate(row.nextFollowUp)],
    ['Location', row.location ?? '—'], ['Wants branch', row.interestedBranch ?? '—'], ['Visited', row.visited ? 'Yes' : 'Not visited yet'],
    ['Registered', row.registeredAt ? `${fmtDate(row.registeredAt)}${row.regNo ? ` · ${row.regNo}` : ''}` : 'Not registered'],
    ['Lead category', row.category ?? '—'],
  ]
  return (
    <Modal title={`${row.visited ? 'Visited enquiry' : 'Lead'} — ${row.name}`} onClose={onClose}>
      <dl className="detail-list">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="detail-note"><span>Call remark</span>{row.callRemark ?? '—'}</div>
      <p className="eyebrow" style={{ margin: '18px 0 0' }}>Follow-ups and history</p>
      {!history && !error && <p className="section-hint" style={{ margin: '8px 0 0' }}>Loading…</p>}
      {history?.map((h) => (
        <div className="detail-note" key={h.id} style={{ marginTop: 8 }}>
          <span>{fmtDateTime(h.at)}{h.by ? ` · ${h.by}` : ''} · {h.fromStatus && h.fromStatus !== h.toStatus ? `${STATUS_LABEL[h.fromStatus]} → ` : ''}{STATUS_LABEL[h.toStatus]}</span>
          {[h.note, h.followUpDate && `Next follow-up: ${fmtDate(h.followUpDate)}`].filter(Boolean).join('\n') || '—'}
        </div>
      ))}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>Close</button>
        {canUpdate && <button type="button" className="button secondary" onClick={onEdit}><Pencil size={14} /> Edit</button>}
        {canUpdate && TRANSITIONS[row.status].length > 0 && <button type="button" className="button secondary" onClick={onStatus}>Change status</button>}
        {canUpdate && !row.visited && <button type="button" className="button secondary" title="The person came to the office: make this a visited enquiry" onClick={onVisited}>Mark visited</button>}
        {!row.registeredAt && row.status !== 'dead' && <Link className="button secondary" href={`/registrations/new?enquiry=${row.id}`} prefetch={false} title="Open the registration page with this person's details filled in">Register</Link>}
        {canUpdate && row.status !== 'joined' && <button type="button" className="button primary" onClick={onFollowUp}><PhoneCall size={14} /> Add follow-up</button>}
      </div>
    </Modal>
  )
}

/** A follow-up call on a lead: when you called, what was said, and when to call next. */
export function LeadFollowUpForm({ row, onClose, onDone }: { row: EnquiryRow; onClose: () => void; onDone: (m: string) => void }) {
  const [calledAt, setCalledAt] = useState(localInput(new Date()))
  const [next, setNext] = useState('')
  const [interested, setInterested] = useState<boolean | null>(row.interested)
  const [pct, setPct] = useState(row.interestPct ?? 50)
  const [remark, setRemark] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const choice = (label: string, on: boolean, pick: () => void) => <button type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={pick}>{label}</button>
  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await followUpLeadAction({ enquiryId: row.id, calledAt: calledAt ? new Date(calledAt).toISOString() : null, nextFollowUp: next, interested, interestPct: interested ? pct : null, callRemark: remark.trim() || null })
      if (!res.ok) return setError(res.error)
      onDone(`Follow-up saved: ${row.enquiryNo}`)
    })
  }
  return (
    <Modal title={`Follow-up call — ${row.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · {row.phone} · {row.enquiryNo}{row.nextFollowUp ? ` · follow-up was due ${fmtDate(row.nextFollowUp)}` : ''}</p>
        <div className="form-grid">
          <QuickDate label="When did you call?" time value={calledAt} onChange={setCalledAt} picks={[-1, 0]} max={localInput(new Date())} />
          <QuickDate label="Next follow-up date" required value={next} onChange={setNext} picks={[0, 1, 3, 7]} />
        </div>
        <div className="lead-fields" style={{ marginTop: 15 }}>
          <div className="lead-q">
            <span>Interested?</span>
            <div className="seg">{choice('Yes', interested === true, () => setInterested(true))}{choice('No', interested === false, () => setInterested(false))}{choice('Not asked yet', interested === null, () => setInterested(null))}</div>
          </div>
          {interested === true && (
            <div className="lead-q">
              <span>How interested? <strong>{pct}% · {heat(pct)[0]}</strong></span>
              <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Interest percentage" />
            </div>
          )}
          <label className="full-label" style={{ marginTop: 0 }}>Call remark<textarea value={remark} maxLength={500} onChange={(e) => setRemark(e.target.value)} placeholder="What did the person say on this call?" /></label>
        </div>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save follow-up'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** asLead: a lead from the website, e-mail or another source (not visited yet). Otherwise a visited enquiry: the person is in the office. */
function EnquiryForm({ asLead, catalogs, onClose, onDone }: { asLead: boolean; catalogs: Catalogs; onClose: () => void; onDone: (m: string) => void }) {
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const [deptId, setDeptId] = useState('')
  const [occId, setOccId] = useState('')
  const [courseId, setCourseId] = useState('')
  const [actual, setActual] = useState('') // the course's actual fee, in rupees; filled from the course, editable
  const [offer, setOffer] = useState('') // the discounted / proposed fee, in rupees
  const [lead, setLead] = useState<Lead>(NEW_LEAD)
  const [phone, setPhone] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const occName = catalogs.occupationTypes.find((o) => o.id === occId)?.value
  const courses = catalogs.courses.filter((c) => !deptId || c.departmentId === deptId)

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (actual && offer && Number(offer) > Number(actual)) return setError('The discounted fee cannot be more than the actual fee')
    start(async () => {
      const res = await createEnquiryAction({
        person: { firstName: val(fd, 'firstName') ?? '', lastName: val(fd, 'lastName'), phone: val(fd, 'phone') ?? '', altPhone: val(fd, 'altPhone') },
        lead: { ...leadPayload(lead), visited: !asLead },
        occupation: occId
          ? { typeId: occId, schoolOrCollege: val(fd, 'school'), qualification: val(fd, 'qualification'), semester: val(fd, 'semester'), jobRole: val(fd, 'jobRole'), company: val(fd, 'company'), skills: val(fd, 'skills'), country: val(fd, 'country') }
          : undefined,
        sourceId: val(fd, 'sourceId'), departmentId: deptId || null, courseId: courseId || null, classModeId: val(fd, 'classModeId'),
        courseFee: actual ? Math.round(Number(actual) * 100) : null, proposedFee: offer ? Math.round(Number(offer) * 100) : null,
        followUpDate: val(fd, 'followUpDate'), expectedJoinDate: val(fd, 'expectedJoin'), remarks: val(fd, 'remarks'),
      })
      if (!res.ok) return setError(res.error)
      onDone(`${asLead ? 'Lead' : 'Visited enquiry'} ${res.data?.enquiryNo} saved${res.data?.existingPerson ? ' (existing student matched by phone)' : ''}`)
    })
  }

  const sel = (name: string, label: string, opts: { id: string; value: string }[], req = false) => (
    <label>{label}{req && <span className="required-mark">*</span>}
      <select name={name} required={req} defaultValue=""><option value="" disabled={req}>{req ? `Select ${label.toLowerCase()}` : '—'}</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}</select>
    </label>
  )

  return (
    <Modal title={asLead ? 'Add lead' : 'Add visited enquiry'} onClose={onClose}>
      <form ref={formRef} onSubmit={submit}>
        <div className="form-grid">
          <label>First name<span className="required-mark">*</span><input name="firstName" required /></label>
          <label>Last name<input name="lastName" placeholder="Optional" /></label>
          <label>Contact no.<span className="required-mark">*</span><input name="phone" type="tel" required placeholder="10-digit mobile" onChange={(e) => setPhone(e.target.value)} /></label>
          <label>Alternate no.<input name="altPhone" type="tel" placeholder="Optional" /></label>
          <BranchMatches phone={phone} onUse={(m) => fillForm(formRef.current, { firstName: m.firstName, lastName: m.lastName, altPhone: m.altPhone })} />
          <label>Current status{!asLead && <span className="required-mark">*</span>}
            <select value={occId} onChange={(e) => setOccId(e.target.value)} required={!asLead}><option value="" disabled={!asLead}>{asLead ? '—' : 'Select current status'}</option>{catalogs.occupationTypes.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}</select>
          </label>
          {occName === 'Student' && <><label>School/college name<input name="school" /></label><label>Qualification<input name="qualification" /></label><label>Semester<input name="semester" placeholder="Optional" /></label></>}
          {occName === 'Working' && <><label>Job role<input name="jobRole" /></label><label>Qualification<input name="qualification" /></label><label>Company name<input name="company" /></label></>}
          {occName === 'Unemployed' && <><label>Skills<input name="skills" /></label><label>Qualification<input name="qualification" /></label></>}
          {occName === 'Abroad' && <><label>Country<input name="country" /></label><label>Qualification<input name="qualification" /></label><label>School/college name<input name="school" /></label></>}
          {sel('classModeId', 'Mode of classes', catalogs.classModes, !asLead)}
          {sel('sourceId', asLead ? 'Lead came from' : 'Source of enquiry', asLead ? catalogs.sources.filter((s) => !['Random call', 'Direct visit'].includes(s.value)) : catalogs.sources, true)}
          <label>Department{!asLead && <span className="required-mark">*</span>}
            <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setCourseId('') }} required={!asLead}><option value="" disabled={!asLead}>{asLead ? '—' : 'Select department'}</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Course<select name="courseId" value={courseId} onChange={(e) => { const c = courses.find((x) => x.id === e.target.value); setCourseId(e.target.value); if (c?.baseFee) setActual(String(c.baseFee / 100)) }}><option value="">{courses.length ? '—' : 'No courses defined yet'}</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Actual fee (₹)<input name="courseFee" type="number" min="0" step="1" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="Full course fee" /></label>
          <label>Discounted / proposed fee (₹)<input name="proposedFee" type="number" min="0" step="1" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Fee offered to the student" />
            {actual && offer && Number(actual) >= Number(offer) && <small style={{ color: 'var(--muted)', fontWeight: 400 }}>Discount: ₹{(Number(actual) - Number(offer)).toLocaleString('en-IN')}{Number(actual) > 0 ? ` (${Math.round(((Number(actual) - Number(offer)) / Number(actual)) * 100)}%)` : ''}</small>}
          </label>
          <label>Follow-up date<DateInput name="followUpDate" type="date" /></label>
          <label>Expected to join<DateInput name="expectedJoin" type="date" /></label>
        </div>
        <label className="full-label">Remarks<textarea name="remarks" /></label>
        <h3 className="form-section">Lead details</h3>
        <LeadFields lead={lead} set={setLead} catalogs={catalogs} />
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={pending}>{pending ? 'Saving…' : asLead ? 'Save lead' : 'Save enquiry'}</button>
        </div>
      </form>
    </Modal>
  )
}

function TransitionForm({ row, catalogs, tabs, onClose, onDone }: { row: EnquiryRow; catalogs: Catalogs; tabs?: React.ReactNode; onClose: () => void; onDone: (m: string) => void }) {
  const options = TRANSITIONS[row.status]
  const [to, setTo] = useState<EnquiryStatus>(options[0])
  const [error, setError] = useState('')
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const res = await transitionEnquiryAction({
        enquiryId: row.id, to: to as Exclude<EnquiryStatus, 'new'>,
        followUpDate: val(fd, 'followUpDate'), notJoinedReasonId: val(fd, 'reason'), note: val(fd, 'note'),
      })
      if (!res.ok) return setError(res.error)
      onDone(`${row.enquiryNo} → ${STATUS_LABEL[to]}`)
    })
  }

  return (
    <Modal title={`Edit — ${row.enquiryNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · {row.phone} · now <strong>{STATUS_LABEL[row.status]}</strong></p>
      {tabs}
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>New status<span className="required-mark">*</span>
            <select value={to} onChange={(e) => setTo(e.target.value as EnquiryStatus)}>{options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          </label>
          {(to === 'follow_up' || to === 'demo') && <label>{to === 'demo' ? 'Demo date' : 'Follow-up date'}{to === 'follow_up' && <span className="required-mark">*</span>}<DateInput name="followUpDate" type="date" required={to === 'follow_up'} /></label>}
          {to === 'not_joined' && <label>Reason<span className="required-mark">*</span><select name="reason" required defaultValue=""><option value="" disabled>Select reason</option>{catalogs.notJoinedReasons.map((r) => <option key={r.id} value={r.id}>{r.value}</option>)}</select></label>}
        </div>
        <label className="full-label">Note<textarea name="note" placeholder="What was discussed?" /></label>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Update status'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** A website lead's site: a small link chip with the host name; the full page address on hover. */
function SiteChip({ url }: { url: string }) {
  return <a className="src-chip" href={url} target="_blank" rel="noreferrer noopener" title={url}><Globe size={10} />{hostOf(url)}</a>
}

/** 'https://www.example.com/x' -> 'example.com' */
function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url.slice(0, 40) }
}
