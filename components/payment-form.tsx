'use client'
// Recording a payment on the student's fees page. What has to be filled in follows the mode of payment:
// cash (offline) needs only the amount; a cheque needs its number and a photo; an online payment needs the
// transaction number and its screenshot. The proof is uploaded or photographed here and saved with the payment.
import { useEffect, useRef, useState } from 'react'
import { Camera, CheckCircle2, FileText, ImageUp, Printer, SwitchCamera, Trash2 } from 'lucide-react'
import { DateInput } from '@/components/date-input'
import { CHANNEL, dayLabel, MAX_PROOFS, MAX_SLIPS, MIN_FIRST_PAYMENT, paymentChannel, paymentProblem, planLabel, planLimits } from '@/modules/fees/plan'
import type { FeeRow } from '@/modules/fees/service'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')
const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const digits = (v: string) => v.replace(/\D/g, '')
const MAX_BYTES = 5 * 1024 * 1024

type Proof = { file: File; url: string | null } // url = a preview, for pictures

export function PaymentForm({ row, modes, enrolledOn, onDone }: { row: FeeRow; modes: { id: string; value: string }[]; enrolledOn: string; onDone: (m: string) => void }) {
  const [amount, setAmount] = useState('')
  const [modeId, setModeId] = useState('')
  const [txnRef, setTxnRef] = useState('')
  // What the student holds for this payment: a paper slip written at the desk (then turned into an e-slip here), or only the receipt made here.
  const [given, setGiven] = useState<'' | 'offline' | 'online'>('')
  const [paidOn, setPaidOn] = useState(today())
  const [remark, setRemark] = useState('')
  const [nextDate, setNextDate] = useState('')
  const [nextAmount, setNextAmount] = useState('')
  const [proofs, setProofs] = useState<Proof[]>([]) // proof of the payment itself: screenshot, card slip, cheque
  const [slips, setSlips] = useState<Proof[]>([]) // the paper slip given at the desk (offline only)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ receiptNo: string; amount: number; online: boolean; balanceAfter: number; paperSlip: boolean; loginNote: string | null; loginOk: boolean } | null>(null)

  const mode = modes.find((m) => m.id === modeId)
  const channel = mode ? paymentChannel(mode.value) : null
  const rule = channel ? CHANNEL[channel] : null
  const paise = amount ? Number(amount) * 100 : 0
  const remaining = row.balance - paise
  const firstMin = row.paid <= 0 ? Math.min(MIN_FIRST_PAYMENT, row.balance) : 0
  const needsNext = remaining > 0 && !row.plan // with a payment plan the coming installments are already set
  const limits = planLimits(row.courseStart, row.courseEnd, today())
  const nextBy = limits && !limits.late ? limits.lastDue : undefined // the next installment falls a month before the course ends, at the latest
  // The installment that is due now (never more than the balance). Paying less than it needs a reason.
  const current = row.nextDueAmount ? Math.min(row.nextDueAmount, row.balance) : 0
  const short = current > 0 && paise > 0 && paise < current

  function problem(): string {
    if (paise <= 0) return 'Enter the amount received.'
    if (paise > row.balance) return `The amount is more than the balance (${inr(row.balance)}).`
    if (firstMin && paise < firstMin) return `The first payment must be at least ${inr(firstMin)}.`
    if (!mode) return 'Choose the mode of payment.'
    if (!paidOn) return 'Choose the date the payment was received.'
    if (paidOn > today()) return 'The payment date cannot be in the future.'
    if (paidOn < enrolledOn) return `The payment date cannot be before the registration date (${fmt(enrolledOn)}).`
    if (!given) return 'Choose the receipt given to the student: an offline paper slip, or the online e-receipt.'
    const p = paymentProblem(mode.value, txnRef, proofs.length, given === 'offline', given === 'offline' ? slips.length : 0)
    if (p) return p
    if (short && remark.trim().length < 3) return `This is ${inr(current - paise)} less than the current installment (${inr(current)}). Write in the remarks why less is paid.`
    if (needsNext && (!nextDate || !nextAmount)) return 'Enter the date and amount of the next installment.'
    if (needsNext && Number(nextAmount) * 100 > remaining) return `The next installment cannot be more than what is left (${inr(remaining)}).`
    if (needsNext && nextBy && nextDate > nextBy) return `The next installment must be on or before ${dayLabel(nextBy)}, one month before the course ends (${dayLabel(limits!.end)}).`
    return ''
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const p = problem()
    if (p) return setError(p)
    setSaving(true); setError('')
    const fd = new FormData()
    fd.set('registrationId', row.registrationId); fd.set('amount', String(paise)); fd.set('modeId', modeId); fd.set('paidOn', paidOn)
    if (txnRef.trim() && rule?.hasRef) fd.set('txnRef', txnRef.trim())
    if (given === 'offline') fd.set('paperSlip', '1')
    if (remark.trim()) fd.set('remark', remark.trim())
    if (needsNext) { fd.set('nextDate', nextDate); fd.set('nextAmount', String(Number(nextAmount) * 100)) }
    for (const pr of proofs) fd.append('proof', pr.file)
    if (given === 'offline') for (const sl of slips) fd.append('slip', sl.file)
    const res = await fetch('/api/payments', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: 'The payment could not be sent. Check the connection and try again.' }))
    setSaving(false)
    if (!res.ok) return setError(res.error)
    for (const x of [...proofs, ...slips]) if (x.url) URL.revokeObjectURL(x.url)
    const login = res.login as { status: string; email?: string; error?: string } | undefined
    // what happened to the student's portal login (made and mailed by itself on the first payment)
    const loginNote = login?.status === 'emailed' ? `Portal login e-mailed to ${login.email}.`
      : login?.status === 'not_sent' ? `Portal login made, but the e-mail did not go${login.error ? ` (${login.error})` : ''}: the student can use “Forgot password” with ${login.email ?? 'their e-mail'}.`
      : login?.status === 'not_made' ? `Portal login not made: ${login.error ?? 'unknown error'}.`
      : login?.status === 'no_email' ? 'No portal login made: the student has no e-mail on record. Add it, then use Students → Portal login.'
      : null
    setSaved({ receiptNo: res.receiptNo, amount: paise, online: channel === 'online', balanceAfter: res.balanceAfter, paperSlip: given === 'offline', loginNote, loginOk: login?.status === 'emailed' })
    onDone(`Receipt ${res.receiptNo} issued${loginNote ? ` · ${loginNote}` : ''}`)
  }

  if (saved) {
    return (
      <div className="pay-done">
        <CheckCircle2 size={44} />
        <h3>{inr(saved.amount)} received</h3>
        <p>{saved.paperSlip
          ? <>The paper slip is saved as it is. Its slip ID is <strong>{saved.receiptNo}</strong> (made automatically).</>
          : <>{saved.online ? 'E-receipt' : 'Receipt'} no. <strong>{saved.receiptNo}</strong> is made automatically{saved.online ? ' for the online payment' : ''}.</>} {saved.balanceAfter > 0 ? `Balance left: ${inr(saved.balanceAfter)}.` : 'The fee is fully paid.'}</p>
        {saved.loginNote && <p className={saved.loginOk ? 'text-green' : 'text-amber'} style={{ fontWeight: 600 }}>{saved.loginNote}</p>}
        <div className="fee-action-row" style={{ justifyContent: 'center' }}>
          <a className="button primary" href={`/receipts/${encodeURIComponent(saved.receiptNo)}`} target="_blank" rel="noreferrer"><Printer size={16} /> {saved.paperSlip ? 'View the slip' : saved.online ? 'Open e-receipt' : 'Print receipt'}</a>
          {saved.balanceAfter > 0 && <button type="button" className="button secondary" onClick={() => { setSaved(null); setAmount(''); setTxnRef(''); setGiven(''); setRemark(''); setProofs([]); setSlips([]); setNextDate(''); setNextAmount('') }}>Record another payment</button>}
        </div>
      </div>
    )
  }
  if (row.balance <= 0) return <p className="section-hint" style={{ margin: 0 }}>Nothing is left to pay on this registration.</p>

  return (
    <form onSubmit={submit} noValidate className="pay-form">
      <div className="form-grid">
        <label>Amount received (₹)<span className="required-mark">*</span>
          <input name="amount" inputMode="numeric" value={amount} autoComplete="off" placeholder="Whole rupees" onChange={(e) => { setAmount(digits(e.target.value).slice(0, 8)); setError('') }} />
          {current > 0 && <small className={`reg-note pay-current${short ? ' bad' : ''}`}>Current installment: <strong>{inr(current)}</strong>{row.nextDue ? `, due ${fmt(row.nextDue)}` : ''}{row.daysOverdue > 0 ? ` (${row.daysOverdue} days overdue)` : ''}.{short ? ` This payment is ${inr(current - paise)} less: say why in the remarks.` : paise > current ? ` ${inr(paise - current)} more goes to the next installments.` : ''}</small>}
          <span className="pay-chips">
            {current > 0 && current < row.balance ? <button type="button" onClick={() => { setAmount(String(current / 100)); setError('') }}>Current installment {inr(current)}</button> : null}
            <button type="button" onClick={() => { setAmount(String(row.balance / 100)); setError('') }}>Full balance {inr(row.balance)}</button>
          </span>
        </label>
        <label>Mode of payment<span className="required-mark">*</span>
          <select name="mode" value={modeId} onChange={(e) => { setModeId(e.target.value); setError('') }}><option value="" disabled>Select mode</option>{modes.map((m) => <option key={m.id} value={m.id}>{m.value}</option>)}</select>
          {rule && <small className="reg-note"><strong>{rule.label}.</strong> {channel === 'online' ? 'An e-receipt is made automatically.' : channel === 'cheque' ? 'The receipt says it is subject to the cheque being cleared.' : 'A receipt to print and sign is made.'}</small>}
        </label>
        <label>Received on<span className="required-mark">*</span><DateInput name="paidOn" type="date" max={today()} min={enrolledOn} value={paidOn} onChange={(e) => { setPaidOn(e.target.value); setError('') }} />
          {paidOn && paidOn < today() && <small className="reg-note">Back-dated: the receipt carries this date.</small>}
        </label>
        <label>Receipt given to the student<span className="required-mark">*</span>
          <select name="given" value={given} onChange={(e) => { setGiven(e.target.value as typeof given); if (e.target.value !== 'offline') setSlips([]); setError('') }}>
            <option value="" disabled>Select</option>
            <option value="offline">Offline: a paper slip was given at the desk</option>
            <option value="online">Online: only the e-receipt made here</option>
          </select>
          <small className="reg-note">{given === 'offline' ? `Upload the slip below (needed)${rule?.proofNeeded ? ', and the proof of the payment as it is not cash' : ''}. The slip is kept and shown as it is, under an automatic slip ID.` : given === 'online' ? 'No paper slip. The e-receipt made here is what the student gets.' : 'What the student holds for this payment.'}</small>
        </label>
        <label>{given === 'offline' ? 'Slip ID' : 'E-receipt no.'}
          <input className="reg-fixed" value="Made automatically when saved" readOnly tabIndex={-1} />
          <small className="reg-note">{given === 'offline' ? 'Given to the paper slip automatically. It cannot be typed.' : 'The next number of the branch. It cannot be typed.'}</small>
        </label>
        {rule?.hasRef && (
          <label>{rule.refLabel}
            <input name="txnRef" value={txnRef} autoComplete="off" maxLength={100} placeholder={rule.refHint} onChange={(e) => { setTxnRef(e.target.value); setError('') }} />
          </label>
        )}
        {needsNext && paise > 0 && (
          <>
            <label>Next installment date<span className="required-mark">*</span><DateInput name="nextDate" type="date" min={today()} max={nextBy} value={nextDate} onChange={(e) => { setNextDate(e.target.value); setError('') }} />{nextBy && <small className="reg-note">By {dayLabel(nextBy)} at the latest (course ends {dayLabel(limits!.end)})</small>}</label>
            <label>Next installment amount (₹)<span className="required-mark">*</span><input name="nextAmount" inputMode="numeric" value={nextAmount} autoComplete="off" placeholder={`Up to ${remaining / 100}`} onChange={(e) => { setNextAmount(digits(e.target.value).slice(0, 8)); setError('') }} /></label>
          </>
        )}
      </div>
      <label className="full-label">Remarks{short && <span className="required-mark">*</span>}<textarea name="remark" value={remark} maxLength={200} className={short && remark.trim().length < 3 ? 'reg-bad' : undefined} onChange={(e) => { setRemark(e.target.value); setError('') }} placeholder={short ? 'Why is less than the current installment paid? (needed)' : 'Optional: who paid, which installment, anything to remember'} style={{ minHeight: 64 }} /></label>

      {given === 'offline' && (
        <div className="pay-proof">
          <div className="pay-proof-head"><strong>Paper slip<span className="required-mark">*</span></strong><span>One clear photo or scan of the slip given to the student. It is kept and shown as it is.</span></div>
          <ProofPicker name="paper-slip" max={MAX_SLIPS} upload="Upload file" proofs={slips} setProofs={(p) => { setSlips(p); setError('') }} setError={setError} />
        </div>
      )}
      {/* The payment's own proof: asked for whenever the money did not come in cash. For cash it stays optional, and is not offered next to a paper slip. */}
      {(rule?.proofNeeded || given !== 'offline') && (
        <div className="pay-proof">
          <div className="pay-proof-head"><strong>Proof of payment{rule?.proofNeeded && <span className="required-mark">*</span>}</strong><span>{rule ? rule.proofHint : 'A screenshot, slip or photo. Needed for online payments and cheques; not for cash.'}</span></div>
          <ProofPicker name="payment-proof" max={MAX_PROOFS} upload="Upload file" proofs={proofs} setProofs={(p) => { setProofs(p); setError('') }} setError={setError} />
        </div>
      )}

      <div className="pay-summary">
        {firstMin > 0 && <span>First payment: at least {inr(firstMin)}; the student becomes active with it.</span>}
        {row.plan && <span>Plan: {planLabel(row.plan)}. The money goes to the installments in the order they fall due{row.nextDue ? ` (next ${inr(row.nextDueAmount ?? 0)} on ${fmt(row.nextDue)})` : ''}.</span>}
        {paise > 0 && <span><strong>{remaining > 0 ? `Balance after this payment: ${inr(remaining)}` : remaining === 0 ? 'This clears the fee.' : 'The amount is more than the balance.'}</strong></span>}
      </div>
      {error && <p role="alert" className="form-problem">{error}</p>}
      <div className="fee-action-row" style={{ marginTop: 16 }}><button className="button primary" disabled={saving}>{saving ? 'Saving…' : given === 'offline' ? 'Save the paper slip' : channel === 'online' ? 'Save and make e-receipt' : 'Save and issue receipt'}</button></div>
    </form>
  )
}

/** One document (`max`): taken with the camera (back or front), or picked as a file. A new one replaces it after it is removed. */
function ProofPicker({ proofs, setProofs, setError, max, name, upload }: { proofs: Proof[]; setProofs: (p: Proof[]) => void; setError: (m: string) => void; max: number; name: string; upload: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [live, setLive] = useState(false)
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const full = proofs.length >= max
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setLive(false) }
  useEffect(() => stop, [])

  function add(files: File[]) {
    const ok: Proof[] = []
    for (const f of files) {
      if (proofs.length + ok.length >= max) { setError(max === 1 ? 'Only one document here. Remove it first to put another.' : `At most ${max} files here.`); break }
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) { setError('The proof must be a picture (JPG, PNG, WebP) or a PDF.'); continue }
      if (f.size > MAX_BYTES) { setError(`${f.name} is larger than 5 MB.`); continue }
      ok.push({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })
    }
    if (ok.length) setProofs([...proofs, ...ok])
  }
  async function open(side: 'environment' | 'user') {
    setError(''); stop()
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: side }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      stream.current = s; setFacing(side); setLive(true)
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play() } })
    } catch { setError('The camera could not be opened. Allow camera access in the browser, or upload the proof as a file.') }
  }
  function snap() {
    const v = video.current
    if (!v || !v.videoWidth) return
    // the whole frame, at most 1600 px on its long side: a slip or a screen stays readable
    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    c.toBlob((b) => { if (b) add([new File([b], `${name}-${proofs.length + 1}.jpg`, { type: 'image/jpeg' })]) }, 'image/jpeg', 0.88)
    stop()
  }
  const remove = (i: number) => { if (proofs[i].url) URL.revokeObjectURL(proofs[i].url!); setProofs(proofs.filter((_, k) => k !== i)) }

  return (
    <>
      {live && (
        <div className="pay-cam">
          <video ref={video} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
          <div className="fee-action-row">
            <button type="button" className="button primary" onClick={snap}><Camera size={16} /> Take picture</button>
            <button type="button" className="button secondary" onClick={() => open(facing === 'user' ? 'environment' : 'user')}><SwitchCamera size={16} /> {facing === 'user' ? 'Use back camera' : 'Use front camera'}</button>
            <button type="button" className="button secondary" onClick={stop}>Cancel</button>
          </div>
        </div>
      )}
      {proofs.length > 0 && (
        <ul className="pay-proofs">
          {proofs.map((p, i) => (
            <li key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.url ? <img src={p.url} alt={`Proof ${i + 1}`} /> : <span className="pdf"><FileText size={26} /></span>}
              <small title={p.file.name}>{p.file.name}</small>
              <button type="button" className="filter-button icon-only danger" title="Remove this proof" aria-label={`Remove proof ${i + 1}`} onClick={() => remove(i)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {!live && !full && (
        <div className="fee-action-row">
          <button type="button" className="button secondary" onClick={() => open('environment')}><Camera size={16} /> Open camera</button>
          <label className="button secondary" style={{ cursor: 'pointer' }}><ImageUp size={16} /> {upload}<input type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { add([...(e.target.files ?? [])].slice(0, 1)); e.target.value = '' }} /></label>
          <span className="reg-note" style={{ margin: 0 }}>One document: a picture (JPG, PNG, WebP) or a PDF, up to 5 MB</span>
        </div>
      )}
    </>
  )
}
