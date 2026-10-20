'use client'
// Settings → Certificate signatures (head office): which signatures the course completion certificate shows, and the
// authorised signatory's own signature. The project certificate always shows the category head's signature
// (set on each category in Course Categories).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setSignatureChoiceAction } from '@/app/actions'
import { Err } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { SignatureChoice } from '@/modules/catalog/categories'
import { MAX_SIGNATURE_MB, shrinkSignature } from '@/lib/signature-file'

const CHOICES: [SignatureChoice, string, string][] = [
  ['both', 'Both signatures', 'The authorised signatory and the instructor (the category head of the course).'],
  ['authorised', 'Authorised signatory only', 'One signature: the authorised signatory set below.'],
  ['instructor', 'Instructor only', 'One signature: the head of the course’s category.'],
]

export function CertificateSignatures({ choice, signer, image, canEdit }: {
  choice: SignatureChoice; signer: { name: string | null; title: string | null } | null; image: string | null; canEdit: boolean
}) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [name, setName] = useState(signer?.name ?? '')
  const [title, setTitle] = useState(signer?.title ?? 'Authorised Signatory (MD)')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(image)
  const [err, setErr] = useState('')

  const save = () => start(async () => {
    setErr('')
    const fd = new FormData(); fd.set('target', 'authorised'); fd.set('name', name); fd.set('title', title); if (file) fd.set('file', await shrinkSignature(file))
    const r = await fetch('/api/signatures', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Could not save' }))
    if (!r.ok) return setErr(r.error)
    notify('Authorised signature saved'); setFile(null); router.refresh()
  })

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-header"><div><h2>Certificate signatures</h2><span>Which signatures the course completion certificate carries. The project certificate always carries the category head&apos;s signature (set on each category in Course Categories).</span></div></div>
      <div className="sig-choices" role="radiogroup" aria-label="Signatures on the course completion certificate">
        {CHOICES.map(([v, label, what]) => (
          <label key={v} className={`sig-choice${choice === v ? ' on' : ''}`}>
            <input type="radio" name="sigchoice" checked={choice === v} disabled={!canEdit || pending} onChange={() => start(async () => { const r = await setSignatureChoiceAction(v); notify(r.ok ? 'Saved' : r.error); router.refresh() })} />
            <span><strong>{label}{v === 'both' ? ' (default)' : ''}</strong><small>{what}</small></span>
          </label>
        ))}
      </div>

      <h3 className="reg-sub" style={{ marginTop: 18 }}>Authorised signatory</h3>
      <div className="wl-form" style={{ maxWidth: 640 }}>
        <label>Name under the signature<input disabled={!canEdit} value={name} placeholder="e.g. Amit Kumar" onChange={(e) => setName(e.target.value)} /></label>
        <label>Title<input disabled={!canEdit} value={title} placeholder="e.g. Director" onChange={(e) => setTitle(e.target.value)} /></label>
        {canEdit && <label className="wide">Signature image<input type="file" accept="image/png,image/jpeg" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); setPreview(x ? URL.createObjectURL(x) : image) }} /><small className="reg-note">PNG or JPG, up to {MAX_SIGNATURE_MB} MB. Dark ink on white, cropped close; a transparent PNG looks best.</small></label>}
        <div className="wide sig-preview">{preview ? <img src={preview} alt="Authorised signature" /> : <span>No signature uploaded yet — certificates show a blank line to sign by hand.</span>}</div>
      </div>
      <Err msg={err} />
      {canEdit && <div className="te-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}><button type="button" className="button primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Save authorised signatory'}</button></div>}
    </div>
  )
}
