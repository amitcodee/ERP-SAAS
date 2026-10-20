'use client'
// Hand cold / unworked enquiries to telecallers, evenly: choose the leads (branch, lead category, status), choose the
// people, assign. Below: what each person has done with the leads they were given.
// Super admin: any branch or all; branch head: own branch.
import { useEffect, useMemo, useState, useTransition } from 'react'
import { Check, PhoneCall, Search, Send, Users } from 'lucide-react'
import { distributeLeadsAction, leadPoolAction, personLeadsAction, poolListAction } from '@/app/actions'
import { Interest } from '@/components/enquiries-panel'
import { Err, Modal } from '@/components/modal'
import type { LeadProgress, PersonLeads, PoolLead, Telecaller } from '@/modules/leads/service'

const STATUS_LABEL = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', not_joined: 'Not joined', dead: 'Dead (re-try)' } as const
type St = keyof typeof STATUS_LABEL
const ENQ_LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead' }
const ENQ_TONE: Record<string, string> = { new: 'status-blue', contacted: 'status-slate', follow_up: 'status-amber', demo: 'status-violet', joined: 'status-green', not_joined: 'status-red', dead: 'status-slate' }

const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtTime = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

type Pool = { available: number; byBranch: { code: string; n: number }[]; byCategory: { name: string; n: number }[] }

export function LeadDistribution({ telecallers, progress, branches, categories, isSuper, notify }: {
  telecallers: Telecaller[]; progress: LeadProgress[]; branches: { id: string; code: string; name: string }[]; categories: { id: string; value: string }[]
  isSuper: boolean; notify: (m: string) => void
}) {
  const [kind, setKind] = useState<'all' | 'lead' | 'visited' | 'call'>('all')
  const [branchId, setBranchId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [statuses, setStatuses] = useState<St[]>(['new', 'follow_up', 'not_joined'])
  const [unassignedOnly, setUnassignedOnly] = useState(true)
  const [olderThanDays, setOlderThanDays] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [find, setFind] = useState('')
  const [perPerson, setPerPerson] = useState(25)
  const [pool, setPool] = useState<Pool | null>(null)
  const [rows, setRows] = useState<PoolLead[]>([]) // the matching leads, for ticking
  const [sel, setSel] = useState<string[]>([])
  const [own, setOwn] = useState<'all' | 'free' | 'taken'>('all') // which leads the list shows
  const [asking, setAsking] = useState(false) // some ticked leads already belong to someone: ask before moving them
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ total: number; result: { name: string; assigned: number }[] } | null>(null)
  const [viewing, setViewing] = useState<LeadProgress | null>(null)
  const [pending, start] = useTransition()
  const filters = { kind, branchId: branchId || null, categoryId: categoryId || null, statuses, unassignedOnly, olderThanDays }

  useEffect(() => {
    let live = true
    if (!statuses.length && kind !== 'call') { setPool({ available: 0, byBranch: [], byCategory: [] }); setRows([]); setSel([]); return }
    const payload = { ...filters, statuses: statuses.length ? statuses : ['new' as St] }
    leadPoolAction(payload).then((r) => { if (!live) return; if (r.ok) { setPool(r.data!); setError('') } else setError(r.error) })
    // The list always shows assigned leads too (with their owner), so they can be ticked and transferred.
    poolListAction({ ...payload, unassignedOnly: false }).then((r) => { if (!live || !r.ok) return; const list = r.data ?? []; setRows(list); setSel((cur) => cur.filter((id) => list.some((x) => x.id === id))) })
    return () => { live = false }
  }, [kind, branchId, categoryId, statuses.join(), unassignedOnly, olderThanDays, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase()
    return q ? telecallers.filter((t) => `${t.name} ${t.branchCode ?? 'head office'}`.toLowerCase().includes(q)) : telecallers
  }, [find, telecallers])
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const allShownPicked = shown.length > 0 && shown.every((t) => picked.includes(t.id))
  const chosen = rows.filter((r) => sel.includes(r.id))
  const taken = chosen.filter((r) => r.assignedToId) // ticked leads somebody already holds
  const free = chosen.filter((r) => !r.assignedToId)
  const takenBy = Object.entries(taken.reduce<Record<string, number>>((m, r) => ({ ...m, [r.assignedTo ?? '—']: (m[r.assignedTo ?? '—'] ?? 0) + 1 }), {}))
  const listed = own === 'all' ? rows : rows.filter((r) => (own === 'taken' ? !!r.assignedToId : !r.assignedToId))
  const allTicked = listed.length > 0 && listed.every((r) => sel.includes(r.id))
  const willAssign = Math.min(sel.length ? chosen.length : pool?.available ?? 0, perPerson * picked.length)
  /** ids = hand out exactly these; none = the oldest matching leads. */
  const assign = (ids?: string[]) => start(async () => {
    const r = await distributeLeadsAction({ ...filters, statuses: statuses.length ? statuses : ['new'], telecallerIds: picked, perPerson, ...(ids ? { leadIds: ids } : {}) })
    setAsking(false)
    if (!r.ok) return setError(r.error)
    setResult(r.data!); setError(''); setSel([]); notify(`${r.data!.total} leads assigned`)
  })

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Admissions / Lead distribution</p><h1>Lead distribution</h1>
          <p className="subheading">Choose leads by branch and lead category, then send them to your team, oldest first. Each person sees them under “My Leads”.</p></div>
      </div>

      <div className="ld-grid">
        <div className="panel">
          <div className="panel-header"><div><h2>1. Which leads</h2><span>Filter the leads you want to hand out.</span></div></div>
          <p className="ld-label" style={{ marginTop: 0 }}>Lead type</p>
          <div className="seg" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
            {([['all', 'Leads + visited'], ['lead', 'Leads'], ['visited', 'Visited enquiries'], ['call', 'Random calls']] as const).map(([k, label]) => (
              <button type="button" key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
          <div className="form-grid">
            {isSuper && <label>Branch<select value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Lead branch"><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>}
            <label>Lead category<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Lead category"><option value="">All categories</option><option value="none">No category yet</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.value}</option>)}</select></label>
            <label>Untouched for at least (days)<input type="number" min={0} value={olderThanDays} onChange={(e) => setOlderThanDays(Math.max(0, Number(e.target.value) || 0))} aria-label="Untouched days" /></label>
          </div>
          {kind === 'call' ? <p className="section-hint" style={{ margin: '16px 0 0' }}>Random calls that have not visited yet and are not dead leads. The person finds them on Random Call with the filter “Given to me to follow up”.</p> : <><p className="ld-label">Lead status</p>
          <div className="quick-picks">
            {(Object.keys(STATUS_LABEL) as St[]).map((s) => (
              <button type="button" key={s} className={statuses.includes(s) ? 'on' : ''} aria-pressed={statuses.includes(s)} onClick={() => setStatuses(statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s])}>{STATUS_LABEL[s]}</button>
            ))}
          </div></>}
          <label className="ld-check"><input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />When nothing is ticked below, send only leads nobody holds yet</label>
          <div className="ld-pool">
            <strong>{pool ? pool.available.toLocaleString('en-IN') : '…'}</strong><span>{unassignedOnly ? 'unassigned leads ready to send' : 'leads match these filters'}</span>
            {pool && pool.byBranch.length > 0 && <p>By branch: {pool.byBranch.map((b) => `${b.code} ${b.n}`).join(' · ')}</p>}
            {pool && pool.byCategory.length > 0 && <p>By category: {pool.byCategory.map((c) => `${c.name} ${c.n}`).join(' · ')}</p>}
          </div>
          <div className="ld-list-head">
            <label className="ld-check" style={{ margin: 0 }}><input type="checkbox" checked={allTicked} disabled={!listed.length} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...listed.map((r) => r.id)])] : sel.filter((id) => !listed.some((r) => r.id === id)))} aria-label="Tick all leads" />{sel.length ? `${sel.length} ticked` : 'Tick all'}</label>
            <div className="quick-picks">
              <button type="button" className={own === 'all' ? 'on' : ''} onClick={() => setOwn('all')}>All ({rows.length})</button>
              <button type="button" className={own === 'free' ? 'on' : ''} onClick={() => setOwn('free')}>Unassigned ({rows.filter((r) => !r.assignedToId).length})</button>
              <button type="button" className={own === 'taken' ? 'on' : ''} onClick={() => setOwn('taken')}>Assigned ({rows.filter((r) => r.assignedToId).length})</button>
            </div>
          </div>
          <p className="section-hint" style={{ margin: '8px 0 0' }}>{sel.length ? 'Only the ticked leads will be sent. Ticking a lead that someone already holds transfers it (you will be asked first).' : 'Assigned leads stay in this list with their owner. Tick leads to send or transfer exactly those, or leave all unticked to send the oldest first.'}</p>
          <div className="ld-list">
            {listed.map((r) => (
              <label key={r.id} className={`ld-lead ${sel.includes(r.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} aria-label={`Lead ${r.name}`} />
                <span className="ld-who"><strong>{r.name}</strong><small>{[r.phone, r.ref, r.branch, r.category].filter(Boolean).join(' · ')}</small></span>
                <span className="ld-lead-side">
                  <span className={`status-badge ${ENQ_TONE[r.status ?? ''] ?? 'status-slate'}`}>{ENQ_LABEL[r.status ?? ''] ?? r.status ?? 'No status'}</span>
                  <small className={r.assignedTo ? 'text-amber' : ''}>{r.assignedTo ? `With ${r.assignedTo}` : 'Unassigned'}</small>
                </span>
              </label>
            ))}
            {!listed.length && <p className="section-hint" style={{ margin: '12px 4px' }}>No leads match these filters.</p>}
            {rows.length >= 500 && <p className="section-hint" style={{ margin: '8px 4px' }}>Showing the oldest 500. Narrow the filters to see the rest.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><div><h2>2. Send to</h2><span>{picked.length ? `${picked.length} selected` : 'Search and tick the people who should get these leads.'}</span></div></div>
          {telecallers.length === 0 ? <p className="section-hint" style={{ margin: 0 }}>Nobody can work leads yet. Give someone the Telecaller role (Users &amp; Staff).</p> : (
            <>
              <div className="ld-search">
                <Search size={15} />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by name or branch…" aria-label="Search people" />
                <button type="button" className="link-button" onClick={() => setPicked(allShownPicked ? picked.filter((id) => !shown.some((t) => t.id === id)) : [...new Set([...picked, ...shown.map((t) => t.id)])])}>{allShownPicked ? 'Clear these' : 'Select all'}</button>
              </div>
              <div className="ld-people" role="listbox" aria-multiselectable="true" aria-label="People to send leads to">
                {shown.map((t) => {
                  const on = picked.includes(t.id)
                  return (
                    <button type="button" key={t.id} role="option" aria-selected={on} aria-label={`Telecaller ${t.name}`} className={`ld-person ${on ? 'on' : ''}`} onClick={() => toggle(t.id)}>
                      <span className="ld-avatar">{initials(t.name)}</span>
                      <span className="ld-who"><strong>{t.name}</strong><small>{t.branchCode ?? 'Head office'}</small></span>
                      <span className="ld-open">{t.openLeads} open</span>
                      <span className="ld-tick">{on && <Check size={14} />}</span>
                    </button>
                  )
                })}
                {!shown.length && <p className="section-hint" style={{ margin: '10px 4px' }}>No one matches “{find}”.</p>}
              </div>
            </>
          )}
          <div className="form-grid" style={{ marginTop: 14 }}>
            <label>Max leads per person<input type="number" min={1} max={500} value={perPerson} onChange={(e) => setPerPerson(Math.min(500, Math.max(1, Number(e.target.value) || 1)))} aria-label="Max leads per person" /></label>
          </div>
          <Err msg={error} />
          <div className="modal-actions">
            <button className="button primary" disabled={pending || !picked.length || !willAssign} onClick={() => (sel.length ? (taken.length ? setAsking(true) : assign(sel)) : assign())}><Send size={15} /> {pending ? 'Assigning…' : `Assign ${willAssign} lead${willAssign === 1 ? '' : 's'}`}</button>
          </div>
          {result && <p role="status" className="section-hint" style={{ margin: '10px 0 0' }}>Assigned {result.total}: {result.result.map((x) => `${x.name} ${x.assigned}`).join(' · ')}</p>}
        </div>
      </div>

      <div className="page-heading" style={{ marginTop: 26 }}>
        <div><h2 style={{ margin: 0 }}>Distributed leads — progress</h2><p className="subheading">What each person has done with the leads they were given. Click a card for the full details.</p></div>
      </div>
      {!progress.length ? <div className="panel"><p className="section-hint" style={{ margin: 0 }}><Users size={14} /> No leads have been distributed yet.</p></div> : (
        <div className="ld-cards">
          {progress.map((p) => (
            <button type="button" key={p.id} className="ld-card" onClick={() => setViewing(p)} aria-label={`Progress of ${p.name}`}>
              <div className="ld-card-head">
                <span className="ld-avatar">{initials(p.name)}</span>
                <span className="ld-who"><strong>{p.name}</strong><small>{p.branchCode ?? 'Head office'} · last activity {fmtTime(p.lastActivity)}</small></span>
                <span className="ld-big">{p.total}<small>leads</small></span>
              </div>
              <div className="ld-bar" title={`${p.worked} of ${p.total} worked`}><i style={{ width: `${pct(p.worked, p.total)}%` }} /></div>
              <p className="ld-bar-note">{pct(p.worked, p.total)}% worked · {p.total - p.worked} not touched yet</p>
              <div className="ld-stats">
                <div><strong>{p.called}</strong><span>Called</span></div>
                <div><strong className={p.due ? 'text-amber' : ''}>{p.due}</strong><span>Follow-ups due</span></div>
                <div><strong>{p.visited}</strong><span>Visited</span></div>
                <div><strong className="text-green">{p.joined}</strong><span>Joined</span></div>
                <div><strong>{p.lost}</strong><span>Lost</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {asking && (
        <Modal title="Some leads already have an owner" onClose={() => setAsking(false)}>
          <p className="section-hint" style={{ margin: 0, fontSize: 13 }}>
            {taken.length} of the {chosen.length} ticked lead{chosen.length === 1 ? '' : 's'} {taken.length === 1 ? 'is' : 'are'} already assigned: {takenBy.map(([n, c]) => `${n} (${c})`).join(', ')}.
            Do you want to transfer {taken.length === 1 ? 'it' : 'them'} as well, or send only the unassigned ones?
          </p>
          <ul className="acct-points" style={{ marginTop: 12 }}>
            <li><strong>Transfer all</strong>: all {chosen.length} go to the people you picked; the current owners lose {taken.length === 1 ? 'that lead' : `those ${taken.length}`}.</li>
            <li><strong>Only unassigned</strong>: {free.length} lead{free.length === 1 ? '' : 's'} {free.length === 1 ? 'is' : 'are'} sent; the {taken.length} already assigned stay where they are.</li>
          </ul>
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={() => setAsking(false)}>Cancel</button>
            <button type="button" className="button secondary" disabled={pending || !free.length} onClick={() => assign(free.map((r) => r.id))}>Only unassigned ({free.length})</button>
            <button type="button" className="button primary" disabled={pending} onClick={() => assign(sel)}>{pending ? 'Assigning…' : `Transfer all (${chosen.length})`}</button>
          </div>
        </Modal>
      )}
      {viewing && <PersonProgress person={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

/** Everything one person did with their leads: the numbers, each lead, and their recent calls and status changes. */
function PersonProgress({ person, onClose }: { person: LeadProgress; onClose: () => void }) {
  const [data, setData] = useState<PersonLeads | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'leads' | 'activity'>('leads')
  const [status, setStatus] = useState('')
  useEffect(() => {
    let live = true
    personLeadsAction(person.id).then((r) => { if (!live) return; if (r.ok && r.data) setData(r.data); else if (!r.ok) setError(r.error) })
    return () => { live = false }
  }, [person.id])
  const leads = data ? (status ? data.leads.filter((l) => l.status === status) : data.leads) : []
  const counts = data ? Object.entries(data.leads.reduce<Record<string, number>>((m, l) => ({ ...m, [l.status]: (m[l.status] ?? 0) + 1 }), {})) : []
  return (
    <Modal title={`${person.name} — lead progress`} onClose={onClose}>
      <dl className="detail-list">
        <div><dt>Leads given</dt><dd>{person.total}</dd></div>
        <div><dt>Worked</dt><dd>{person.worked} ({pct(person.worked, person.total)}%)</dd></div>
        <div><dt>Not touched yet</dt><dd>{person.total - person.worked}</dd></div>
        <div><dt>Called</dt><dd>{person.called}</dd></div>
        <div><dt>Follow-ups due</dt><dd>{person.due}</dd></div>
        <div><dt>Visited the branch</dt><dd>{person.visited}</dd></div>
        <div><dt>Joined</dt><dd>{person.joined}</dd></div>
        <div><dt>Lost (not joined / dead)</dt><dd>{person.lost}</dd></div>
        <div><dt>Last activity</dt><dd>{fmtTime(person.lastActivity)}</dd></div>
      </dl>
      <div style={{ margin: '18px 0 10px' }}>
        <div className="seg">
          <button type="button" className={tab === 'leads' ? 'on' : ''} aria-pressed={tab === 'leads'} onClick={() => setTab('leads')}>Leads ({data?.leads.length ?? '…'})</button>
          <button type="button" className={tab === 'activity' ? 'on' : ''} aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>What they did ({data?.activity.length ?? '…'})</button>
        </div>
      </div>
      {!data && !error && <p className="section-hint" style={{ margin: 0 }}>Loading…</p>}
      <Err msg={error} />
      {data && tab === 'leads' && (
        <>
          <div className="quick-picks" style={{ marginBottom: 10 }}>
            <button type="button" className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>All ({data.leads.length})</button>
            {counts.map(([s, n]) => <button type="button" key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{ENQ_LABEL[s] ?? s} ({n})</button>)}
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Lead</th><th>Status</th><th>Interest</th><th>Call</th><th>Next follow-up</th><th>Given on</th></tr></thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td><div><strong>{l.name}</strong><span style={{ display: 'block' }}>{l.phone}</span></div><small>{l.kind === 'call' ? 'Random call' : `${l.kind === 'visited' ? 'Visited enquiry' : 'Lead'} ${l.enquiryNo}`}{l.branch ? ` · ${l.branch}` : ''}{l.category ? ` · ${l.category}` : ''}</small></td>
                    <td><span className={`status-badge ${ENQ_TONE[l.status] ?? 'status-slate'}`}><span className="status-dot" />{ENQ_LABEL[l.status] ?? l.status}</span>{l.visited && <small className="text-green">Visited</small>}</td>
                    <td><Interest r={l} /></td>
                    <td><span className={`status-badge ${l.callDone ? 'status-green' : 'status-amber'}`}><PhoneCall size={11} /> {l.callDone ? 'Done' : 'Pending'}</span>{l.callAt && <small>{fmtTime(l.callAt)}</small>}{l.callRemark && <small className="lead-remark" title={l.callRemark}>{l.callRemark}</small>}</td>
                    <td>{fmtDay(l.nextFollowUp)}</td>
                    <td>{fmtDay(l.assignedAt)}</td>
                  </tr>
                ))}
                {!leads.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#8b98aa' }}>No leads here.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data && tab === 'activity' && (
        <>
          {!data.activity.length && <p className="section-hint" style={{ margin: 0 }}>No calls or status changes recorded by {person.name} on these leads yet.</p>}
          {data.activity.map((a) => (
            <div className="detail-note" key={a.id} style={{ marginTop: 8 }}>
              <span>{fmtTime(a.at)} · {a.name} ({a.enquiryNo}) · {a.fromStatus && a.fromStatus !== a.toStatus ? `${ENQ_LABEL[a.fromStatus] ?? a.fromStatus} → ` : ''}{ENQ_LABEL[a.toStatus] ?? a.toStatus}</span>
              {[a.note, a.followUpDate && `Next follow-up: ${fmtDay(a.followUpDate)}`].filter(Boolean).join('\n') || '—'}
            </div>
          ))}
        </>
      )}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Close</button></div>
    </Modal>
  )
}
