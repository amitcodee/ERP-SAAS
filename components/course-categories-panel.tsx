'use client'
// Course categories: the groups every course belongs to, each with a remark, its head (the instructor whose signature
// goes on certificates) and that signature. Head office adds approved categories; a branch admin asks for one and it
// waits for head office. Only approved categories appear when adding courses and registrations.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Pencil, Plus, Signature, X } from 'lucide-react'
import { createCategoryAction, decideCategoryAction, updateCategoryAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { CategoryRow } from '@/modules/catalog/categories'
import { MAX_SIGNATURE_MB, shrinkSignature } from '@/lib/signature-file'

const STATUS = {
  approved: { label: 'Approved', tone: 'green' },
  pending: { label: 'Waiting for head office', tone: 'amber' },
  rejected: { label: 'Rejected', tone: 'red' },
} as const

export function CourseCategoriesPanel({ rows, isSuper, canAdd }: { rows: CategoryRow[]; isSuper: boolean; canAdd: boolean }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<{ row: CategoryRow | null } | null>(null)
  const [rejecting, setRejecting] = useState<CategoryRow | null>(null)
  const [show, setShow] = useState<'all' | 'pending'>(rows.some((r) => r.status === 'pending') && isSuper ? 'pending' : 'all')
  const waiting = rows.filter((r) => r.status === 'pending').length
  const list = show === 'pending' ? rows.filter((r) => r.status === 'pending') : rows
  const canEdit = (r: CategoryRow) => isSuper || r.status === 'pending'

  return (
    <section className="page-container table-page col-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Management / Course Categories</p>
          <h1>Course categories</h1>
          <p className="subheading">Every course belongs to a category. Each category has a head — the instructor whose signature can go on the certificates of its courses.{isSuper ? ' Categories asked for by a branch wait here for your approval.' : ' A category you add waits for head office to approve it before courses can use it.'}</p>
        </div>
        {canAdd && <button type="button" className="button primary" onClick={() => setEditing({ row: null })}><Plus size={16} /> {isSuper ? 'Add category' : 'Ask for a category'}</button>}
      </div>

      <div className="cd-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={show === 'all'} className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All categories<b>{rows.length}</b></button>
        <button type="button" role="tab" aria-selected={show === 'pending'} className={show === 'pending' ? 'on' : ''} onClick={() => setShow('pending')}>Waiting for approval<b>{waiting}</b></button>
      </div>

      <div className="panel table-panel">
        <div className="table-scroll"><table>
          <thead><tr><th>Category</th><th>Remark</th><th>Category head</th><th>Signature</th><th>Courses</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong>{!r.isActive && <small>Not in use</small>}</td>
                <td className="cal-remark">{r.remark ?? '—'}</td>
                <td>{r.headName ?? <span className="text-amber">Not set</span>}</td>
                <td>{r.hasSignature ? <span className="status-badge status-green"><span className="status-dot" />Uploaded</span> : <span className="status-badge status-slate"><span className="status-dot" />None</span>}</td>
                <td>{r.courses}</td>
                <td>
                  <span className={`status-badge status-${STATUS[r.status].tone}`}><span className="status-dot" />{STATUS[r.status].label}</span>
                  {r.requestedBranch && r.status !== 'approved' && <small>Asked by {r.requestedBranch}</small>}
                  {r.status === 'rejected' && r.rejectionReason && <small className="text-red">{r.rejectionReason}</small>}
                </td>
                <td>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    {canEdit(r) && <button type="button" className="filter-button icon-only" title="Edit, and upload the head's signature" aria-label={`Edit ${r.name}`} onClick={() => setEditing({ row: r })}><Pencil size={14} /></button>}
                    {isSuper && r.status === 'pending' && <>
                      <button type="button" className="button primary small" disabled={pending} onClick={() => start(async () => { const res = await decideCategoryAction(r.id, true); notify(res.ok ? `${r.name} approved` : res.error); router.refresh() })}><CheckCircle2 size={14} /> Approve</button>
                      <button type="button" className="filter-button" disabled={pending} onClick={() => setRejecting(r)}><X size={14} /> Reject</button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{show === 'pending' ? 'Nothing is waiting for approval.' : 'No categories yet.'}</td></tr>}
          </tbody>
        </table></div>
      </div>

      {editing && <CategoryForm row={editing.row} isSuper={isSuper} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); notify(m); router.refresh() }} />}
      {rejecting && <RejectForm row={rejecting} onClose={() => setRejecting(null)} onDone={(m) => { setRejecting(null); notify(m); router.refresh() }} />}
    </section>
  )
}

function CategoryForm({ row, isSuper, onClose, onDone }: { row: CategoryRow | null; isSuper: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState({ name: row?.name ?? '', remark: row?.remark ?? '', headName: row?.headName ?? '', isActive: row?.isActive ?? true })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const upload = async (id: string) => {
    if (!file) return null
    const fd = new FormData(); fd.set('target', 'category'); fd.set('id', id); fd.set('file', await shrinkSignature(file))
    const r = await fetch('/api/signatures', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Could not upload the signature' }))
    return r.ok ? null : r.error as string
  }
  return (
    <Modal title={row ? `Edit category — ${row.name}` : isSuper ? 'Add course category' : 'Ask for a course category'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        const res = row ? await updateCategoryAction(row.id, f) : await createCategoryAction(f)
        if (!res.ok) return setErr(res.error)
        const id = row?.id ?? (res.data as { id: string }).id
        const upErr = await upload(id)
        if (upErr) return setErr(`Saved, but the signature was not: ${upErr}`)
        onDone(row ? 'Category saved' : (res.data as { pending: boolean }).pending ? 'Sent to head office for approval' : 'Category added')
      }) }}>
        {!isSuper && !row && <p className="section-hint">Head office approves it before courses can use it.</p>}
        <div className="wl-form">
          <label className="wide">Category name<span className="required-mark">*</span><input required value={f.name} placeholder="e.g. Computer, Civil CAD, Digital Marketing" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="wide">Remark<textarea rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></label>
          <label className="wide">Category head (instructor)<input value={f.headName} placeholder="Full name, as printed under the signature" onChange={(e) => setF({ ...f, headName: e.target.value })} /></label>
          <label className="wide">Head&apos;s signature<input type="file" accept="image/png,image/jpeg" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); setPreview(x ? URL.createObjectURL(x) : null) }} />
            <small className="reg-note">PNG or JPG, up to {MAX_SIGNATURE_MB} MB. Sign in dark ink on white paper and crop close; a PNG with a transparent background looks best.{row?.hasSignature ? ' Leave empty to keep the current one.' : ''}</small></label>
          {preview && <div className="wide sig-preview"><Signature size={14} /><img src={preview} alt="Signature preview" /></div>}
          {isSuper && row && <label className="wide" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} style={{ width: 'auto', margin: 0 }} /> In use (shown when adding courses)</label>}
        </div>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : row ? 'Save' : isSuper ? 'Add category' : 'Send for approval'}</button></div>
      </form>
    </Modal>
  )
}

function RejectForm({ row, onClose, onDone }: { row: CategoryRow; onClose: () => void; onDone: (m: string) => void }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title={`Reject the category “${row.name}”?`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const res = await decideCategoryAction(row.id, false, reason); if (!res.ok) return setErr(res.error); onDone('Category rejected') }) }}>
        <p className="section-hint">The branch sees this reason.</p>
        <label>Reason<textarea required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary wl-danger-fill" disabled={pending}>{pending ? 'Saving…' : 'Reject'}</button></div>
      </form>
    </Modal>
  )
}
