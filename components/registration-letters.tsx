'use client'
// Edit registration (after registering): project certificate, mode of classes, and the internship letters the
// student needs with their templates. Letters not issued yet follow the change; issued ones keep their wording.
// Dates have their own window (with a reason), as do status and fees.
import { useEffect, useState, useTransition } from 'react'
import { registrationLettersAction, saveRegistrationEditAction } from '@/app/actions'
import { Err, Modal } from '@/components/modal'
import type { TemplateRef } from '@/modules/letters/service'
import { companyTemplateOptions, letterCompaniesOf } from '@/lib/letters/options'

type Edit = { projectCertificate: boolean; classModeId: string | null; offer: boolean; completion: boolean; offerTemplateId: string | null; completionTemplateId: string | null; companyId: string | null }

function YesNo({ label, value, set, note }: { label: string; value: boolean; set: (v: boolean) => void; note?: string }) {
  return (
    <div className="reg-field wide">
      <span className="reg-field-label">{label}</span>
      <div className="reg-seg" role="radiogroup" aria-label={label}>
        <button type="button" role="radio" aria-checked={!value} className={!value ? 'on' : ''} onClick={() => set(false)}>No</button>
        <button type="button" role="radio" aria-checked={value} className={value ? 'on' : ''} onClick={() => set(true)}>Yes</button>
      </div>
      {note && <small className="reg-note">{note}</small>}
    </div>
  )
}

export function RegistrationEditModal({ registrationId, title, classModes, onClose, onSaved }: {
  registrationId: string; title: string; classModes: { id: string; value: string }[]; onClose: () => void; onSaved: () => void
}) {
  const [v, setV] = useState<Edit | null>(null)
  const [templates, setTemplates] = useState<TemplateRef[]>([])
  const [err, setErr] = useState('')
  const [pending, start] = useTransition()
  useEffect(() => {
    registrationLettersAction(registrationId).then((r) => {
      if (!r.ok) return setErr(r.error)
      const { letters, options } = r.data!
      setTemplates(r.data!.templates)
      setV({
        projectCertificate: options?.projectCertificate ?? false, classModeId: options?.classModeId ?? null,
        offer: letters?.offer ?? false, completion: letters?.completion ?? false, offerTemplateId: letters?.offerTemplateId ?? null, completionTemplateId: letters?.completionTemplateId ?? null,
        companyId: letters?.companyId ?? null,
      })
    })
  }, [registrationId])
  const tplSelect = (kind: TemplateRef['kind'], key: 'offerTemplateId' | 'completionTemplateId', label: string) => (
    <select className="reg-tpl" value={v![key] ?? ''} onChange={(e) => setV({ ...v!, [key]: e.target.value || null })} aria-label={`${label} template`}>
      {companyTemplateOptions(templates, kind, v!.companyId).map((o) => <option key={o.value || 'std'} value={o.value}>{o.label}</option>)}
    </select>
  )
  return (
    <Modal title={`Edit registration — ${title}`} onClose={onClose}>
      {!v ? <p className="section-hint">{err || 'Loading…'}</p> : (
        <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveRegistrationEditAction(registrationId, v); if (!r.ok) return setErr(r.error); onSaved() }) }}>
          <p className="section-hint">Change what was chosen at registration. Dates, status and fees have their own buttons in the row.</p>
          <div className="wl-form">
            <label className="wide">Mode of classes<select value={v.classModeId ?? ''} onChange={(e) => setV({ ...v, classModeId: e.target.value || null })}><option value="">—</option>{classModes.map((m) => <option key={m.id} value={m.id}>{m.value}</option>)}</select></label>
            <YesNo label="Project certificate included" value={v.projectCertificate} set={(x) => setV({ ...v, projectCertificate: x })} note="Yes: a project certificate comes with the course certificate (signed by the category head)." />
            {(v.offer || v.completion) && <label className="wide">Company the letters come from<select value={v.companyId ?? letterCompaniesOf(templates)[0]?.id ?? ''} onChange={(e) => setV({ ...v, companyId: e.target.value, offerTemplateId: null, completionTemplateId: null })}>{letterCompaniesOf(templates).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><small className="reg-note">Its templates, letterhead and stamp make the letters (Letter Templates → Companies).</small></label>}
            <YesNo label="Internship selection letter" value={v.offer} set={(x) => setV({ ...v, offer: x })} />
            {v.offer && <div className="wide" style={{ marginTop: -6 }}>{tplSelect('internship_offer', 'offerTemplateId', 'Selection letter')}</div>}
            <YesNo label="Internship completion letter" value={v.completion} set={(x) => setV({ ...v, completion: x })} note={v.offer || v.completion ? 'The letters are set up in Documents → Internship Requests (From registrations), where the role, stipend and hours are added.' : undefined} />
            {v.completion && <div className="wide" style={{ marginTop: -6 }}>{tplSelect('internship_completion', 'completionTemplateId', 'Completion letter')}</div>}
          </div>
          <Err msg={err} />
          <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>
        </form>
      )}
    </Modal>
  )
}
