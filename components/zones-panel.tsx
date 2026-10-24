'use client'
// Branches → Zones (head office): group branches into zones (regions) and name each zone's managers, who then work in
// every branch of the zone (modules/branches/zones.ts).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Map as MapIcon, Plus, Trash2, X } from 'lucide-react'
import { addZoneManagerAction, createZoneAction, deleteZoneAction, removeZoneManagerAction, setBranchZoneAction } from '@/app/actions'
import type { ZoneRow } from '@/modules/branches/zones'

type Staff = { id: string; name: string; home: string }

export function ZonesPanel({ zones, branches, staff, notify }: { zones: ZoneRow[]; branches: { id: string; name: string; code: string; zoneId: string | null }[]; staff: Staff[]; notify: (m: string) => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await fn()
    notify(r.ok ? done : r.error ?? 'Could not save')
    if (r.ok) router.refresh()
  })
  const zoneOf = new Map(branches.map((b) => [b.id, b.zoneId]))
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><div><h2><MapIcon size={16} /> Zones</h2><span>Group branches into zones (regions). A zone’s managers work in every branch of it, as their role allows, and pick the branch from the sidebar.</span></div></div>
      <form className="row-actions" style={{ gap: 8, marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) act(async () => { const r = await createZoneAction(name); if (r.ok) setName(''); return r }, `Zone ${name.trim()} added`) }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. North zone" aria-label="New zone name" />
        <button type="submit" className="button secondary" disabled={pending || !name.trim()}><Plus size={14} /> Add zone</button>
      </form>
      {!zones.length ? <p className="section-hint" style={{ margin: 0 }}>No zones yet. Useful once you have several branches in different regions.</p> : (
        <div className="table-scroll"><table>
          <thead><tr><th>Zone</th><th>Branches</th><th>Managers</th><th /></tr></thead>
          <tbody>{zones.map((z) => (
            <tr key={z.id}>
              <td><strong>{z.name}</strong></td>
              <td>
                {z.branches.map((b) => <span key={b.id} className="status-badge status-slate" style={{ marginRight: 4 }}>{b.name} <button type="button" className="icon-only" aria-label={`Take ${b.name} out of ${z.name}`} disabled={pending} onClick={() => act(() => setBranchZoneAction(b.id, null), `${b.name} taken out of ${z.name}`)} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}><X size={11} /></button></span>)}
                <select value="" aria-label={`Add a branch to ${z.name}`} disabled={pending} onChange={(e) => { const id = e.target.value; const b = branches.find((x) => x.id === id); if (b) act(() => setBranchZoneAction(id, z.id), `${b.name} is in ${z.name}`) }}>
                  <option value="">+ Branch…</option>
                  {branches.filter((b) => zoneOf.get(b.id) !== z.id).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code}){b.zoneId ? ' · moves from its zone' : ''}</option>)}
                </select>
              </td>
              <td>
                {z.managers.map((m) => <span key={m.userId} className="status-badge status-blue" style={{ marginRight: 4 }} title={m.email}>{m.name} <button type="button" aria-label={`Take ${m.name} off ${z.name}`} disabled={pending} onClick={() => act(() => removeZoneManagerAction(z.id, m.userId), `${m.name} no longer manages ${z.name}`)} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}><X size={11} /></button></span>)}
                <select value="" aria-label={`Add a manager to ${z.name}`} disabled={pending} onChange={(e) => { const id = e.target.value; const s = staff.find((x) => x.id === id); if (s) act(() => addZoneManagerAction(z.id, id), `${s.name} manages ${z.name}`) }}>
                  <option value="">+ Manager…</option>
                  {staff.filter((s) => !z.managers.some((m) => m.userId === s.id)).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.home})</option>)}
                </select>
              </td>
              <td><button type="button" className="filter-button icon-only" aria-label={`Delete ${z.name}`} title="Delete the zone (its branches stay)" disabled={pending} onClick={() => { if (confirm(`Delete ${z.name}? Its branches stay; its managers no longer work in them.`)) act(() => deleteZoneAction(z.id), `${z.name} deleted`) }}><Trash2 size={14} /></button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}
