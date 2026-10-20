'use client'
import { useEffect, useRef, useState } from 'react'
import { Camera, Check, CheckCircle2, ImageUp, RefreshCw, ScanFace, Trash2, UserRound } from 'lucide-react'
import { Err } from '@/components/modal'
import { checkFace, loadFaceDetector, type FaceCheck } from '@/lib/face-check'

const TIPS = ['Face the camera, eyes open', 'Remove cap, mask and dark glasses', 'Stand facing the light, plain background', 'Only you in the picture']

/**
 * The student's photo for the ID card: taken with the device camera, or picked from a file. Each picture is checked
 * on the device (one face, to the front, well lit, sharp) and cut to a square around the face, saved as a JPEG.
 */
export function PhotoCapture({ photo, url, setPhoto }: { photo: Blob | null; url: string; setPhoto: (b: Blob | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const good = useRef(0)
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 'loading' until the face detector is ready; 'off' when this device cannot run it (photos are then taken unchecked).
  const [checker, setChecker] = useState<'loading' | 'on' | 'off'>('loading')
  const [status, setStatus] = useState<FaceCheck | null>(null)
  const [steady, setSteady] = useState(false)

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setLive(false); setStatus(null); setSteady(false); good.current = 0 }
  useEffect(() => stop, [])
  useEffect(() => { loadFaceDetector().then(() => setChecker('on'), () => setChecker('off')) }, [])

  // While the camera is open the frame is checked a few times a second; the photo can be taken once it has been good
  // for a moment (so a blurred frame in the middle of a movement is not caught).
  useEffect(() => {
    if (!live || checker !== 'on') return
    let on = true
    const t = setInterval(async () => {
      const v = video.current
      if (!on || !v || !v.videoWidth) return
      const r = checkFace(await loadFaceDetector(), v, v.videoWidth, v.videoHeight, true)
      if (!on) return
      good.current = r.ok ? good.current + 1 : 0
      setStatus(r); setSteady(good.current >= 3)
    }, 220)
    return () => { on = false; clearInterval(t) }
  }, [live, checker])

  async function openCamera() {
    setError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      stream.current = s
      setLive(true)
      // the <video> exists only after this render
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play() } })
    } catch {
      setError('The camera could not be opened. Allow camera access in the browser, or upload a photo instead.')
    }
  }
  /** Cuts the square out of the picture (around the face, or the centre when there was no check) and stores it as a JPEG. */
  function save(src: CanvasImageSource, w: number, h: number, crop: FaceCheck['crop']) {
    const side = crop?.side ?? Math.min(w, h), out = 600
    const c = document.createElement('canvas')
    c.width = out; c.height = out
    c.getContext('2d')!.drawImage(src, crop?.x ?? (w - side) / 2, crop?.y ?? (h - side) / 2, side, side, 0, 0, out, out)
    c.toBlob((b) => { if (b) setPhoto(b) }, 'image/jpeg', 0.9)
  }
  async function snap() {
    const v = video.current
    if (!v || !v.videoWidth) return
    // The very frame that is kept is checked once more.
    const r = checker === 'on' ? checkFace(await loadFaceDetector(), v, v.videoWidth, v.videoHeight, true) : null
    if (r && !r.ok) { good.current = 0; setSteady(false); setStatus(r); return }
    save(v, v.videoWidth, v.videoHeight, r?.crop ?? null)
    stop()
  }
  function fromFile(file: File | undefined) {
    if (!file) return
    setError(''); setBusy(true)
    const img = new window.Image()
    const u = URL.createObjectURL(file)
    img.onload = async () => {
      try {
        const r = checker === 'off' ? null : await loadFaceDetector().then((d) => checkFace(d, img, img.naturalWidth, img.naturalHeight, false), () => null)
        if (r && !r.ok) setError(`This picture cannot be used for the ID card: ${r.message}`)
        else save(img, img.naturalWidth, img.naturalHeight, r?.crop ?? null)
      } finally { URL.revokeObjectURL(u); setBusy(false) }
    }
    img.onerror = () => { setError('That file is not a picture. Choose a JPG or PNG.'); URL.revokeObjectURL(u); setBusy(false) }
    img.src = u
  }

  const state = !live ? '' : checker !== 'on' ? 'plain' : steady ? 'good' : 'bad'
  return (
    <div className="reg-capture-wrap">
    <div className="reg-capture">
      <div className="reg-capture-main">
        <div className={`reg-photo ${state}`}>
          {live ? <><video ref={video} playsInline muted /><span className="reg-photo-guide" aria-hidden /></> : url ? <img src={url} alt="Student" /> : <div className="reg-photo-empty"><UserRound size={54} /><span>No photo</span></div>}
        </div>
        {live && (
          <p className={`reg-photo-status ${state}`} role="status">
            <ScanFace size={16} />
            {checker === 'loading' ? 'Starting the face check…' : checker === 'off' ? 'The automatic check is not available on this device. Make sure the face is clear and to the front.' : !status ? 'Looking for your face…' : status.ok && !steady ? 'Good. Hold still…' : status.message}
          </p>
        )}
        {!live && photo && <p className="reg-photo-status good" role="status"><CheckCircle2 size={16} /> Photo saved. It will be stored with the registration.</p>}
      </div>
      <div className="reg-capture-side">
        <ul className="reg-tips">{TIPS.map((t) => <li key={t}><Check size={14} /> {t}</li>)}</ul>
        <Err msg={error} />
        <div className="reg-photo-actions">
          {live ? (
            <>
              <button type="button" className="button primary" onClick={snap} disabled={checker === 'loading' || (checker === 'on' && !steady)}><Camera size={15} /> Take photo</button>
              <button type="button" className="button secondary" onClick={stop}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="button primary" onClick={openCamera}>{photo ? <><RefreshCw size={15} /> Retake</> : <><Camera size={15} /> Open camera</>}</button>
              <label className="button secondary" style={{ cursor: 'pointer' }}><ImageUp size={15} /> {busy ? 'Checking…' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = '' }} /></label>
              {photo && <button type="button" className="filter-button icon-only danger" title="Remove photo" aria-label="Remove photo" onClick={() => setPhoto(null)}><Trash2 size={15} /></button>}
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}
