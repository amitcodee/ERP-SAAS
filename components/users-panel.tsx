'use client'

import { useState, useTransition } from 'react'
import { Building2, KeyRound, Plus, Power, PowerOff, ShieldCheck, X } from 'lucide-react'
import { createUserAction, deleteUserAction, resetUserPasswordAction, setHomeBranchAction, setStaffAccessAction, setUserActiveAction, setUserRolesAction, shareStaffAction, unshareStaffAction, type NewMember } from '@/app/actions'
import { useRouter } from 'next/navigation'
import { DeleteButton } from '@/components/delete-button'
import { Err, Modal } from '@/components/modal'
import { ListToolbar, SortTh } from '@/components/list-toolbar'
import { Pager } from '@/components/pager'
import { useLocalList } from '@/components/use-local-list'
import type { StaffRow } from '@/modules/users/service'

/** A role this viewer may hand out (computed on the server: no privilege escalation). */
export type RoleOpt = { key: string; name: string; kind: string; description: string | null; grantable: boolean }

export function UsersPanel({ rows, roles, branches, isSuper, canCreate, canEdit, canBranches, currentUserId, actingBranchId, notify }: {
  rows: StaffRow[]; roles: RoleOpt[]; branches: { id: string; code: string; name: string }[]; isSuper: boolean; canCreate: boolean; canEdit: boolean
  /** Head office: may add or remove the other branches a staff member works in. */
  canBranches: boolean
  currentUserId: string; actingBranchId: string | null; notify: (m: string) => void
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [branching, setBranching] = useState<StaffRow | null>(null)
  const [created, setCreated] = useState<NewMember | null>(null)
  const [pending, start] = useTransition()
  const [resetInfo, setResetInfo] = useState<{ email: string; tempPassword: string } | null>(null)
  const label = (k: string) => roles.find((r) => r.key === k)?.name ?? k
  const grantable = roles.filter((r) => r.grantable && r.kind !== 'student')
  const branchOf = (u: StaffRow) => (u.branchCode ? `${u.branchCode} — ${u.branchName}` : 'Head office')
  // a branch changes only the logins made in the branch; head office's own (and those it made for the branch) stay locked
  const mayChange = (u: StaffRow) => isSuper || u.branchMade
  const list = useLocalList(rows, {
    text: (u) => `${u.name} ${u.email} ${u.phone ?? ''} ${u.roles.map(label).join(' ')}`,
    filters: {
      role: (u, v) => u.roles.includes(v as StaffRow['roles'][number]),
      branch: (u, v) => (v === 'ho' ? !u.branchCode : u.branchCode === v || u.alsoBranches.some((b) => b.code === v)),
      status: (u, v) => (v === 'active' ? u.isActive : v === 'inactive' ? !u.isActive : v === 'never' ? !u.lastLoginAt : true),
    },
    date: (u) => u.createdAt,
    sorts: { name: (u) => u.name, email: (u) => u.email, branch: (u) => branchOf(u), status: (u) => (u.isActive ? 0 : 1), joined: (u) => u.createdAt, login: (u) => u.lastLoginAt },
  })
  const branchOpts = [...new Map(rows.map((u) => [u.branchCode ?? 'ho', branchOf(u)])).entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Administration / Users &amp; staff</p><h1>Users &amp; staff</h1><p className="subheading">A person can hold several roles (e.g. Counselor + Telecaller + Branch Manager) and gets everything those roles allow.</p></div>
        <div className="heading-actions">{canCreate && <button className="button primary" onClick={() => setAdding(true)}><Plus size={17} /> Add staff</button>}</div>
      </div>
      <div className="panel table-panel">
        <ListToolbar list={list} exportList="staff" placeholder="Search name, e-mail, phone or role…" dateLabel="Added"
          filters={[
            { key: 'role', label: 'Role', options: roles.map((r) => ({ value: r.key, label: r.name })) },
            ...(branchOpts.length > 1 ? [{ key: 'branch', label: 'Branch', options: branchOpts }] : []),
            { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'never', label: 'Never signed in' }] },
          ]}
          sorts={[
            { key: 'name', label: 'Name A–Z', dir: 'asc' }, { key: 'name', label: 'Name Z–A', dir: 'desc' }, { key: 'email', label: 'E-mail', dir: 'asc' },
            { key: 'branch', label: 'Branch', dir: 'asc' }, { key: 'joined', label: 'Newest first', dir: 'desc' }, { key: 'joined', label: 'Oldest first', dir: 'asc' },
            { key: 'login', label: 'Last sign-in, latest', dir: 'desc' },
          ]} />
        <div className="table-scroll">
          <table>
            <thead><tr><SortTh list={list} k="name">Name</SortTh><SortTh list={list} k="email">Email</SortTh><th>Roles</th><SortTh list={list} k="branch">Branch</SortTh><SortTh list={list} k="status">Status</SortTh><th /></tr></thead>
            <tbody>
              {list.rows.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong>{u.phone && <small style={{ display: 'block' }}>{u.phone}</small>}</td>
                  <td>{u.email}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{u.roles.map(label).join(', ')}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <div>{branchOf(u)}{u.alsoBranches.length > 0 && <small style={{ display: 'block', marginTop: 3 }} title={u.alsoBranches.map((b) => `${b.code} — ${b.name}`).join(', ')}>Also works in: {u.alsoBranches.map((b) => b.code).join(', ')}</small>}</div>
                      {canBranches && u.branchId && !u.roles.includes('student') && <button type="button" className="filter-button icon-only" title="See and change the branches this person works in" aria-label={`Branches of ${u.name}`} onClick={() => setBranching(u)}><Building2 size={14} /></button>}
                    </div>
                  </td>
                  <td><span className={`status-badge ${u.isActive ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{u.isActive ? 'Active' : 'Inactive'}</span><small style={{ display: 'block', marginTop: 3 }}>{u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Never signed in'}</small></td>
                  <td>{canEdit && u.id !== currentUserId && !mayChange(u) && <small style={{ color: '#8b98aa' }} title="Only head office can change this login">Made by head office</small>}
                    {canEdit && u.id !== currentUserId && mayChange(u) && (<div style={{ display: 'flex', gap: 6 }}>
                    {!u.roles.includes('student') && <button type="button" className="filter-button icon-only" disabled={pending} title="Edit roles" aria-label={`Edit roles of ${u.name}`} onClick={() => setEditing(u)}><ShieldCheck size={14} /></button>}
                    <button type="button" className="filter-button icon-only" disabled={pending} title="Reset password" aria-label={`Reset password of ${u.name}`} onClick={() => start(async () => { const r = await resetUserPasswordAction(u.id); if (r.ok) setResetInfo(r.data!); else notify(r.error) })}><KeyRound size={14} /></button>
                    <button type="button" className={`filter-button icon-only${u.isActive ? ' danger' : ''}`} disabled={pending} title={u.isActive ? 'Deactivate' : 'Activate'} aria-label={`${u.isActive ? 'Deactivate' : 'Activate'} ${u.name}`} onClick={() => start(async () => { const r = await setUserActiveAction(u.id, !u.isActive); notify(r.ok ? (u.isActive ? 'User deactivated' : 'User activated') : r.error) })}>{u.isActive ? <PowerOff size={14} /> : <Power size={14} />}</button>
                    <DeleteButton what={`Login of ${u.name}`} run={() => deleteUserAction(u.id)} onDone={() => router.refresh()} />
                  </div>)}</td>
                </tr>
              ))}
              {!list.rows.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#8b98aa' }}>{list.filtered ? 'No staff match these filters.' : 'No staff yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={list.page} pages={list.pages} total={list.total} shown={list.rows.length} loading={false} setPage={list.setPage} noun="people" />
      </div>
      {adding && <StaffForm roles={grantable} branches={branches} isSuper={isSuper} defaultBranch={actingBranchId} onClose={() => setAdding(false)} onCreated={(c) => { setAdding(false); setCreated(c) }} />}
      {branching && <BranchesForm user={branching} branches={branches} onClose={() => setBranching(null)} notify={notify} onChanged={() => router.refresh()} />}
      {editing && <RolesForm user={editing} roles={grantable} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); notify(m) }} />}
      {resetInfo && (
        <Modal title="Password reset" onClose={() => setResetInfo(null)}>
          <p className="section-hint" style={{ margin: '-8px 0 12px' }}>Give <strong>{resetInfo.email}</strong> this one-time password. They will be asked to choose their own at next sign-in, and any open session of theirs has been signed out.</p>
          <div className="review-card"><code style={{ fontSize: 14, userSelect: 'all' }}>{resetInfo.tempPassword}</code></div>
          <div className="modal-actions"><button className="button primary" onClick={() => setResetInfo(null)}>Done</button></div>
        </Modal>
      )}
      {created && (
        <Modal title="Team member added" onClose={() => setCreated(null)}>
          {created.status === 'emailed' && <p className="section-hint" style={{ margin: '-8px 0 12px' }}>Their login (sign-in link, username and one-time password) was e-mailed to <strong>{created.email}</strong>.</p>}
          {created.status === 'pending_activation' && <p className="section-hint" style={{ margin: '-8px 0 12px' }}>Their branch is still being set up. <strong>{created.email}</strong> gets their login by e-mail when the branch is activated.</p>}
          {created.status === 'show' && (<>
            <p className="section-hint" style={{ margin: '-8px 0 12px' }}>The e-mail could not be sent{created.error ? ` (${created.error})` : ''}. Share this one-time password with <strong>{created.email}</strong> now. It is shown only once.</p>
            <div className="review-card" style={{ justifyContent: 'space-between' }}><code style={{ fontSize: 14, userSelect: 'all' }}>{created.tempPassword}</code></div>
          </>)}
          <div className="modal-actions"><button className="button primary" onClick={() => setCreated(null)}>Done</button></div>
        </Modal>
      )}
    </section>
  )
}

function RolePicks({ roles, picked, setPicked }: { roles: RoleOpt[]; picked: string[]; setPicked: (k: string[]) => void }) {
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: '#58677c' }}>Roles (tick one or more)<span className="required-mark">*</span></span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6, marginTop: 6 }}>
        {roles.map((r) => (
          <label key={r.key} title={r.description ?? ''} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 500 }}>
            <input type="checkbox" checked={picked.includes(r.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.key] : picked.filter((k) => k !== r.key))} />{r.name}
          </label>
        ))}
      </div>
    </div>
  )
}

function StaffForm({ roles, branches, isSuper, defaultBranch, onClose, onCreated }: {
  roles: RoleOpt[]; branches: { id: string; code: string; name: string }[]; isSuper: boolean; defaultBranch: string | null
  onClose: () => void; onCreated: (c: NewMember) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const superPicked = picked.some((k) => roles.find((r) => r.key === k)?.kind === 'super')
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    if (!picked.length) return setError('Tick at least one role')
    start(async () => {
      const res = await createUserAction({ name: String(fd.get('name') ?? ''), email: String(fd.get('email') ?? ''), phone: String(fd.get('phone') ?? '') || null, roles: picked, branchId: String(fd.get('branch') ?? '') || null })
      if (!res.ok) return setError(res.error)
      onCreated(res.data!)
    })
  }
  return (
    <Modal title="Add staff" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>Full name<span className="required-mark">*</span><input name="name" required /></label>
          <label>Email<span className="required-mark">*</span><input name="email" type="email" required autoComplete="off" /></label>
          <label>Phone<input name="phone" type="tel" placeholder="10-digit mobile" /></label>
          {isSuper && !superPicked && (
            <label>Branch / centre<span className="required-mark">*</span><select name="branch" required defaultValue={defaultBranch ?? ''}><option value="" disabled>Select branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select></label>
          )}
          <RolePicks roles={roles} picked={picked} setPicked={setPicked} />
        </div>
        <Err msg={error} />
        <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Creating…' : 'Create account'}</button></div>
      </form>
    </Modal>
  )
}

function RolesForm({ user, roles, onClose, onDone }: { user: StaffRow; roles: RoleOpt[]; onClose: () => void; onDone: (m: string) => void }) {
  const [picked, setPicked] = useState<string[]>(user.roles)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const shown = roles.concat(user.roles.filter((k) => !roles.some((r) => r.key === k)).map((k) => ({ key: k, name: k, kind: 'staff', description: 'You cannot grant this role', grantable: false })))
  return (
    <Modal title={`Roles · ${user.name}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 12px' }}>Changes apply on their next click; no need to sign out.</p>
      <div className="form-grid"><RolePicks roles={shown} picked={picked} setPicked={setPicked} /></div>
      <Err msg={error} />
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
        <button className="button primary" disabled={pending || !picked.length} onClick={() => start(async () => {
          const r = await setUserRolesAction(user.id, picked)
          if (!r.ok) return setError(r.error)
          onDone(`Roles updated for ${user.name}`)
        })}>{pending ? 'Saving…' : 'Save roles'}</button>
      </div>
    </Modal>
  )
}

/** The branches a staff member works in: their home branch (fixed) and the others they are shared with. Head office. */
function BranchesForm({ user, branches, onClose, notify, onChanged }: {
  user: StaffRow; branches: { id: string; code: string; name: string }[]; onClose: () => void; notify: (m: string) => void; onChanged: () => void
}) {
  const [also, setAlso] = useState(user.alsoBranches)
  const [home, setHome] = useState(branches.find((b) => b.id === user.branchId) ?? { id: user.branchId!, code: user.branchCode ?? '', name: user.branchName ?? '' })
  const [pick, setPick] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const free = branches.filter((b) => b.id !== home.id && !also.some((a) => a.id === b.id))
  const add = () => start(async () => {
    setError('')
    const b = branches.find((x) => x.id === pick)
    if (!b) return
    const r = await shareStaffAction(b.id, user.id)
    if (!r.ok) return setError(r.error)
    setAlso([...also, { ...b, access: 'own' as const }].sort((x, y) => x.code.localeCompare(y.code))); setPick(''); notify(`${user.name} now also works in ${b.name}`); onChanged()
  })
  const remove = (b: { id: string; name: string }) => start(async () => {
    setError('')
    const r = await unshareStaffAction(b.id, user.id)
    if (!r.ok) return setError(r.error)
    setAlso(also.filter((a) => a.id !== b.id)); notify(`${user.name} no longer works in ${b.name}`); onChanged()
  })
  // in a branch they are shared with they see only their own work, unless given full access there
  const setAccess = (b: { id: string; name: string }, access: 'own' | 'full') => start(async () => {
    setError('')
    const r = await setStaffAccessAction(b.id, user.id, access)
    if (!r.ok) return setError(r.error)
    setAlso(also.map((a) => (a.id === b.id ? { ...a, access } : a))); notify(`${user.name}: ${access === 'full' ? 'full access' : 'own work only'} in ${b.name}`); onChanged()
  })
  /** `b` becomes the home branch; the old home stays an extra branch (`keepOld`) or is left. */
  const makeHome = (b: { id: string; code: string; name: string }, keepOld: boolean) => start(async () => {
    setError('')
    const r = await setHomeBranchAction(user.id, b.id, keepOld)
    if (!r.ok) return setError(r.error)
    setAlso([...also.filter((a) => a.id !== b.id), ...(keepOld ? [{ ...home, access: 'full' as const }] : [])].sort((x, y) => x.code.localeCompare(y.code)))
    notify(keepOld ? `${b.name} is now ${user.name}'s home branch` : `${user.name} left ${home.name}; ${b.name} is now their home branch`)
    setHome(b); onChanged()
  })
  return (
    <Modal title={`Branches — ${user.name}`} onClose={onClose}>
      <p className="section-hint" style={{ margin: '-8px 0 12px' }}>They keep one login and the same roles in every branch here, and pick the branch they are working in at the top left after signing in.</p>
      <div className="review-card" style={{ display: 'block' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span><strong>{home.code} — {home.name}</strong> <span className="status-badge status-blue"><span className="status-dot" />Home branch</span></span>
          <button type="button" className="filter-button" disabled={pending || !also.length} onClick={() => makeHome(also[0], false)}
            title={also.length ? `Remove this branch: ${also[0].name} becomes the home branch` : 'Add another branch first: every branch login needs a home branch'} aria-label={`Remove ${home.name}`}><X size={13} /> Remove</button>
        </div>
        {also.map((b) => (
          <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid #eef1f5' }}>
            <span>{b.code} — {b.name}</span>
            <span className="row-actions" style={{ display: 'flex', gap: 6 }}>
              <select aria-label={`What ${user.name} sees in ${b.name}`} title="Own work: only the leads, calls, students, batches and tickets that are theirs. Full: everything their role allows there." value={b.access ?? 'own'} disabled={pending} onChange={(e) => setAccess(b, e.target.value as 'own' | 'full')}><option value="own">Own work only</option><option value="full">Full access</option></select>
              <button type="button" className="filter-button" disabled={pending} onClick={() => makeHome(b, true)} title={`Make ${b.name} the home branch (${home.name} stays as an extra branch)`}>Make home</button>
              <button type="button" className="filter-button" disabled={pending} onClick={() => remove(b)} aria-label={`Remove ${b.name}`}><X size={13} /> Remove</button>
            </span>
          </div>
        ))}
        {!also.length && <p className="section-hint" style={{ margin: '6px 0 0' }}>Works only in the home branch. To move or remove it, add the new branch first, then “Make home”.</p>}
      </div>
      {free.length > 0 && (
        <div className="set-inline" style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Branch to add" style={{ flex: 1 }}>
            <option value="">Also works in…</option>
            {free.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
          <button type="button" className="button primary" disabled={pending || !pick} onClick={add}><Plus size={14} /> Add branch</button>
        </div>
      )}
      <Err msg={error} />
      <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
