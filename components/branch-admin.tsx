'use client'
// Head office: create a branch, complete its setup (details, counselor, accountant), then activate it.
// Nobody of a branch can sign in before activation; activation e-mails everyone their login.
import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, CheckCircle2, Circle, Handshake, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FranchiseModal } from '@/components/franchises-panel'
import { activateBranchAction, branchSetupAction, createBranchAction, createUserAction, resendLoginAction, regNumberingAction, setRegNumberingAction, setStaffAccessAction, setUserRolesAction, shareStaffAction, staffElsewhereAction, unshareStaffAction, updateBranchAction, type MailedLogin } from '@/app/actions'
import { codeForCity, nextFreeCode } from '@/lib/branch-code'
import type { RoleOpt } from '@/components/users-panel'
import type { BranchSetup, StaffOption } from '@/modules/branches/service'
import { ListToolbar, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { useLocalList } from '@/components/use-local-list'

export type BranchOpt = {
  id: string; code: string; name: string; city: string | null; address: string | null; phone: string | null
  state: string | null; pincode: string | null; email: string | null; certCode: string | null; websiteUrl: string | null; status: string; setupPct: number
  kind?: 'own' | 'franchise'; partnerName?: string | null
}

const STATES = ['Punjab', 'Chandigarh', 'Haryana', 'Himachal Pradesh', 'Delhi', 'Jammu and Kashmir', 'Rajasthan', 'Uttar Pradesh', 'Uttarakhand']
const g = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? '').trim(); return v || null }

function Progress({ pct, status }: { pct: number; status: string }) {
  if (status === 'active') return <span className="status-badge status-green"><span className="status-dot" />Active</span>
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }} aria-label={`Setup ${pct}% complete`}>
      <span style={{ width: 90, height: 6, background: '#e6e9f2', borderRadius: 4, overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: pct === 100 ? '#16a34a' : '#f59e0b' }} /></span>
      <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600 }}>Setting up · {pct}%</span>
    </span>
  )
}

export function BranchAdmin({ branches, roles, notify }: { branches: BranchOpt[]; roles: RoleOpt[]; notify: (m: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [franchising, setFranchising] = useState(false)
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const list = useLocalList(branches, {
    text: (b) => [b.code, b.name, b.city, b.address, b.state, b.pincode, b.phone, b.email, b.websiteUrl].filter(Boolean).join(' '),
    filters: { status: (b, v) => (v === 'active' ? b.status === 'active' : b.status !== 'active'), state: (b, v) => b.state === v },
    sorts: { code: (b) => b.code, name: (b) => b.name, city: (b) => b.city, setup: (b) => (b.status === 'active' ? 101 : b.setupPct) },
  })
  const opened = branches.find((b) => b.id === openId)
  if (opened) return <BranchDetail branch={opened} roles={roles} notify={notify} onBack={() => setOpenId(null)} />
  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Setup / Branches</p><h1>Branches</h1>
          <p className="subheading">Create a branch, then complete its setup: details, a counselor and an accountant. Its logins work only after you activate it.</p></div>
        <div className="heading-actions">
          {/* a franchise: the partner's name on its receipts and a royalty (Franchises) */}
          {branches.some((b) => b.kind !== 'franchise') && <button className="button secondary" onClick={() => setFranchising(true)}><Handshake size={16} /> Make a franchise</button>}
          <button className="button primary" onClick={() => setAdding((o) => !o)}><Plus size={17} /> Add branch</button>
        </div>
      </div>
      {franchising && <FranchiseModal f={null} branches={branches.filter((b) => b.kind !== 'franchise').map((b) => ({ id: b.id, name: b.name }))} onClose={() => setFranchising(false)} onDone={(m) => { setFranchising(false); notify(`${m}: see Franchises for its royalty`); router.refresh() }} />}
      {adding && <NewBranchForm branches={branches} onDone={(id, code) => { setAdding(false); notify(`Branch created: ${code}`); setOpenId(id) }} onCancel={() => setAdding(false)} />}
      <div className="panel table-panel">
        <ListToolbar list={list} placeholder="Search code, name, city, phone…"
          filters={[
            { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'setup', label: 'Setting up' }] },
            { key: 'state', label: 'State', options: [...new Set(branches.map((b) => b.state).filter((s): s is string => !!s))].sort().map((s) => ({ value: s, label: s })) },
          ]}
          sorts={[{ key: 'code', label: 'Code', dir: 'asc' }, { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'city', label: 'City', dir: 'asc' }, { key: 'setup', label: 'Least set up first', dir: 'asc' }]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="code">Code</SortTh><SortTh list={list} k="name">Name</SortTh><SortTh list={list} k="city">Location</SortTh><th>Contact</th><SortTh list={list} k="setup">Setup</SortTh><th /></tr></thead>
            <tbody>
              {list.rows.map((b) => (
                <tr key={b.id}>
                  <td><strong className="id-text">{b.code}</strong></td>
                  <td>{b.name}{b.kind === 'franchise' && <small style={{ display: 'block' }}><span className="status-badge status-blue"><span className="status-dot" />Franchise</span> {b.partnerName}</small>}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 240 }}>{[b.address, b.city, b.state, b.pincode].filter(Boolean).join(', ') || '—'}</td>
                  <td>{b.phone ?? '—'}<br /><span style={{ color: '#8b98aa' }}>{b.email ?? 'no e-mail'}</span></td>
                  <td><Progress pct={b.setupPct} status={b.status} /></td>
                  <td><button className="filter-button" onClick={() => setOpenId(b.id)}>{b.status === 'active' ? 'View / edit' : 'Continue setup'}</button></td>
                </tr>
              ))}
              {!list.rows.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No branches match these filters.' : 'No branches yet — add your first one.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={false} setPage={list.setPage} noun="branches" />
      </div>
    </section>
  )
}

function DetailsFields({ b, cityLocked, preview, certCode, setCertCode }: { b?: BranchOpt; cityLocked?: boolean; preview?: string; certCode: string; setCertCode: (v: string) => void }) {
  return (
    <>
      <div className="form-grid">
        <label>Branch name<span className="required-mark">*</span><input name="name" required defaultValue={b?.name} placeholder="e.g. Ludhiana Model Town" /></label>
        {cityLocked ? <label>City<input value={b?.city ?? ''} readOnly aria-label="City (fixed)" /></label> : null}
        <label>Certificate code<input value={certCode} onChange={(e) => setCertCode(e.target.value.toUpperCase())} maxLength={10} placeholder={preview || b?.code || 'Same as branch code'} aria-label="Certificate code" /></label>
        <label>State<span className="required-mark">*</span><input name="state" required list="branch-states" defaultValue={b?.state ?? 'Punjab'} /></label>
        <datalist id="branch-states">{STATES.map((s) => <option key={s} value={s} />)}</datalist>
        <label>PIN code<span className="required-mark">*</span><input name="pincode" required inputMode="numeric" maxLength={6} pattern="[1-9][0-9]{5}" defaultValue={b?.pincode ?? ''} placeholder="141001" /></label>
        <label>Phone<span className="required-mark">*</span><input name="phone" type="tel" required defaultValue={b?.phone ?? ''} placeholder="10-digit mobile" /></label>
        <label>Branch e-mail (branch admin login)<span className="required-mark">*</span><input name="email" type="email" required defaultValue={b?.email ?? ''} placeholder="ludhiana@yourinstitute.com" /></label>
        <label>Branch website<input name="websiteUrl" inputMode="url" autoComplete="off" defaultValue={b?.websiteUrl ?? ''} placeholder="https://…" />
          <small className="reg-note">Leads sent from this website&apos;s forms come to this branch (Web Leads).</small></label>
      </div>
      <label className="full-label">Full address<span className="required-mark">*</span><textarea name="address" required defaultValue={b?.address ?? ''} placeholder="Building, street, area" /></label>
    </>
  )
}

function NewBranchForm({ branches, onDone, onCancel }: { branches: BranchOpt[]; onDone: (id: string, code: string) => void; onCancel: () => void }) {
  const [city, setCity] = useState('')
  const [certCode, setCertCode] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const base = codeForCity(city)
  const preview = base ? nextFreeCode(base, branches.map((b) => b.code)) : ''
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r = await createBranchAction({ name: g(fd, 'name') ?? '', city, address: g(fd, 'address') ?? '', state: g(fd, 'state') ?? '', pincode: g(fd, 'pincode') ?? '', phone: g(fd, 'phone') ?? '', email: g(fd, 'email') ?? '', certCode: certCode.trim() || null, websiteUrl: g(fd, 'websiteUrl') })
      if (!r.ok) return setError(r.error)
      onDone(r.data!.id, r.data!.code)
    })
  }
  return (
    <form className="panel" style={{ padding: 18, marginBottom: 16 }} onSubmit={submit}>
      <p className="section-hint" style={{ margin: '0 0 12px' }}>Step 1 of 3 · Branch details. The branch code is set from the city. A branch admin login is prepared for the branch e-mail and sent when the branch is activated.</p>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>City<span className="required-mark">*</span><input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Ludhiana" aria-label="City" /></label>
        <label>Branch code (automatic)<input value={preview} readOnly placeholder="Set from the city" aria-label="Branch code (automatic)" /></label>
      </div>
      <DetailsFields preview={preview} certCode={certCode} setCertCode={setCertCode} />
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Create branch & continue setup'}</button></div>
    </form>
  )
}

function BranchDetail({ branch, roles, notify, onBack }: { branch: BranchOpt; roles: RoleOpt[]; notify: (m: string) => void; onBack: () => void }) {
  const [setup, setSetup] = useState<BranchSetup | null>(null)
  const [certCode, setCertCode] = useState(branch.certCode ?? '')
  const [adding, setAdding] = useState<string[] | null>(null) // preset roles of the member being added
  const [mailed, setMailed] = useState<{ title: string; list: MailedLogin[] } | null>(null)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const load = async () => { const r = await branchSetupAction(branch.id); if (r.ok) setSetup(r.data!); else setError(r.error) }
  useEffect(() => { void load() }, [branch.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = (k: string) => roles.find((r) => r.key === k)?.name ?? k
  // The open "Add counselor / accountant" box: pick someone of this branch's team, or of another branch.
  const [step, setStep] = useState<{ key: string; options: StaffOption[] | null; pick: string } | null>(null)
  const openStep = (key: string) => {
    setStep({ key, options: null, pick: '' })
    void staffElsewhereAction(branch.id, key).then((r) => {
      if (!r.ok) return setError(r.error)
      setStep((cur) => (cur?.key === key ? { ...cur, options: r.data! } : cur))
    })
  }
  // Someone of this branch gets the role added; someone of another branch is shared with this branch.
  const choose = (userId: string, role: string) => start(async () => {
    const own = setup?.team.find((m) => m.id === userId)
    if (own) {
      const r = await setUserRolesAction(own.id, [...own.roles, role])
      if (!r.ok) return setError(r.error)
      notify(`${own.name} is now also ${label(role)}`)
    } else {
      const r = await shareStaffAction(branch.id, userId)
      if (!r.ok) return setError(r.error)
      notify(`${r.data!.name} now also works in ${branch.name}`)
    }
    setError(''); setStep(null); await load()
  })
  const unshare = (m: { id: string; name: string }) => start(async () => {
    const r = await unshareStaffAction(branch.id, m.id)
    if (!r.ok) return setError(r.error)
    setError(''); notify(`${m.name} no longer works in ${branch.name}`); await load()
  })

  // a person shared with this branch sees only their own work here, unless head office opens all of it to them
  const setAccess = (m: { id: string; name: string }, access: 'own' | 'full') => start(async () => {
    const r = await setStaffAccessAction(branch.id, m.id, access)
    if (!r.ok) return setError(r.error)
    setError(''); notify(access === 'full' ? `${m.name} now sees all of ${branch.name}'s work their role allows` : `${m.name} now sees only their own work in ${branch.name}`); await load()
  })

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      const r = await updateBranchAction({ id: branch.id, name: g(fd, 'name') ?? '', address: g(fd, 'address') ?? '', state: g(fd, 'state') ?? '', pincode: g(fd, 'pincode') ?? '', phone: g(fd, 'phone') ?? '', email: g(fd, 'email') ?? '', certCode: certCode.trim() || null, websiteUrl: g(fd, 'websiteUrl') })
      if (!r.ok) return setError(r.error)
      setError(''); notify('Branch details saved'); await load()
    })
  }

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div>
          <button className="text-button" onClick={onBack} style={{ marginBottom: 8 }}><ArrowLeft size={14} /> All branches</button>
          <h1>{branch.name} <span style={{ color: '#8b98aa', fontSize: 16 }}>{branch.code}</span></h1>
          <p className="subheading">{setup ? <Progress pct={setup.pct} status={setup.status} /> : 'Loading…'}</p>
        </div>
        {setup && setup.status !== 'active' && (
          <div className="heading-actions">
            <button className="button primary" disabled={pending || !setup.ready} title={setup.ready ? 'Open the branch and e-mail the logins' : 'Complete all three steps first'}
              onClick={() => start(async () => {
                const r = await activateBranchAction(branch.id)
                if (!r.ok) return setError(r.error)
                setMailed({ title: `${branch.code} is active`, list: r.data! }); notify(`Branch ${branch.code} activated`); await load()
              })}>{pending ? 'Activating…' : 'Activate branch & send logins'}</button>
          </div>
        )}
      </div>

      {mailed && (
        <div className="panel" role="status" style={{ padding: 14, marginBottom: 14, background: '#f0fdf4', borderColor: '#bbf7d0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ fontSize: 13 }}>{mailed.title}</strong><button className="icon-button" onClick={() => setMailed(null)} aria-label="Dismiss"><X size={16} /></button></div>
          {mailed.list.length === 0 && <p style={{ fontSize: 12, margin: '6px 0 0' }}>Everyone has already signed in before; no logins needed sending.</p>}
          {mailed.list.map((m) => (
            <p key={m.email} style={{ fontSize: 12, margin: '6px 0 0' }}>{m.emailed ? `Login e-mailed to ${m.name} (${m.email}).` : <>Could not e-mail {m.name}{m.error ? ` (${m.error})` : ''}. Give them: username <code>{m.email}</code> · one-time password <code>{m.password}</code></>}</p>
          ))}
        </div>
      )}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 12 }}>{error}</p>}

      {setup && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, margin: '0 0 10px' }}>Setup checklist</h2>
          {setup.steps.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i ? '1px solid #f0f2f5' : 0, fontSize: 12 }}>
              {s.done ? <CheckCircle2 size={18} color="#16a34a" /> : <Circle size={18} color="#cbd5e1" />}
              <span style={{ flex: 1 }}><strong>{i + 1}. {s.label}</strong>{s.people.length > 0 && <span style={{ color: '#58677c' }}> — {s.people.join(', ')}</span>}</span>
              {s.key !== 'details' && <button className="filter-button" aria-expanded={step?.key === s.key} onClick={() => (step?.key === s.key ? setStep(null) : openStep(s.key))}><Plus size={13} /> Add {s.key}</button>}
              {step?.key === s.key && (() => {
                const team = setup.team.filter((m) => m.isActive && !m.home && !m.roles.includes(s.key))
                return (
                  <div className="bs-add">
                    <strong className="bs-title">Choose the {s.key}</strong>
                    <p className="section-hint" style={{ margin: '4px 0 12px' }}>Pick someone from this branch’s team, or a {s.key} of another branch (they keep their own branch and login, and also work in {branch.name}). A new person must first be added under “Branch team”.</p>
                    {!step.options ? <p className="bs-empty">Loading…</p> : !step.options.length && !team.length ? <p className="bs-empty">Nobody to choose yet. Add the person under “Branch team” first.</p> : (
                      <div className="bs-pick">
                        <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                          <select aria-label={`Choose the ${s.key}`} value={step.pick} disabled={pending} onChange={(e) => setStep({ ...step, pick: e.target.value })}>
                            <option value="">Select a person…</option>
                            {team.length > 0 && <optgroup label="This branch’s team">{team.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.roles.map(label).join(', ')}</option>)}</optgroup>}
                            {step.options.length > 0 && <optgroup label={`${label(s.key)}s of other branches`}>{step.options.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.email} (branch {o.home})</option>)}</optgroup>}
                          </select>
                        </div>
                        <button className="button primary" disabled={pending || !step.pick} onClick={() => choose(step.pick, s.key)}>{pending ? 'Saving…' : `Set as ${s.key}`}</button>
                      </div>
                    )}
                    <div className="modal-actions" style={{ marginTop: 12 }}><button type="button" className="button secondary" onClick={() => setStep(null)}>Cancel</button></div>
                  </div>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <form className="panel" onSubmit={save}>
          <h2 style={{ fontSize: 13, margin: '0 0 12px' }}>Branch details</h2>
          <DetailsFields b={branch} cityLocked certCode={certCode} setCertCode={setCertCode} />
          <div className="modal-actions"><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save details'}</button></div>
        </form>
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: 13, margin: 0 }}>Branch team</h2>
            <button className="filter-button" onClick={() => setAdding([])}><Plus size={13} /> Add team member</button>
          </div>
          {setup?.team.length ? setup.team.map((m) => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '1px solid #f0f2f5', fontSize: 11 }}>
              <span style={{ flex: 1 }}><strong>{m.name}</strong> <span style={{ color: '#8b98aa' }}>{m.email}{m.phone ? ` · ${m.phone}` : ''}</span><br />{m.roles.map(label).join(', ')}{!m.isActive && ' · deactivated'}{m.home && <> · <span className="status-badge status-blue">Shared from {m.home}</span></>}</span>
              {m.home && <select aria-label={`What ${m.name} sees in ${branch.name}`} title="Own work: only the leads, calls, students, batches and tickets that are theirs. Full: everything their role allows here." value={m.access ?? 'own'} disabled={pending} onChange={(e) => setAccess(m, e.target.value as 'own' | 'full')}><option value="own">Own work only</option><option value="full">Full access</option></select>}
              {m.home
                ? <button className="filter-button" disabled={pending} title="They keep their own branch; they just stop working in this one" onClick={() => unshare(m)}>Remove</button>
                : <span style={{ color: m.signedIn ? '#16a34a' : '#8b98aa' }}>{m.signedIn ? 'Signed in' : setup.status === 'active' ? 'Login sent' : 'Waiting for activation'}</span>}
              {setup.status === 'active' && !m.signedIn && !m.home && <button className="filter-button" disabled={pending} onClick={() => start(async () => { const r = await resendLoginAction(m.id); if (!r.ok) return setError(r.error); setMailed({ title: `Login sent again to ${m.name}`, list: r.data! }) })}>Resend login</button>}
            </div>
          )) : <p style={{ fontSize: 11, color: '#8b98aa' }}>Nobody yet.</p>}
          {adding && <MemberForm branchId={branch.id} roles={roles} preset={adding} onDone={async (msg) => { setAdding(null); notify(msg); await load() }} onCancel={() => setAdding(null)} />}
        </div>
      </div>
      <RegNumbers branchId={branch.id} notify={notify} />
    </section>
  )
}

/**
 * How this branch numbers its registrations (head office). A format with {n} carries on an old series, e.g.
 * TCD/4002/{n} from 2586; numbers already used are never given again.
 */
function RegNumbers({ branchId, notify }: { branchId: string; notify: (m: string) => void }) {
  const [d, setD] = useState<{ format: string | null; defaultFormat: string; next: string; example: string; code: string } | null>(null)
  const [format, setFormat] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => { void regNumberingAction(branchId).then((r) => { if (r.ok && r.data) { setD(r.data); setFormat(r.data.format ?? '') } }) }, [branchId])
  const f = format.trim() || d?.defaultFormat || ''
  const n = Number(next) || 1
  const sample = f.replace('{yyyy}', String(new Date().getFullYear())).replace('{yy}', String(new Date().getFullYear()).slice(2)).replace('{code}', d?.code ?? '').replace('{nnnn}', String(n).padStart(4, '0')).replace('{n}', String(n))
  const save = () => start(async () => {
    setError('')
    const r = await setRegNumberingAction(branchId, format.trim() || null, next.trim() ? Number(next) : null)
    if (!r.ok) return setError(r.error)
    setD(r.data!); setNext(''); notify(`Registration numbers saved: the next one is ${r.data!.next}`)
  })
  if (!d) return null
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h2 style={{ fontSize: 13, margin: '0 0 6px' }}>Registration numbers</h2>
      <p className="section-hint" style={{ margin: '0 0 12px' }}>
        The next registration gets <b>{d.next}</b>. To carry on your old numbering, give the format and the next number — e.g. <code>TCD/4002/{'{n}'}</code> from <code>2586</code>.
        Parts: <code>{'{n}'}</code> the number as is, <code>{'{nnnn}'}</code> 4 digits, <code>{'{yyyy}'}</code> / <code>{'{yy}'}</code> the year (count restarts each year), <code>{'{code}'}</code> the branch code ({d.code}). Empty = the default <code>{d.defaultFormat}</code>.
        A number already used is never given again.
      </p>
      <div className="form-grid">
        <label>Number format<input value={format} maxLength={40} placeholder={d.defaultFormat} onChange={(e) => { setFormat(e.target.value); setError('') }} /></label>
        <label>Next number (optional)<input value={next} inputMode="numeric" placeholder="Leave empty to carry on" onChange={(e) => { setNext(e.target.value.replace(/\D/g, '')); setError('') }} /></label>
        <label>Will look like<input value={sample} readOnly disabled /></label>
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="modal-actions"><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save numbering'}</button></div>
    </div>
  )
}

/** Team member for this branch: name, e-mail, phone and one or more roles. */
export function MemberForm({ branchId, roles, preset, onDone, onCancel }: { branchId: string; roles: RoleOpt[]; preset: string[]; onDone: (m: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>(preset)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null)
  const [pending, start] = useTransition()
  const staff = roles.filter((r) => r.grantable && r.kind === 'staff')
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (!picked.length) return setError('Tick at least one role')
    start(async () => {
      const r = await createUserAction({ name: g(fd, 'name') ?? '', email: g(fd, 'email') ?? '', phone: g(fd, 'phone'), roles: picked, branchId })
      if (!r.ok) return setError(r.error)
      const d = r.data!
      if (d.status === 'show') return setShown({ email: d.email, password: d.tempPassword! })
      onDone(d.status === 'emailed' ? `Added; login e-mailed to ${d.email}` : `Added; ${d.email} gets their login when the branch is activated`)
    })
  }
  if (shown) return (
    <div className="review-card" style={{ marginTop: 12, display: 'block' }}>
      <p style={{ fontSize: 11, margin: '0 0 6px' }}>The e-mail could not be sent. Give <strong>{shown.email}</strong> this one-time password (shown only now):</p>
      <code style={{ userSelect: 'all' }}>{shown.password}</code>
      <div className="modal-actions"><button className="button primary" onClick={() => onDone(`Added ${shown.email}`)}>Done</button></div>
    </div>
  )
  return (
    <form onSubmit={submit} style={{ marginTop: 12, borderTop: '1px solid #edf0f4', paddingTop: 12 }}>
      <div className="form-grid">
        <label>Full name<span className="required-mark">*</span><input name="name" required /></label>
        <label>E-mail (login)<span className="required-mark">*</span><input name="email" type="email" required autoComplete="off" /></label>
        <label>Phone<input name="phone" type="tel" placeholder="10-digit mobile" /></label>
      </div>
      <fieldset style={{ margin: '16px 0 0', padding: 0, border: 0 }}>
        <legend className="full-label" style={{ padding: 0 }}><span>Roles<span className="required-mark">*</span></span></legend>
        <p className="section-hint" style={{ margin: '4px 0 10px' }}>Tick one or more; e.g. Counselor + Accountant + Trainer</p>
        <div className="rp-ticks">
          {staff.map((r) => (
            <label key={r.key} title={r.description ?? ''} className={`rp-tick${picked.includes(r.key) ? ' on' : ''}`}>
              <input type="checkbox" checked={picked.includes(r.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.key] : picked.filter((k) => k !== r.key))} />{r.name}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 8 }}>{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Adding…' : 'Add member'}</button></div>
    </form>
  )
}
