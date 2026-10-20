'use client'
// Letter Templates → Companies (head office): the companies interns are taken on by (techcadd, Syntax Developer, Zabi
// Technologies, Xair Robotics…). Each has the name its letters use, its full legal name, a contact, a letterhead (a full
// A4 page image the letter is printed on) and a stamp / signature under "Regards,". Without a letterhead a plain one
// with the name is used; techcadd keeps its own letterhead and stamp until others are uploaded.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { saveLetterCompanyAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import { shrinkImage } from '@/lib/signature-file'
import type { LetterCompany } from '@/modules/letters/service'

const On = ({ on }: { on: boolean }) => <span className={`status-badge ${on ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{on ? 'On' : 'Off'}</span>

export function LetterCompanies({ companies, onClose }: { companies: LetterCompany[]; onClose: () => void }) {
  const [editing, setEditing] = useState<LetterCompany | 'new' | null>(null)
  if (editing) return <CompanyForm c={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
  return (
    <Modal title="Letter companies" onClose={onClose} wide>
      <p className="section-hint">The companies interns are taken on by. Each has its own letter templates (pick the company at the top of Letter Templates), letterhead and stamp. When adding an intern, staff choose the company.</p>
      <div className="table-scroll"><table>
        <thead><tr><th>Company</th><th>Letterhead and stamp</th><th /></tr></thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>{c.isDefault && <span className="status-badge status-blue" style={{ marginLeft: 6 }}>Main</span>}{!c.isActive && <span style={{ marginLeft: 6 }}><On on={false} /></span>}
                {c.legalName !== c.name && <small style={{ display: 'block' }}>{c.legalName}</small>}
                <small style={{ display: 'block' }}>{[c.contactPhone, c.contactEmail].filter(Boolean).join(' · ') || 'No contact: the letters use techcadd HR'}</small>
              </td>
              <td>
                <small style={{ display: 'block' }}>Letterhead: {c.hasLetterhead ? 'uploaded' : c.isDefault ? 'techcadd letterhead' : 'plain, with the name'}</small>
                <small style={{ display: 'block' }}>Stamp: {c.hasStamp ? 'uploaded' : c.isDefault ? 'techcadd stamp' : 'none'}</small>
              </td>
              <td><button type="button" className="filter-button" onClick={() => setEditing(c)}><Pencil size={13} /> Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="modal-actions"><button type="button" className="button primary" onClick={() => setEditing('new')}><Plus size={14} /> Add company</button></div>
    </Modal>
  )
}

function CompanyForm({ c, onClose }: { c: LetterCompany | null; onClose: () => void }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [err, setErr] = useState('')
  const [f, setF] = useState({ name: c?.name ?? '', legalName: c?.legalName ?? '', contactPhone: c?.contactPhone ?? '', contactEmail: c?.contactEmail ?? '', isActive: c?.isActive ?? true })
  const [files, setFiles] = useState<{ letterhead: File | null; stamp: File | null }>({ letterhead: null, stamp: null })
  const [remove, setRemove] = useState<{ letterhead: boolean; stamp: boolean }>({ letterhead: false, stamp: false })

  const upload = async (id: string, which: 'letterhead' | 'stamp') => {
    const file = files[which]
    if (!file && !remove[which]) return null
    const fd = new FormData(); fd.set('id', id); fd.set('which', which)
    if (file) fd.set('file', await shrinkImage(file, which === 'letterhead' ? 1800 : 1200))
    const r = await fetch('/api/letter-companies', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Could not upload' }))
    return r.ok ? null : (r.error as string)
  }
  const save = () => start(async () => {
    setErr('')
    const r = await saveLetterCompanyAction(c?.id ?? null, f)
    if (!r.ok) return setErr(r.error)
    const id = r.data as string
    const problem = (await upload(id, 'letterhead')) ?? (await upload(id, 'stamp'))
    if (problem) { setErr(`Saved, but the image was not: ${problem}`); router.refresh(); return }
    notify(c ? 'Company saved' : 'Company added: its templates start from the standard wording'); router.refresh(); onClose()
  })
  const image = (which: 'letterhead' | 'stamp', label: string, hint: string, has: boolean) => (
    <label className="wide">{label}
      <input type="file" accept="image/png,image/jpeg" onChange={(e) => { setFiles({ ...files, [which]: e.target.files?.[0] ?? null }); setRemove({ ...remove, [which]: false }) }} />
      <small className="reg-note">{hint}{has ? ' Leave empty to keep the current one.' : ''}</small>
      {has && <span className="set-check" style={{ marginTop: 4 }}><input type="checkbox" checked={remove[which]} onChange={(e) => setRemove({ ...remove, [which]: e.target.checked })} /> Remove the uploaded {which}</span>}
    </label>
  )
  return (
    <Modal title={c ? `Edit ${c.name}` : 'Add a company'} onClose={onClose} wide>
      <div className="wl-form">
        <label>Name in the letters<span className="required-mark">*</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Syntax Developer" /><small className="reg-note">{'{{company_name}}'}: “an internship with Syntax Developer”.</small></label>
        <label>Full legal name<input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} placeholder="e.g. Syntax Developer Private Ltd." /><small className="reg-note">{'{{company}}'}; empty: the name.</small></label>
        <label>Contact phone<input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} placeholder="HR phone in the letters" /></label>
        <label>Contact e-mail<input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder="HR e-mail in the letters" /></label>
        <label>Status<select value={f.isActive ? 'on' : 'off'} disabled={c?.isDefault} onChange={(e) => setF({ ...f, isActive: e.target.value === 'on' })}><option value="on">On: staff can pick it</option><option value="off">Off: hidden when adding interns</option></select></label>
        {image('letterhead', 'Letterhead', 'A full A4 page image (PNG or JPG, up to 5 MB) with the header and footer; the letter is printed on it. The text sits between 34 mm and 263 mm from the top.', !!c?.hasLetterhead)}
        {image('stamp', 'Stamp and signature', 'Printed under “Regards,” (PNG with a transparent background looks best).', !!c?.hasStamp)}
      </div>
      <Err msg={err} />
      <div className="modal-actions">
        <button type="button" className="button secondary" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="button" className="button primary" disabled={pending || f.name.trim().length < 2} onClick={save}>{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  )
}
