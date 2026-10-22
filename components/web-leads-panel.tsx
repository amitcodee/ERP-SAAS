'use client'
// Website leads: every form sent on the institute websites, by website. A website set on a branch sends its leads
// straight to that branch as Leads; the rest wait here until head office sends them to a branch.
import { useEffect, useRef, useState, useTransition } from 'react'
import { ExportButton } from '@/components/export-button'
import Link from 'next/link'
import { Eye, ExternalLink, Globe, Pencil, PhoneCall, Search, Send, Trash2, UserPlus } from 'lucide-react'
import { assignWebLeadAction, deleteWebLeadAction, editWebLeadAction, listWebLeadsAction, queryAllEnquiriesAction } from '@/app/actions'
import { LeadFollowUpForm, LeadForm, type EnquiryRow } from '@/components/enquiries-panel'
import type { Catalogs } from '@/modules/catalog/service'
import { Err, Modal } from '@/components/modal'
import { isMobile } from '@/modules/people/phone'
import type { WebLeadRow, WebSite } from '@/modules/web-leads/service'

type Branch = { id: string; code: string; name: string }
const fmtTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const MATCHED: Record<string, string> = { website: 'by its website', location: 'by place', manual: 'by head office', form: 'chosen on the form' }

export function WebLeadsPanel({ rows, total, sites, branches, canAssign, canOpenLead, canEditLead, isHeadOffice, catalogs, notify }: {
  rows: WebLeadRow[]; total: number; sites: WebSite[]; branches: Branch[]; canAssign: boolean; canOpenLead: boolean; canEditLead: boolean; isHeadOffice: boolean; catalogs: Catalogs; notify: (m: string) => void
}) {
  const [data, setData] = useState({ rows, total, sites })
  const [site, setSite] = useState('')
  const [state, setState] = useState('')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [loading, startLoad] = useTransition()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState<{ row: WebLeadRow; mode: 'view' | 'edit' | 'delete' } | null>(null)
  // a website lead that is already a lead: Edit and Follow up open the lead's own windows (as on the Leads page)
  const [lead, setLead] = useState<{ row: EnquiryRow; mode: 'edit' | 'follow' } | null>(null)
  const openLead = (r: WebLeadRow, mode: 'edit' | 'follow') => start(async () => {
    const res = await queryAllEnquiriesAction({ q: r.enquiryNo! }, 0)
    const row = res.ok ? (res.data!.rows as unknown as EnquiryRow[]).find((x) => x.enquiryNo === r.enquiryNo) : null
    if (!row) return notify(res.ok ? `Lead ${r.enquiryNo} was not found` : res.error)
    setLead({ row, mode })
  })
  const filters = JSON.stringify([site, state, q.trim()])
  const shown = useRef(filters) // the filters the rows on screen are for: the server's first page has none
  const seq = useRef(0)

  /** Fetches the list for the current filters (from `offset` = Show more). A dropped connection is told, not thrown. */
  const load = (offset = 0) => startLoad(async () => {
    const my = ++seq.current
    try {
      const r = await listWebLeadsAction({ site: site || undefined, state: state || undefined, q: q.trim() || undefined, offset })
      if (my !== seq.current) return // a newer search superseded this one
      if (!r.ok) return notify(r.error)
      // Show more: new arrivals shift the pages, so a lead already on screen is not added twice.
      setData((cur) => ({ rows: offset ? [...cur.rows, ...r.data!.rows.filter((x) => !cur.rows.some((c) => c.id === x.id))] : r.data!.rows, total: r.data!.total, sites: r.data!.sites }))
    } catch {
      notify('Could not load the website leads. Check the connection and try again.')
    }
  })
  useEffect(() => {
    if (shown.current === filters) return
    const t = setTimeout(() => { shown.current = filters; load(0) }, 300)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  const send = (r: WebLeadRow) => start(async () => {
    const branchId = pick[r.id]
    if (!branchId) return notify('Choose the branch first')
    try {
      const res = await assignWebLeadAction(r.id, branchId)
      const to = branches.find((b) => b.id === branchId)?.name ?? 'the branch'
      if (res.ok) setOpen(null)
      notify(!res.ok ? res.error : res.data?.problem ? `${r.name} sent to ${to}, but: ${res.data.problem}` : res.data?.existing ? `${r.name} is already a lead in ${to}: the form was added to it` : `${r.name} is now a lead in ${to}`)
    } catch {
      notify('Could not send it. Check the connection and try again.')
    }
    load(0)
  })

  const waiting = data.sites.reduce((n, s) => n + s.waiting, 0)
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview / Web Leads</p><h1>Web Leads</h1>
          <p className="subheading">{isHeadOffice
            ? 'Forms sent on the institute websites. A website set on a branch (Branches) sends its leads straight to that branch; the others wait here for you to send them on.'
            : 'Forms sent on your branch website. Each one is also on the Leads page, ready to call.'}</p>
        </div>
      </div>

      {isHeadOffice && data.sites.length > 0 && (
        <div className="panel" style={{ padding: 14, marginBottom: 16 }}>
          <p className="section-hint" style={{ margin: '0 0 10px' }}>Websites ({data.sites.length}){waiting > 0 ? ` · ${waiting} lead${waiting === 1 ? '' : 's'} waiting for a branch` : ''}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {data.sites.map((s) => (
              <button key={s.host} type="button" className={`filter-button${site === s.host ? ' active' : ''}`} aria-pressed={site === s.host} onClick={() => setSite(site === s.host ? '' : s.host)}
                title={s.branchName ? `Goes to ${s.branchName}` : 'No branch has this website yet'}>
                <Globe size={13} /> {s.host} · {s.total}{s.branchName ? ` → ${s.branchName}` : s.waiting ? ` (${s.waiting} waiting)` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel table-panel">
        <div className="table-toolbar">
          <label className="table-search"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or e-mail…" aria-label="Search website leads" /></label>
          <div className="toolbar-controls">
            {data.sites.length > 1 && (
              <select className={`toolbar-select${site ? ' is-set' : ''}`} value={site} onChange={(e) => setSite(e.target.value)} aria-label="Website">
                <option value="">All websites</option>
                {data.sites.map((s) => <option key={s.host} value={s.host}>{s.host}</option>)}
              </select>
            )}
            <select className={`toolbar-select${state ? ' is-set' : ''}`} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
              <option value="">All</option>
              {isHeadOffice && <option value="waiting">Waiting for a branch</option>}
              <option value="placed">Made a lead</option>
              <option value="problem">Not made a lead</option>
            </select>
            {/* every page of what the list shows now: the same website, state and search */}
            <ExportButton list="web-leads" query={{ q: q.trim() || undefined, f: { site, state } }} />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Received</th><th>Name</th><th>Course &amp; place</th><th>Website</th><th>Branch</th><th>Lead</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.submittedAt)}</td>
                  <td><div><strong>{r.name}</strong><span style={{ display: 'block' }}>{r.phone ?? '—'}{r.email ? ` · ${r.email}` : ''}</span></div></td>
                  <td>{r.course ?? '—'}{r.location && <small style={{ display: 'block' }}>{r.location}</small>}</td>
                  <td>
                    {/* the website as a badge; point at it for the full address of the page the form was on */}
                    <span className="wl-site" title={r.sourceUrl ?? `https://${r.siteHost}`}><Globe size={12} /> {r.siteHost}</span>
                    {r.sourceUrl && <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" title={r.sourceUrl} className="wl-path">{pagePath(r.sourceUrl)} <ExternalLink size={11} /></a>}
                    {r.campaign && <small style={{ display: 'block' }} title="The ad or post it came from (utm_source / medium / campaign)">{r.campaign}</small>}
                  </td>
                  <td>
                    {r.branchName ? <><strong>{r.branchName}</strong><small style={{ display: 'block' }}>{MATCHED[r.matchedBy ?? ''] ?? ''}</small></>
                      : <span className="status-badge status-amber"><span className="status-dot" />Waiting</span>}
                  </td>
                  <td>
                    {r.enquiryNo ? (canOpenLead ? <Link href={`/enquiries/update?q=${encodeURIComponent(r.enquiryNo)}`} className="id-text">{r.enquiryNo}</Link> : <span className="id-text">{r.enquiryNo}</span>)
                      : !isMobile(r.phone) ? <span className="status-badge status-red" title="Without a valid mobile number it cannot be made a lead. Correct the number (Edit) or contact them from the details."><span className="status-dot" />No valid mobile</span>
                      : r.problem ? <span className="status-badge status-red" title={r.problem}><span className="status-dot" />Not made a lead</span>
                      : !r.branchId ? <span className="status-badge status-amber"><span className="status-dot" />Not sent yet</span> : '—'}
                  </td>
                  <td>
                    <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="filter-button icon-only" title="View: every detail and the full page address" aria-label={`View ${r.name}`} onClick={() => setOpen({ row: r, mode: 'view' })}><Eye size={15} /></button>
                      {r.enquiryNo
                        ? canEditLead && <button type="button" className="filter-button icon-only" title="Edit the lead" aria-label={`Edit ${r.name}`} disabled={pending} onClick={() => openLead(r, 'edit')}><Pencil size={15} /></button>
                        : canAssign && <button type="button" className="filter-button icon-only" title="Edit the form as it arrived" aria-label={`Edit ${r.name}`} onClick={() => setOpen({ row: r, mode: 'edit' })}><Pencil size={15} /></button>}
                      {r.enquiryNo && canEditLead && <button type="button" className="filter-button icon-only" title="Follow up: the call and what was said" aria-label={`Follow up ${r.name}`} disabled={pending} onClick={() => openLead(r, 'follow')}><PhoneCall size={15} /></button>}
                      {!r.enquiryNo && canAssign && isMobile(r.phone) && (!r.branchId || r.problem) && <button type="button" className="filter-button icon-only wl-go" title="Send to Leads: choose the branch it goes to" aria-label={`Send ${r.name} to leads`} onClick={() => setOpen({ row: r, mode: 'view' })}><UserPlus size={15} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{loading ? 'Loading…' : 'No website leads yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {data.rows.length < data.total && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <button type="button" className="button secondary" disabled={loading} onClick={() => load(data.rows.length)}>{loading ? 'Loading…' : `Show more (${data.total - data.rows.length} left)`}</button>
          </div>
        )}
      </div>

      {open?.mode === 'view' && (
        <ViewModal r={open.row} branches={branches} canAssign={canAssign} canOpenLead={canOpenLead}
          pick={pick[open.row.id] ?? ''} setPick={(v) => setPick({ ...pick, [open.row.id]: v })} sending={pending} onSend={() => send(open.row)}
          onEdit={() => setOpen({ row: open.row, mode: 'edit' })} onDelete={() => setOpen({ row: open.row, mode: 'delete' })} onClose={() => setOpen(null)} />
      )}
      {lead?.mode === 'edit' && <LeadForm row={lead.row} catalogs={catalogs} onClose={() => setLead(null)} onDone={(m) => { setLead(null); notify(m); load(0) }} />}
      {lead?.mode === 'follow' && <LeadFollowUpForm row={lead.row} onClose={() => setLead(null)} onDone={(m) => { setLead(null); notify(m); load(0) }} />}
      {open?.mode === 'edit' && <EditModal r={open.row} notify={notify} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(0) }} />}
      {open?.mode === 'delete' && <DeleteModal r={open.row} notify={notify} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(0) }} />}
    </section>
  )
}

/** Everything about one website lead, with what can be done next: send it to a branch, edit, delete, or close. */
function ViewModal({ r, branches, canAssign, canOpenLead, pick, setPick, sending, onSend, onEdit, onDelete, onClose }: {
  r: WebLeadRow; branches: Branch[]; canAssign: boolean; canOpenLead: boolean
  pick: string; setPick: (v: string) => void; sending: boolean; onSend: () => void
  onEdit: () => void; onDelete: () => void; onClose: () => void
}) {
  const facts: [string, React.ReactNode][] = [
    ['Received', fmtTime(r.submittedAt)], ['Name', r.name], ['Phone', r.phone ?? '—'], ['E-mail', r.email ?? '—'],
    ['Course', r.course ?? '—'], ['Place', r.location ?? '—'],
    ['Website', <span key="w" className="wl-site" title={r.sourceUrl ?? r.siteHost}><Globe size={12} /> {r.siteHost}</span>],
    ['Page', r.sourceUrl ? <a key="p" href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="wl-url">{r.sourceUrl} <ExternalLink size={11} /></a> : '—'],
    ['Campaign', r.campaign ?? '—'],
    ['Branch', r.branchName ? `${r.branchName} (${MATCHED[r.matchedBy ?? ''] ?? 'set'})` : 'Not set yet — waiting for head office'],
    ['Lead', r.enquiryNo ? (canOpenLead ? <Link key="l" href={`/enquiries/update?q=${encodeURIComponent(r.enquiryNo)}`} className="id-text">{r.enquiryNo}</Link> : r.enquiryNo) : 'Not a lead yet'],
  ]
  const canSend = canAssign && !r.enquiryNo && isMobile(r.phone) && (!r.branchId || !!r.problem)
  return (
    <Modal title={`Website lead — ${r.name}`} onClose={onClose}>
      <dl className="wl-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {r.message && <div className="wl-message"><strong>Message</strong><p>{r.message}</p></div>}
      {r.problem && <p className="section-hint" style={{ color: '#b91c1c' }}>{r.problem}</p>}
      {canSend && (
        <div className="wl-send">
          <label>Send to branch<select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Branch">
            <option value="">Choose the branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select></label>
          <button type="button" className="button primary" disabled={sending || !pick} onClick={onSend}><Send size={14} /> {sending ? 'Sending…' : 'Send — make it a lead'}</button>
          <small className="reg-note">It becomes a lead in that branch, ready to call. Set the website on the branch (Branches) and its next leads go there by themselves.</small>
        </div>
      )}
      {!isMobile(r.phone) && !r.enquiryNo && <p className="section-hint">No valid mobile number, so it cannot become a lead until the number is corrected (Edit).</p>}
      <div className="modal-actions">
        {canAssign && <button type="button" className="button secondary" onClick={onEdit}><Pencil size={14} /> Edit</button>}
        {canAssign && !r.enquiryNo && <button type="button" className="button secondary wl-danger" onClick={onDelete}><Trash2 size={14} /> Delete</button>}
        <button type="button" className="button primary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

function EditModal({ r, onClose, onSaved, notify }: { r: WebLeadRow; onClose: () => void; onSaved: () => void; notify: (m: string) => void }) {
  const [f, setF] = useState({ name: r.name, phone: r.phone ?? '', email: r.email ?? '', course: r.course ?? '', location: r.location ?? '', message: r.message ?? '' })
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  const field = (k: keyof typeof f, label: string) => <label>{label}<input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  return (
    <Modal title={`Edit website lead — ${r.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); start(async () => {
        const res = await editWebLeadAction({ id: r.id, ...f })
        if (!res.ok) return setErr(res.error)
        notify(res.data?.isLead ? 'Saved. It is already a lead: change the lead itself in Enquiry Update.' : 'Website lead saved')
        onSaved()
      }) }}>
        <p className="section-hint">Correct the form as it arrived — a typo in the name or number, a missing course.{r.enquiryNo ? ' It is already a lead: this does not change the lead.' : ''}</p>
        <div className="wl-form">
          {field('name', 'Name')}{field('phone', 'Phone')}{field('email', 'E-mail')}{field('course', 'Course')}{field('location', 'Place')}
          <label className="wide">Message (as sent from the website)<textarea rows={3} value={f.message} readOnly disabled /></label>
        </div>
        <Err msg={err} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

function DeleteModal({ r, onClose, onDone, notify }: { r: WebLeadRow; onClose: () => void; onDone: () => void; notify: (m: string) => void }) {
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  return (
    <Modal title="Delete this website lead?" onClose={onClose}>
      <p className="section-hint">{r.name} · {r.phone ?? 'no phone'} · from {r.siteHost}. Delete it only when it is spam or a duplicate; it cannot be brought back.</p>
      <Err msg={err} />
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>Keep it</button>
        <button type="button" className="button primary wl-danger-fill" disabled={pending} onClick={() => start(async () => { const res = await deleteWebLeadAction(r.id); if (!res.ok) return setErr(res.error); notify('Website lead deleted'); onDone() })}>{pending ? 'Deleting…' : 'Delete'}</button>
      </div>
    </Modal>
  )
}

/** '/courses/autocad?utm=x' from a full page address, for a short link text. */
function pagePath(url: string) {
  try { const u = new URL(url); return (u.pathname + u.search).slice(0, 48) || '/' } catch { return url.slice(0, 48) }
}
