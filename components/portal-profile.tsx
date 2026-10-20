'use client'
// Student portal: what the institute still needs from the student (shown on top until it is given), and their
// photo, which they can retake or replace themselves.
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BellRing, Check, IdCard, ScanFace, UserRound } from 'lucide-react'
import { setMyAadhaarAction } from '@/app/actions'
import { PhotoCapture } from '@/components/photo-capture'
import { formatAadhaar, isValidAadhaar } from '@/modules/people/aadhaar'
import type { MyProfile } from '@/modules/portal/service'

const LABEL = { photo: 'Your photo (for the ID card)', aadhaarNo: 'Your Aadhaar number', aadhaarCard: 'A picture of your Aadhaar card' } as const
/** The pop-up asks for one thing at a time: a short name for the step bar, and a line saying what is wanted. */
const STEP = {
  photo: { name: 'Photo', icon: ScanFace, hint: 'Take a photo or upload one. It is checked so that your face is clear and to the front, then it goes on your ID card.' },
  aadhaarNo: { name: 'Aadhaar number', icon: IdCard, hint: 'The 12-digit number printed on your Aadhaar card.' },
  aadhaarCard: { name: 'Aadhaar card', icon: IdCard, hint: 'A clear photo or scan of your Aadhaar card (JPG, PNG, WebP or PDF, up to 5 MB).' },
} as const

async function upload(kind: 'photo' | 'id_proof', file: File): Promise<string> {
  const fd = new FormData()
  fd.set('kind', kind); fd.set('file', file)
  const r = await fetch('/api/portal/documents', { method: 'POST', body: fd }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Upload failed. Check your connection and try again.' }))
  return r.ok ? '' : r.error
}

/** `onLater` turns it into the step-by-step pop-up: only what is still missing, one thing per step. */
export function PortalProfile({ name, profile, card, onMsg, onLater }: { name: string; profile: MyProfile; card: React.CSSProperties; onMsg: (m: string) => void; onLater?: () => void }) {
  const router = useRouter()
  const [aadhaar, setAadhaar] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, start] = useTransition()
  const [changing, setChanging] = useState(false)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!photo) { setUrl(''); return }
    const u = URL.createObjectURL(photo)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])
  const todo = profile.pending
  // The steps are fixed when the pop-up opens, so a finished one stays in the bar with a tick.
  const [steps] = useState(todo)
  const [at, setAt] = useState(0)
  const undone = (i: number) => todo.includes(steps[i])
  // Once the current step is saved, go on to the next one still missing.
  useEffect(() => {
    if (undone(at)) return
    const next = [...steps.keys()].find((i) => i > at && undone(i)) ?? [...steps.keys()].find(undone)
    if (next !== undefined) setAt(next)
  }, [todo]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveAadhaar = () => {
    if (!isValidAadhaar(aadhaar)) return setError('That Aadhaar number is not valid. Check the 12 digits on your card.')
    start(async () => {
      const r = await setMyAadhaarAction(aadhaar)
      if (!r.ok) return setError(r.error)
      setError(''); setAadhaar(''); onMsg('Your Aadhaar number is saved. Thank you.'); router.refresh()
    })
  }
  async function send(kind: 'photo' | 'id_proof', file: File, done: string) {
    setBusy(true); setError('')
    const problem = await upload(kind, file)
    setBusy(false)
    if (problem) return setError(problem)
    setPhoto(null); setChanging(false); onMsg(done); router.refresh()
  }

  if (onLater) {
    const step = steps[at], info = STEP[step]
    const skipTo = [...steps.keys()].find((i) => i > at && undone(i))
    return (
      <div className="pf-wiz">
        <ol className="pf-bar">
          {steps.map((s, i) => (
            <li key={s} className={i === at ? 'on' : !undone(i) ? 'done' : ''}>
              <button type="button" onClick={() => { setAt(i); setError('') }} disabled={!undone(i) || busy || pending}>
                <span>{!undone(i) ? <Check size={13} strokeWidth={3} /> : i + 1}</span><em>{STEP[s].name}</em>
              </button>
            </li>
          ))}
        </ol>
        <section className="pf-step" aria-label={info.name}>
          <small>Step {at + 1} of {steps.length}</small>
          <h3><info.icon size={18} /> {LABEL[step]}</h3>
          <p>{info.hint}</p>
          {step === 'photo' && <PhotoCapture photo={photo} url={url} setPhoto={setPhoto} />}
          {step === 'aadhaarNo' && (
            <input className="pf-input" inputMode="numeric" aria-label="Aadhaar number" value={aadhaar} maxLength={14} placeholder="XXXX XXXX XXXX" autoComplete="off" autoFocus onChange={(e) => { setAadhaar(formatAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))); setError('') }} onKeyDown={(e) => { if (e.key === 'Enter') saveAadhaar() }} />
          )}
          {step === 'aadhaarCard' && (
            <label className={`pf-drop${busy ? ' busy' : ''}`}>
              <IdCard size={26} /><strong>{busy ? 'Uploading…' : 'Choose the picture of your card'}</strong><span>JPG, PNG, WebP or PDF · up to 5 MB</span>
              <input type="file" hidden disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send('id_proof', f, 'Your Aadhaar card is uploaded. Thank you.') }} />
            </label>
          )}
          {error && <p role="alert" className="pf-err">{error}</p>}
        </section>
        <div className="pf-foot">
          {at > 0 && undone(at - 1)
            ? <button type="button" className="pt-btn ghost" disabled={busy || pending} onClick={() => { setAt(at - 1); setError('') }}><ArrowLeft size={15} /> Back</button>
            : <button type="button" className="pt-btn ghost" onClick={onLater}>Later</button>}
          <span />
          {skipTo !== undefined && <button type="button" className="pt-btn ghost" disabled={busy || pending} onClick={() => { setAt(skipTo); setError('') }}>Skip</button>}
          {step === 'photo' && <button type="button" className="pt-btn" disabled={!photo || busy} onClick={() => photo && send('photo', new File([photo], 'my-photo.jpg', { type: photo.type || 'image/jpeg' }), 'Your photo is saved.')}>{busy ? 'Saving…' : 'Save photo'}</button>}
          {step === 'aadhaarNo' && <button type="button" className="pt-btn" disabled={pending || aadhaar.replace(/\D/g, '').length !== 12} onClick={saveAadhaar}>{pending ? 'Saving…' : 'Save number'}</button>}
        </div>
      </div>
    )
  }

  return (
    <>
      {todo.length > 0 && (
        <section style={{ ...card, border: '1px solid #f1dca8', background: '#fffdf5' }} aria-label="To complete">
          <h2 style={{ margin: '0 0 4px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><BellRing size={18} color="#b45309" /> Please complete your profile</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>The institute still needs {todo.length === 1 ? 'one thing' : `${todo.length} things`} from you:</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12 }}>
            {todo.includes('photo') && (
              <li style={{ fontSize: 13 }}><strong>{LABEL.photo}</strong><br /><span style={{ color: '#64748b' }}>Take or upload it in &quot;My photo&quot; below.</span>{!changing && <> <button type="button" className="filter-button" onClick={() => setChanging(true)}>Add my photo</button></>}</li>
            )}
            {todo.includes('aadhaarNo') && (
              <li style={{ fontSize: 13 }}><strong>{LABEL.aadhaarNo}</strong><br /><span style={{ color: '#64748b' }}>Not needed if you upload a picture of your Aadhaar card below.</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <input inputMode="numeric" aria-label="Aadhaar number" value={aadhaar} maxLength={14} placeholder="12 digits" autoComplete="off" onChange={(e) => { setAadhaar(formatAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))); setError('') }} style={{ height: 40, padding: '0 12px', border: '1px solid #dcdff0', borderRadius: 10, fontSize: 14, flex: '1 1 180px', maxWidth: 240 }} />
                  <button type="button" className="button primary" style={{ height: 40, padding: '0 16px' }} disabled={pending} onClick={saveAadhaar}>{pending ? 'Saving…' : 'Save'}</button>
                </div>
              </li>
            )}
            {todo.includes('aadhaarCard') && (
              <li style={{ fontSize: 13 }}><strong>{LABEL.aadhaarCard}</strong><br /><span style={{ color: '#64748b' }}>A clear photo or scan (JPG, PNG, WebP or PDF, up to 5 MB).</span>
                <div style={{ marginTop: 6 }}><label className="button secondary" style={{ height: 40, padding: '0 16px', cursor: busy ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center' }}>{busy ? 'Uploading…' : 'Upload my Aadhaar card'}<input type="file" hidden disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send('id_proof', f, 'Your Aadhaar card is uploaded. Thank you.') }} /></label></div>
              </li>
            )}
          </ul>
          {error && <p role="alert" style={{ margin: '12px 0 0', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{error}</p>}
        </section>
      )}

      <section style={card} aria-label="My photo">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>My photo</h2>
        {!changing ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div style={{ width: 96, height: 96, borderRadius: 16, overflow: 'hidden', background: '#f1f5f9', display: 'grid', placeItems: 'center', color: '#94a3b8', flex: 'none' }}>{profile.photoId ? <img src={`/documents/${profile.photoId}`} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <UserRound size={40} />}</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              {profile.photoId ? 'This photo is printed on your ID card.' : 'No photo yet. It is needed for your ID card.'}
              {profile.aadhaarLast4 && <><br />Aadhaar on record: XXXX XXXX {profile.aadhaarLast4}</>}
              <br /><button type="button" className="filter-button" style={{ marginTop: 8 }} onClick={() => { setChanging(true); setError('') }}>{profile.photoId ? 'Change my photo' : 'Add my photo'}</button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>Take a new photo or upload one. It is checked so that your face is clear and to the front, then it replaces the photo on your ID card.</p>
            <PhotoCapture photo={photo} url={url} setPhoto={setPhoto} />
            {error && todo.length === 0 && <p role="alert" style={{ margin: '12px 0 0', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" className="button primary" style={{ height: 42, padding: '0 18px' }} disabled={!photo || busy} onClick={() => photo && send('photo', new File([photo], 'my-photo.jpg', { type: photo.type || 'image/jpeg' }), 'Your photo is saved.')}>{busy ? 'Saving…' : 'Save this photo'}</button>
              <button type="button" className="button secondary" style={{ height: 42, padding: '0 18px' }} disabled={busy} onClick={() => { setChanging(false); setPhoto(null) }}>Cancel</button>
            </div>
          </>
        )}
      </section>
    </>
  )
}
