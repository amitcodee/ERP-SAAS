'use client'
// "Already known": while a mobile number (or e-mail / date of birth) is typed, the same person in this or other
// branches, with what each branch has on them (an admission, a lead, a call). Another branch's person is shown masked;
// "Use these details" fetches their full record (logged) and copies it into the form, so it is not typed in again.
import { useEffect, useState } from 'react'
import { Building2, UserCheck } from 'lucide-react'
import { branchMatchDetailsAction, branchMatchesAction } from '@/app/actions'
import type { BranchMatch } from '@/modules/people/matches'

const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const KIND = { admission: 'Admission', lead: 'Lead / enquiry', call: 'Random call' } as const
const ON = { mobile: 'mobile', email: 'e-mail', dob: 'date of birth + name' } as const

export function BranchMatches({ phone, email, dob, firstName, excludePersonId, onUse, title }: {
  phone?: string | null; email?: string | null; dob?: string | null; firstName?: string | null; excludePersonId?: string | null
  /** given on a form: a button to copy the person's details in */
  onUse?: (m: BranchMatch) => void
  title?: string
}) {
  const [found, setFound] = useState<BranchMatch[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const use = async (m: BranchMatch) => {
    if (!onUse) return
    if (m.full) return onUse(m)
    setBusy(m.personId); setErr('')
    const r = await branchMatchDetailsAction({ phone, email, dob: dob || null, firstName, excludePersonId }, m.personId)
    setBusy(null)
    if (!r.ok || !r.data) return setErr(r.ok ? 'Could not open the details' : r.error)
    onUse(r.data)
  }
  const key = JSON.stringify([phone?.replace(/\D/g, '').slice(-10) ?? '', email?.trim().toLowerCase() ?? '', dob ?? '', firstName?.trim().toLowerCase() ?? ''])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      branchMatchesAction({ phone, email, dob: dob || null, firstName, excludePersonId }).then((r) => live && setFound(r.ok ? r.data ?? [] : []))
    }, 400)
    return () => { live = false; clearTimeout(t) }
  }, [key, excludePersonId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!found.length) return null
  const other = found.filter((m) => !m.sameBranch)
  return (
    <div className="fee-note" role="status" style={{ margin: '12px 0', display: 'grid', gap: 10, gridColumn: '1 / -1' }}>
      <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Building2 size={15} />
        {title ?? (other.length ? `Already on record in ${[...new Set(other.map((m) => m.branch))].join(', ')}${found.length > other.length ? ' and in this branch' : ''}` : 'Already on record in this branch')}
      </strong>
      {found.map((m) => (
        <div key={m.personId} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div><b>{m.firstName} {m.lastName ?? ''}</b> · {m.phone}{m.email ? ` · ${m.email}` : ''} · <span style={{ color: 'var(--muted)' }}>{m.sameBranch ? 'this branch' : m.branch}, matched on {m.matchedOn.map((x) => ON[x]).join(', ')}</span></div>
            {m.records.length
              ? <ul style={{ margin: '4px 0 0 18px' }}>{m.records.map((r, i) => <li key={i}>{KIND[r.kind]}{r.no ? ` ${r.no}` : ''} · {r.status.replace('_', ' ')}{r.course ? ` · ${r.course}` : ''} · {fmt(r.at)}</li>)}</ul>
              : <small>No call, lead or admission yet.</small>}
          </div>
          {onUse && <button type="button" className="filter-button" disabled={busy === m.personId} title={m.full ? undefined : 'Their full details are copied in (and the look-up is logged)'} onClick={() => void use(m)}><UserCheck size={14} /> {busy === m.personId ? 'Opening…' : 'Use these details'}</button>}
        </div>
      ))}
      {err && <small className="text-red">{err}</small>}
    </div>
  )
}

/** For forms whose fields are not held in state: fills the named inputs that are still empty. */
export function fillForm(form: HTMLFormElement | null, values: Record<string, string | null | undefined>) {
  if (!form) return
  for (const [name, v] of Object.entries(values)) {
    const el = form.elements.namedItem(name) as HTMLInputElement | null
    if (v && el && 'value' in el && !el.value) el.value = v
  }
}
