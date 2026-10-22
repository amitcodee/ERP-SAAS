'use client'
// Roles & permissions: pick a role on the left, tick what it may do on the right, area by area. Super admin only.
import { useState, useTransition } from 'react'
import { Info, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { deleteRoleAction, saveRoleAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { ACTIONS, CATALOG, PERM_GROUPS, PERM_HELP, withRequired, type Resource } from '@/lib/auth/permissions'
import type { RoleRow } from '@/modules/roles/service'

type Details = { key: string | null; name: string; description: string }

const GROUPS = PERM_GROUPS
const actionsOf = (res: Resource) => ACTIONS.filter((a) => CATALOG[res].actions[a])
const TOTAL = GROUPS.reduce((n, g) => n + g.areas.reduce((m, res) => m + actionsOf(res).length, 0), 0)

export function RolesPanel({ roles, canEdit, notify }: { roles: RoleRow[]; canEdit: boolean; notify: (m: string) => void }) {
  // Unsaved ticks, per role key. A role is only in here once one of its boxes was changed.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({})
  const [selected, setSelected] = useState<string | undefined>(() => (roles.find((r) => !r.locked) ?? roles[0])?.key)
  const [help, setHelp] = useState<Resource | null>(null)
  const [guide, setGuide] = useState(false)
  const [details, setDetails] = useState<Details | null>(null)
  const [error, setError] = useState('')
  const [modalError, setModalError] = useState('')
  const [pending, start] = useTransition()

  const permsOf = (r: RoleRow) => drafts[r.key] ?? r.permissions
  const has = (r: RoleRow, perm: string) => r.kind === 'super' || permsOf(r).includes(perm)
  const countOf = (r: RoleRow) => (r.kind === 'super' ? TOTAL : permsOf(r).length)
  const changed = roles.filter((r) => drafts[r.key])
  // "See" comes with any other tick in the area; taking "See" away clears the area.
  const toggle = (r: RoleRow, res: Resource, action: string, on: boolean) => {
    const perm = `${res}:${action}`
    const next = on ? withRequired([...permsOf(r), perm]) : permsOf(r).filter((p) => (action === 'read' ? !p.startsWith(`${res}:`) : p !== perm))
    const same = next.length === r.permissions.length && next.every((p) => r.permissions.includes(p))
    setDrafts((d) => { const { [r.key]: _old, ...rest } = d; return same ? rest : { ...rest, [r.key]: next } })
  }

  const saveTicks = () => start(async () => {
    for (const r of changed) {
      const res = await saveRoleAction({ key: r.key, name: r.name, description: r.description ?? '', permissions: drafts[r.key] })
      if (!res.ok) return setError(`${r.name}: ${res.error}`)
      setDrafts((d) => { const { [r.key]: _done, ...rest } = d; return rest })
    }
    setError(''); notify(changed.length === 1 ? `Role saved: ${changed[0].name}` : `${changed.length} roles saved`)
  })

  const saveDetails = () => start(async () => {
    if (!details) return
    const role = roles.find((r) => r.key === details.key)
    const res = await saveRoleAction({ key: details.key, name: details.name, description: details.description, permissions: role ? permsOf(role) : ['catalog:read'] })
    if (!res.ok) return setModalError(res.error)
    if (role) setDrafts((d) => { const { [role.key]: _done, ...rest } = d; return rest })
    else setSelected(res.data)
    setDetails(null); notify(`Role saved: ${details.name}`)
  })
  const remove = (role: RoleRow) => start(async () => {
    const res = await deleteRoleAction(role.key)
    if (!res.ok) return setModalError(res.error)
    setDetails(null); notify(`Role deleted: ${role.name}`)
  })
  const open = (d: Details) => { setModalError(''); setDetails(d) }
  const editingRole = roles.find((r) => r.key === details?.key)
  const role = roles.find((r) => r.key === selected) ?? roles[0]
  const locked = !canEdit || !role || role.locked

  return (
    <section className="page-container table-page">
      <div className="page-heading">
        <div><p className="eyebrow">Setup / Roles &amp; permissions</p>
          <h1 className="rp-title">Roles &amp; permissions<button type="button" className="rp-info" aria-expanded={guide} aria-label="How roles and permissions work" title="How this works" onClick={() => setGuide(!guide)}><Info size={18} /></button></h1>
          <p className="subheading">What each role may do. A person with several roles gets all of them. Changes apply immediately.</p></div>
        <div className="heading-actions">{canEdit && <button className="button primary" onClick={() => open({ key: null, name: '', description: '' })}><Plus size={17} /> New role</button>}</div>
      </div>

      {guide && (
        <div className="panel rp-guide">
          <strong>How roles and permissions work</strong>
          <ul>
            <li>A <b>role</b> is a job, such as Counselor or Accountant. Every staff login holds one or more roles.</li>
            <li>A <b>permission</b> is one tick: one thing the role may do in one area of the panel. No tick means that button or page is not available.</li>
            <li>A person with several roles can do everything any of their roles allows.</li>
            <li><b>See</b> comes first: ticking anything in an area also ticks its “See”, and removing “See” clears the whole area.</li>
            <li>Staff work inside their own branch. Only the Institute Admin (head office) works across every branch.</li>
            <li>Institute Admin and Student are fixed and cannot be changed. Built-in roles can be changed but not deleted; a role you created can be deleted once nobody holds it.</li>
            <li>Press the <Info size={13} /> next to an area to read what each of its ticks allows.</li>
          </ul>
        </div>
      )}

      <div className="rp-layout">
        <aside className="panel rp-list" aria-label="Roles">
          <h2>{roles.length} roles</h2>
          {roles.map((r) => (
            <button type="button" key={r.key} className={`rp-item${r.key === role?.key ? ' active' : ''}`} aria-current={r.key === role?.key} onClick={() => setSelected(r.key)}>
              <span><strong>{r.name}</strong><small>{r.users} user{r.users === 1 ? '' : 's'} · {countOf(r)} of {TOTAL} permissions</small></span>
              {drafts[r.key] && <em className="rp-edited">edited</em>}
              {r.locked && <Lock size={13} />}
            </button>
          ))}
        </aside>

        {role && (
          <div className="rp-detail">
            <div className="panel rp-top">
              <div>
                <h2>{role.name}</h2>
                {role.description && <p>{role.description}</p>}
                <div className="rp-chips">
                  <span className="status-badge status-blue"><Users size={12} /> {role.users} user{role.users === 1 ? '' : 's'}</span>
                  <span className="status-badge status-slate">{role.isSystem ? 'Built-in role' : 'Custom role'}</span>
                  <span className="status-badge status-slate">{countOf(role)} of {TOTAL} permissions</span>
                  {drafts[role.key] && <em className="rp-edited">unsaved changes</em>}
                </div>
                {role.locked && <p className="rp-note"><Lock size={14} /> {role.kind === 'super' ? 'The Institute Admin (head office) always has every permission in every branch. It cannot be changed.' : 'This role is fixed and cannot be changed.'}</p>}
              </div>
              {canEdit && !role.locked && <button className="button secondary" onClick={() => open({ key: role.key, name: role.name, description: role.description ?? '' })}><Pencil size={14} /> Rename or delete</button>}
            </div>

            {GROUPS.map((g) => (
              <div className="panel rp-group" key={g.title}>
                <header><h3>{g.title}</h3><span>{g.hint}</span></header>
                {g.areas.map((res) => {
                  const actions = actionsOf(res)
                  const ticked = actions.filter((a) => has(role, `${res}:${a}`)).length
                  return (
                    <div className="rp-area" key={res}>
                      <div className="rp-area-name">
                        {CATALOG[res].label}
                        <button type="button" className="rp-info" aria-expanded={help === res} aria-label={`What is ${CATALOG[res].label}?`} title="What is this?" onClick={() => setHelp(help === res ? null : res)}><Info size={15} /></button>
                        <small>{ticked} of {actions.length}</small>
                      </div>
                      <div className="rp-ticks">
                        {actions.map((a) => {
                          const on = has(role, `${res}:${a}`)
                          return (
                            <label className={`rp-tick${on ? ' on' : ''}`} key={a} title={PERM_HELP[res].actions[a]}>
                              <input type="checkbox" aria-label={`${role.name} — ${CATALOG[res].label}: ${CATALOG[res].actions[a]}`} checked={on} disabled={locked || pending} onChange={(e) => toggle(role, res, a, e.target.checked)} />
                              {CATALOG[res].actions[a]}
                            </label>
                          )
                        })}
                      </div>
                      {help === res && (
                        <div className="rp-help">
                          <p>{PERM_HELP[res].about}</p>
                          <dl>{actions.map((a) => <div key={a}><dt>{CATALOG[res].actions[a]}</dt><dd>{PERM_HELP[res].actions[a]}</dd></div>)}</dl>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {(changed.length > 0 || error) && (
        <div className="rp-savebar" role="status">
          <span>{error ? <strong className="text-red">{error}</strong> : <><strong>{changed.length}</strong> role{changed.length === 1 ? '' : 's'} changed: {changed.map((r) => r.name).join(', ')}</>}</span>
          <div>
            <button className="button secondary" disabled={pending} onClick={() => { setDrafts({}); setError('') }}>Discard</button>
            <button className="button primary" disabled={pending || !changed.length} onClick={saveTicks}>{pending ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}

      {details && (
        <Modal title={details.key ? 'Edit role' : 'New role'} onClose={() => setDetails(null)}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label><span>Role name<span className="required-mark">*</span></span><input value={details.name} autoFocus onChange={(e) => setDetails({ ...details, name: e.target.value })} placeholder="e.g. Telecaller" /></label>
            <label>What this role is for<input value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} /></label>
          </div>
          {!details.key && <p className="section-hint" style={{ margin: '12px 0 0' }}>The role starts with no permissions except seeing courses. Tick what it may do after creating it.</p>}
          {editingRole && <p className="section-hint" style={{ margin: '12px 0 0' }}>{editingRole.users} user{editingRole.users === 1 ? '' : 's'} hold this role{editingRole.isSystem ? ' · built-in role' : ' · custom role'}.</p>}
          <Err msg={modalError} />
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <div>{editingRole && !editingRole.isSystem && <button className="button secondary" disabled={pending} onClick={() => remove(editingRole)}><Trash2 size={14} /> Delete role</button>}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button secondary" onClick={() => setDetails(null)}>Cancel</button>
              <button className="button primary" disabled={pending} onClick={saveDetails}>{pending ? 'Saving…' : details.key ? 'Save changes' : 'Create role'}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
