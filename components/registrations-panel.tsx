'use client'

import { Modal } from '@/components/modal'
import { AddButton } from '@/components/branch-gate'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteRegistrationAction } from '@/app/actions'
import { DeleteButton } from '@/components/delete-button'
import { ArrowRightLeft, CalendarClock, Share2, Pencil, Eye, FolderOpen, IdCard, IndianRupee, Plus, RefreshCw, X } from 'lucide-react'
import { RegistrationEditModal } from '@/components/registration-letters'
import { DatesForm, DetailsModal } from '@/components/registration-modals'
import { movable, ShareForm, TransferForm } from '@/components/student-move'
import { MIN_FIRST_PAYMENT } from '@/modules/fees/plan'
import { completionStatusAction, deleteDocumentAction, listDocumentsAction, markCompletedAction, queryRegistrationsAction, transitionRegistrationAction } from '@/app/actions'
import type { Completion } from '@/modules/registrations/completion'
import { DOC_KINDS, docLabel, type DocumentRow } from '@/modules/documents/kinds'
import { ListToolbar, opts, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { usePagedList } from '@/components/use-paged-list'
import type { Summaries } from '@/modules/reports/service'
import { REG_STATUS_LABEL, REG_TRANSITIONS, type RegistrationStatus } from '@/modules/registrations/status'
import type { Catalogs } from '@/modules/catalog/service'
import type { EnquiryRow } from '@/components/enquiries-panel'

export type RegistrationRow = {
  id: string
  branchId: string
  enquiryId: string | null
  regNo: string
  status: RegistrationStatus
  kind: 'new' | 'upgrade'
  enrollmentDate: string
  joiningDate: string | null
  expectedEndDate: string | null
  totalFee: number // paise
  /** Paid so far (paise). Under the minimum first payment the student is not active yet. */
  settled: number
  /** A fee change is waiting with accounts. */
  feeRequest: boolean
  name: string
  phone: string
  department: string
  course: string | null
  mode: string | null
}

const STYLE: Record<RegistrationStatus, string> = { active: 'status-green', on_hold: 'status-amber', discontinued: 'status-red', completed: 'status-blue', transferred: 'status-slate' }
const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const val = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() !== '' ? v.trim() : null }


export function RegistrationsPanel({
  rows, total, summary, catalogs, canCreate, canUpdate, canReactivate, canDelete = false, transferBranches = [], shareBranches = [], needsBranch, mode, notify,
}: {
  rows: RegistrationRow[]
  total: number
  summary: Summaries['registrations']
  catalogs: Catalogs
  canCreate: boolean
  canUpdate: boolean
  /** Delete (to the Recycle Bin): a registration with no payment. */
  canDelete?: boolean
  canReactivate: boolean
  /** the branches a student can be moved to (shown to those who may ask for a transfer) */
  transferBranches?: { id: string; name: string }[]
  /** the branches a student can also take classes in (shown to those who may ask for that) */
  shareBranches?: { id: string; name: string }[]
  needsBranch: boolean
  mode: 'list' | 'update'
  notify: (m: string) => void
}) {
  const list = usePagedList({ rows, total }, queryRegistrationsAction)
  const [moving, setMoving] = useState<RegistrationRow | null>(null)
  const [sharing, setSharing] = useState<RegistrationRow | null>(null)
  const router = useRouter() // New registration is its own page
  const [editing, setEditing] = useState<RegistrationRow | null>(null)
  const [docsFor, setDocsFor] = useState<RegistrationRow | null>(null)
  const [viewing, setViewing] = useState<RegistrationRow | null>(null)
  // who may be moved or shared: the same rules for the row's icons and the buttons in View
  const canTransfer = (r: RegistrationRow) => canReactivate && transferBranches.length > 0 && movable('transfer', r)
  const canShare = (r: RegistrationRow) => shareBranches.length > 0 && movable('share', r)
  // everything that can be done to a registration: icons in its row, labelled buttons in its View popup (delete comes last in both)
  const actionsFor = (r: RegistrationRow): { key: string; label: string; aria: string; title: string; icon: typeof Eye; href?: string; newTab?: boolean; run?: () => void }[] => [
    { key: 'id', label: 'ID card', aria: `ID card of ${r.regNo}`, title: 'ID card', icon: IdCard, href: `/registrations/${r.id}/id-card`, newTab: true },
    { key: 'fees', label: 'Fees', aria: `Fees of ${r.regNo}`, title: 'Fees: details, installments and fee update request', icon: IndianRupee, href: `/fees/${r.id}` },
    { key: 'docs', label: 'Documents', aria: `Documents of ${r.regNo}`, title: 'Documents', icon: FolderOpen, run: () => setDocsFor(r) },
    ...(canUpdate ? [
      { key: 'edit', label: 'Edit', aria: `Edit ${r.regNo}`, title: 'Edit: project certificate, mode of classes, internship letters', icon: Pencil, run: () => setLettersFor(r) },
      { key: 'dates', label: 'Edit dates', aria: `Edit dates of ${r.regNo}`, title: 'Edit dates (back-date)', icon: CalendarClock, run: () => setDating(r) },
    ] : []),
    ...(canUpdate && REG_TRANSITIONS[r.status].length > 0 && (r.status !== 'discontinued' || canReactivate) ? [{ key: 'status', label: 'Update status', aria: `Update status of ${r.regNo}`, title: 'Update status: active, on hold, discontinued', icon: RefreshCw, run: () => setEditing(r) }] : []),
    ...(canTransfer(r) ? [{ key: 'transfer', label: 'Transfer', aria: `Transfer ${r.regNo}`, title: 'Transfer to another branch', icon: ArrowRightLeft, run: () => setMoving(r) }] : []),
    ...(canShare(r) ? [{ key: 'share', label: 'Share', aria: `Share ${r.regNo} with another branch`, title: 'Classes in another branch too (shared student)', icon: Share2, run: () => setSharing(r) }] : []),
  ]
  const [dating, setDating] = useState<RegistrationRow | null>(null)
  const [lettersFor, setLettersFor] = useState<RegistrationRow | null>(null)
  // A registered student is "inactive" until the first fee (at least the minimum) is received.
  const inactive = (r: RegistrationRow) => r.status === 'active' && r.settled < MIN_FIRST_PAYMENT
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Admissions / {mode === 'update' ? 'Registration update' : 'Registration'}</p>
          <h1>{mode === 'update' ? 'Registration update' : 'Registrations'}</h1>
          <p className="subheading">{mode === 'update' ? 'Search by registration ID, then set Active, On Hold or Discontinue.' : 'Enrol students from enquiries or directly.'}</p>
        </div>
        <div className="heading-actions">
          {canCreate && <AddButton needsBranch={needsBranch} branches={catalogs.branches} onGo={() => router.push('/registrations/new')}><Plus size={17} /> New registration</AddButton>}
        </div>
      </div>
      <div className="table-summary">
        <div><strong>{summary.total.toLocaleString('en-IN')}</strong><span>Total registrations</span></div>
        <div><strong className="text-green">{summary.active}</strong><span>Active</span></div>
        <div><strong className="text-amber">{summary.onHold}</strong><span>On hold</span></div>
        <div><strong className="text-blue">{summary.toConvert}</strong><span>Enquiries to convert</span></div>
      </div>
      <div className="panel table-panel">
        <ListToolbar list={list} exportList={'registrations'} placeholder={mode === 'update' ? 'Search by registration ID…' : 'Search name, phone or registration ID…'} autoFocus={mode === 'update'} dateLabel="Enrolled"
          filters={[
            { key: 'status', label: 'Status', options: (Object.keys(REG_STATUS_LABEL) as RegistrationStatus[]).map((k) => ({ value: k, label: REG_STATUS_LABEL[k] })) },
            { key: 'dept', label: 'Department', options: opts(catalogs.departments, (d) => d.id, (d) => d.name) },
            { key: 'course', label: 'Course', options: opts(catalogs.courses.filter((c) => !list.filter('dept') || c.departmentId === list.filter('dept')), (c) => c.id, (c) => c.title) },
            { key: 'mode', label: 'Mode', options: opts(catalogs.classModes, (o) => o.id, (o) => o.value) },
            { key: 'kind', label: 'Type', options: [{ value: 'new', label: 'New' }, { value: 'upgrade', label: 'Upgrade' }] },
          ]}
          sorts={[
            { key: 'created', label: 'Newest first', dir: 'desc' }, { key: 'enrolled', label: 'Enrolled, latest', dir: 'desc' }, { key: 'enrolled', label: 'Enrolled, earliest', dir: 'asc' },
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'reg', label: 'Registration ID', dir: 'asc' },
            { key: 'fee', label: 'Fee, highest', dir: 'desc' }, { key: 'fee', label: 'Fee, lowest', dir: 'asc' }, { key: 'status', label: 'Status', dir: 'asc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="reg">Registration ID</SortTh><SortTh list={list} k="name">Student</SortTh><th>Course</th><th>Mode</th><SortTh list={list} k="fee" first="desc">Total fee</SortTh><SortTh list={list} k="enrolled" first="desc">Enrolled</SortTh><SortTh list={list} k="status">Status</SortTh><th /></tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id}>
                  <td><strong className="id-text">{r.regNo}</strong>{r.kind === 'upgrade' && <small>Upgrade</small>}</td>
                  <td><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.phone}</span></div></td>
                  <td>{r.course ?? r.department}</td>
                  <td>{r.mode ?? '—'}</td>
                  <td>{inr(r.totalFee)}</td>
                  <td>{fmt(r.enrollmentDate)}</td>
                  <td>
                    {inactive(r)
                      ? <span className="status-badge status-slate" title={`Becomes active when at least ₹${MIN_FIRST_PAYMENT / 100} of the fee is received`}><span className="status-dot" />Inactive</span>
                      : <span className={`status-badge ${STYLE[r.status]}`}><span className="status-dot" />{REG_STATUS_LABEL[r.status]}</span>}
                    {r.feeRequest && <small>Fee change with accounts</small>}
                  </td>
                  <td><div className="row-actions">
                    <button className="filter-button icon-only" title="View full details" aria-label={`View ${r.regNo}`} onClick={() => setViewing(r)}><Eye size={15} /></button>
                    {actionsFor(r).map((a) => a.href
                      ? <a key={a.key} className="filter-button icon-only" title={a.title} aria-label={a.aria} href={a.href} {...(a.newTab ? { target: '_blank', rel: 'noreferrer' } : {})}><a.icon size={15} /></a>
                      : <button key={a.key} className="filter-button icon-only" title={a.title} aria-label={a.aria} onClick={a.run}><a.icon size={15} /></button>)}
                    {canDelete && <DeleteButton what={`Registration ${r.regNo}`} run={() => deleteRegistrationAction(r.id)} onDone={() => router.refresh()} />}
                  </div></td>
                </tr>
              ))}
              {!list.rows.length && !list.loading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No registrations match these filters.' : 'No registrations yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={list.loading} setPage={list.setPage} noun="registrations" />
      </div>
      {docsFor && <DocumentsModal row={docsFor} canEdit={canUpdate} onClose={() => setDocsFor(null)} />}
      {viewing && <DetailsModal row={viewing} onClose={() => setViewing(null)} actions={<>
        {actionsFor(viewing).map((a) => a.href
          ? <a key={a.key} className="button secondary" title={a.title} href={a.href} {...(a.newTab ? { target: '_blank', rel: 'noreferrer' } : {})}><a.icon size={15} /> {a.label}</a>
          : <button key={a.key} type="button" className="button secondary" title={a.title} onClick={() => { setViewing(null); a.run!() }}><a.icon size={15} /> {a.label}</button>)}
        {canDelete && <DeleteButton label what={`Registration ${viewing.regNo}`} run={() => deleteRegistrationAction(viewing.id)} onDone={() => { setViewing(null); router.refresh() }} />}
      </>} />}
      {dating && <DatesForm row={dating} onClose={() => setDating(null)} onDone={(m) => { setDating(null); notify(m) }} />}
      {sharing && <ShareForm row={sharing} branches={shareBranches.filter((b) => b.id !== sharing.branchId)} onClose={() => setSharing(null)} onDone={(m) => { setSharing(null); notify(m) }} />}
      {moving && <TransferForm row={moving} branches={transferBranches.filter((b) => b.id !== moving.branchId)} onClose={() => setMoving(null)} onDone={(m) => { setMoving(null); notify(m) }} />}
      {editing && <StatusForm row={editing} canComplete={canReactivate} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); notify(m) }} />}
      {lettersFor && <RegistrationEditModal registrationId={lettersFor.id} title={`${lettersFor.name} (${lettersFor.regNo})`} classModes={catalogs.classModes} onClose={() => setLettersFor(null)} onSaved={() => { setLettersFor(null); notify('Registration saved'); router.refresh() }} />}
    </section>
  )
}

function StatusForm({ row, canComplete, onClose, onDone }: { row: RegistrationRow; canComplete: boolean; onClose: () => void; onDone: (m: string) => void }) {
  // a manager may also mark the course completed (it is otherwise done on its own once the syllabus and certificates are)
  const options: RegistrationStatus[] = [...REG_TRANSITIONS[row.status].filter((s) => s !== 'completed'), ...(canComplete && (row.status === 'active' || row.status === 'on_hold') ? ['completed' as const] : [])]
  const [to, setTo] = useState(options[0])
  const [check, setCheck] = useState<Completion | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => { if (to === 'completed' && !check) void completionStatusAction(row.id).then((r) => r.ok && setCheck(r.data ?? null)) }, [to]) // eslint-disable-line react-hooks/exhaustive-deps
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const note = val(new FormData(e.currentTarget), 'note')
    start(async () => {
      if (to === 'completed') {
        const res = await markCompletedAction({ registrationId: row.id, note: note ?? '' })
        if (!res.ok) return setError(res.error)
        return onDone(`${row.regNo} → Completed`)
      }
      const res = await transitionRegistrationAction({ registrationId: row.id, to: to as 'active' | 'on_hold' | 'discontinued', note })
      if (!res.ok) return setError(res.error)
      onDone(`${row.regNo} → ${REG_STATUS_LABEL[to]}`)
    })
  }
  return (
    <Modal title={`Update ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · now <strong>{REG_STATUS_LABEL[row.status]}</strong></p>
      <form onSubmit={submit}>
        <div className="form-grid"><label>Status update<select value={to} onChange={(e) => setTo(e.target.value as typeof to)}>{options.map((s) => <option key={s} value={s}>{s === 'completed' ? 'Completed (mark course completed)' : REG_STATUS_LABEL[s]}</option>)}</select></label></div>
        {to === 'completed' && (
          <div className="fee-note" style={{ marginTop: 12 }}>
            {!check ? 'Checking the syllabus and certificates…' : check.ready
              ? 'Everything is done: syllabus covered and certificates issued.'
              : <>Still missing (it can be marked completed anyway, with a reason):<ul style={{ margin: '6px 0 0 18px' }}>{check.missing.map((m) => <li key={m}>{m}</li>)}</ul></>}
          </div>
        )}
        <label className="full-label">Reason / note{to !== 'active' && <span className="required-mark">*</span>}<textarea name="note" required={to !== 'active'} /></label>
        {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Update status'}</button></div>
      </form>
    </Modal>
  )
}

const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function DocumentsModal({ row, canEdit, onClose }: { row: RegistrationRow; canEdit: boolean; onClose: () => void }) {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState<DocumentRow | null>(null) // the document shown in place, instead of opening a new page
  const formRef = useRef<HTMLFormElement>(null)
  const load = async () => { const r = await listDocumentsAction(row.id); if (r.ok) setDocs(r.data ?? []); else setError(r.error) }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('registrationId', row.id)
    const file = fd.get('file')
    if (!(file instanceof File) || !file.size) return setError('Choose a file')
    if (file.size > 5 * 1024 * 1024) return setError('Files must be 5 MB or smaller')
    setBusy(true); setError('')
    const res = await fetch('/api/documents', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Upload failed' }))
    setBusy(false)
    if (!res.ok) return setError(res.error)
    formRef.current?.reset()
    await load()
  }
  async function remove(d: DocumentRow) {
    setBusy(true); setError('')
    const res = await deleteDocumentAction(d.id)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    await load()
  }

  return (
    <Modal title={`Documents · ${row.regNo}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 14px' }}>{row.name} · PDF, JPG, PNG or WebP, up to 5 MB each</p>
      {docs === null ? <p style={{ fontSize: 11, color: '#8b98aa' }}>Loading…</p> : docs.length === 0 ? <p style={{ fontSize: 11, color: '#8b98aa' }}>No documents yet.</p> : (
        <table style={{ minWidth: 0 }}>
          <thead><tr><th>Document</th><th>Uploaded</th><th /></tr></thead>
          <tbody>{docs.map((d) => (
            <tr key={d.id} className={viewing?.id === d.id ? 'doc-on' : ''}>
              <td><strong>{docLabel(d)}</strong>{d.payment && <small>{d.payment.receiptNo} · {inr(d.payment.amount)}</small>}</td>
              <td>{fmt(d.uploadedAt)}<small>{size(d.sizeBytes)}</small></td>
              <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" className="filter-button" onClick={() => setViewing(viewing?.id === d.id ? null : d)}><Eye size={14} /> {viewing?.id === d.id ? 'Hide' : 'View'}</button>
                {canEdit && !d.payment && <button type="button" className="filter-button" disabled={busy} onClick={() => remove(d)}>Delete</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {viewing && (
        <div className="doc-view">
          <div><strong>{docLabel(viewing)}</strong><button type="button" className="link-button" onClick={() => setViewing(null)}>Close</button></div>
          {viewing.mime === 'application/pdf'
            ? <p className="section-hint" style={{ margin: 0 }}>This is a PDF, which cannot be shown here. <a href={`/documents/${viewing.id}`}>Download it</a>.</p>
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={`/documents/${viewing.id}`} alt={docLabel(viewing)} />}
        </div>
      )}
      {canEdit && (
        <form ref={formRef} onSubmit={upload} style={{ marginTop: 16 }}>
          <div className="form-grid">
            <label>Document type<select name="kind" defaultValue="id_proof">{Object.entries(DOC_KINDS).filter(([k]) => k !== 'payment_proof' && k !== 'payment_slip').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label>
          </div>
          <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button><button className="button primary" disabled={busy}>{busy ? 'Working…' : 'Upload'}</button></div>
        </form>
      )}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
    </Modal>
  )
}
