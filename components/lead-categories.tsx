'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, Eye, Plus, Send } from 'lucide-react'
import { addLeadCategoryAction, leadRecordAction, updateLeadCategoryAction } from '@/app/actions'
import { Interest } from '@/components/enquiries-panel'
import { Err, Modal } from '@/components/modal'
import type { LeadCategoryCount, LeadCategoryMember } from '@/modules/catalog/service'
import type { LeadRecord } from '@/modules/enquiries/service'
import { STATUS_LABEL, type EnquiryStatus } from '@/modules/enquiries/status'

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const KIND: Record<LeadCategoryMember['kind'], [string, string]> = { call: ['Random call', 'status-blue'], lead: ['Lead', 'status-amber'], visited: ['Visited enquiry', 'status-green'] }

/** The lead categories with how many calls, leads and visited enquiries sit in each. Head office adds and switches them off. */
export function LeadCategoriesPanel({ categories, canEdit, notify }: { categories: LeadCategoryCount[]; canEdit: boolean; notify: (m: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [pending, start] = useTransition()
  const total = categories.reduce((n, c) => n + c.total, 0)
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Admissions / Lead categories</p><h1>Lead categories</h1><p className="subheading">Each random call, lead or visited enquiry sits in one category at a time. Open View to see everyone in a category.</p></div>
        <div className="heading-actions">{canEdit && <button className="button primary" onClick={() => setAdding(true)}><Plus size={17} /> Add category</button>}</div>
      </div>
      <div className="table-summary">
        <div><strong>{categories.filter((c) => c.isActive).length}</strong><span>Categories in use</span></div>
        <div><strong className="text-blue">{total.toLocaleString('en-IN')}</strong><span>Leads with a category</span></div>
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead><tr><th>S.No.</th><th>Category</th><th>Random calls</th><th>Leads</th><th>Visited enquiries</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {categories.map((c, i) => (
                <tr key={c.id}>
                  <td>{i + 1}</td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.calls}</td>
                  <td>{c.leads}</td>
                  <td>{c.visited}</td>
                  <td><strong className="id-text">{c.total}</strong></td>
                  <td><span className={`status-badge ${c.isActive ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{c.isActive ? 'In use' : 'Switched off'}</span></td>
                  <td>
                    <div className="row-actions">
                      <Link className="filter-button" href={`/lead-categories/${c.id}`} prefetch={false} aria-label={`View leads in ${c.name}`}><Eye size={13} /> View</Link>
                      {canEdit && <button className="filter-button" disabled={pending} onClick={() => start(async () => { const res = await updateLeadCategoryAction({ id: c.id, isActive: !c.isActive }); notify(res.ok ? (c.isActive ? 'Category switched off' : 'Category switched on') : res.error) })}>{c.isActive ? 'Switch off' : 'Switch on'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!categories.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{canEdit ? 'No lead categories yet. Click Add category to make the first one.' : 'No lead categories yet. Head office adds them.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {adding && <AddCategory onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); notify(m) }} />}
    </section>
  )
}

function AddCategory({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await addLeadCategoryAction(name)
      if (!res.ok) return setError(res.error)
      onDone(`Lead category "${name.trim()}" added`)
    })
  }
  return (
    <Modal title="Add lead category" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="section-hint" style={{ margin: '-8px 0 14px' }}>Staff can then pick this category on random calls, leads and visited enquiries.</p>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
          <label>Category name<span className="required-mark">*</span><input value={name} autoFocus required minLength={2} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hot lead" /></label>
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save category'}</button></div>
      </form>
    </Modal>
  )
}

/** Everyone in one category: random calls, leads and visited enquiries together. */
export function LeadCategoryView({ category, members, canBroadcast }: { category: { id: string; name: string; isActive: boolean }; members: LeadCategoryMember[]; canBroadcast?: boolean }) {
  const [kind, setKind] = useState<'all' | LeadCategoryMember['kind']>('all')
  const [viewing, setViewing] = useState<LeadCategoryMember | null>(null)
  const count = (k: LeadCategoryMember['kind']) => members.filter((m) => m.kind === k).length
  const rows = kind === 'all' ? members : members.filter((m) => m.kind === kind)
  const tab = (k: typeof kind, label: string, n: number) => <button type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{label} ({n})</button>
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Admissions / Lead categories</p><h1>{category.name}</h1><p className="subheading">Every random call, lead and visited enquiry in this category{category.isActive ? '' : ' (the category is switched off)'}.</p></div>
        <div className="heading-actions">{canBroadcast && <Link className="button primary" href={`/whatsapp?category=${category.id}`} prefetch={false}><Send size={16} /> Send WhatsApp</Link>}<Link className="button secondary" href="/lead-categories" prefetch={false}><ArrowLeft size={16} /> All categories</Link></div>
      </div>
      <div className="panel table-panel">
        <div style={{ padding: '16px 18px 4px' }}><div className="seg">{tab('all', 'All', members.length)}{tab('call', 'Random calls', count('call'))}{tab('lead', 'Leads', count('lead'))}{tab('visited', 'Visited enquiries', count('visited'))}</div></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>S.No.</th><th>Type</th><th>Name</th><th>Interested in</th><th>Status</th><th>Interest</th><th>Next follow-up</th><th>Added on</th><th>Branch</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={`${m.kind}-${m.id}`}>
                  <td>{i + 1}</td>
                  <td><span className={`status-badge ${KIND[m.kind][1]}`}><span className="status-dot" />{KIND[m.kind][0]}</span>{m.ref && <small>{m.ref}</small>}</td>
                  <td><div><strong>{m.name ?? '—'}</strong><span style={{ display: 'block' }}>{m.phone ?? ''}</span></div></td>
                  <td>{m.course ?? '—'}</td>
                  <td>{m.kind === 'call' ? m.status ?? '—' : STATUS_LABEL[m.status as EnquiryStatus] ?? m.status ?? '—'}</td>
                  <td><Interest r={m} /></td>
                  <td>{fmt(m.nextFollowUp)}</td>
                  <td>{fmt(m.at)}</td>
                  <td>{m.branch ?? '—'}</td>
                  <td><div className="row-actions"><button className="filter-button" onClick={() => setViewing(m)} aria-label={`View everything about ${m.name ?? 'this lead'}`}><Eye size={13} /> View</button></div></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>Nothing in this category yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {viewing && <RecordView member={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Everything about one call, lead or visited enquiry: details, every follow-up, and the log of who changed it. */
function RecordView({ member, onClose }: { member: LeadCategoryMember; onClose: () => void }) {
  const [rec, setRec] = useState<LeadRecord | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    leadRecordAction(member.kind === 'call' ? 'call' : 'enquiry', member.id).then((res) => { if (!live) return; if (res.ok && res.data) setRec(res.data); else if (!res.ok) setError(res.error) })
    return () => { live = false }
  }, [member.kind, member.id])
  return (
    <Modal title={rec?.title ?? `${KIND[member.kind][0]} — ${member.name ?? ''}`} onClose={onClose}>
      {!rec && !error && <p className="section-hint" style={{ margin: 0 }}>Loading…</p>}
      <Err msg={error} />
      {rec && (
        <>
          <dl className="detail-list">{rec.fields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {rec.notes.map(([k, v]) => <div className="detail-note" key={k}><span>{k}</span>{v}</div>)}
          <p className="eyebrow" style={{ margin: '18px 0 0' }}>Follow-ups ({rec.followUps.length})</p>
          {!rec.followUps.length && <p className="section-hint" style={{ margin: '8px 0 0' }}>No follow-up yet.</p>}
          {rec.followUps.map((f) => <div className="detail-note" key={f.id} style={{ marginTop: 8 }}><span>{fmtTime(f.at)}{f.by ? ` · ${f.by}` : ''} · {f.title}</span>{f.text}</div>)}
          <p className="eyebrow" style={{ margin: '18px 0 0' }}>Logs ({rec.logs.length})</p>
          {!rec.logs.length && <p className="section-hint" style={{ margin: '8px 0 0' }}>No log entries.</p>}
          {rec.logs.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
                <tbody>{rec.logs.map((l) => <tr key={l.id}><td>{fmtTime(l.at)}</td><td>{l.by ?? '—'}</td><td>{l.what}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
    </Modal>
  )
}
