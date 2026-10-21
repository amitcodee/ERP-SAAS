'use client'
// The public page of an event (/e/<token>), opened from its link or QR code, mostly on a phone: the event, the form
// (name, e-mail, and mobile / college when the event asks), the quiz when there is one (with its timer), then the
// result and the certificate, which is also e-mailed.
import { useEffect, useRef, useState, useTransition } from 'react'
import { joinEventAction, startQuizAction } from '@/app/event-actions'
import type { JoinResult, PublicEvent } from '@/modules/events/service'
import { useBrand } from '@/components/brand-context'
import { BrandMark } from '@/components/brand-mark'

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

export function EventSignup({ e }: { e: PublicEvent }) {
  const brand = useBrand()
  const [step, setStep] = useState<'form' | 'quiz' | 'done'>('form')
  const [f, setF] = useState({ name: '', email: '', mobile: '', organisation: '' })
  const [answers, setAnswers] = useState<number[]>(() => e.quiz.map(() => -1))
  const [error, setError] = useState('')
  const [res, setRes] = useState<JoinResult | null>(null)
  const [pending, start] = useTransition()
  const [left, setLeft] = useState<number | null>(null)
  const submitted = useRef(false)
  const ticket = useRef<string | undefined>(undefined)

  const submit = (final: boolean) => start(async () => {
    if (submitted.current) return
    if (!final && e.quiz.length) { if (e.quizMinutes) { ticket.current = await startQuizAction(e.token); setLeft(e.quizMinutes * 60) } setStep('quiz'); window.scrollTo({ top: 0 }); return }
    submitted.current = true
    const r = await joinEventAction(e.token, { ...f, answers, ticket: ticket.current })
    if (!r.ok) { submitted.current = false; setError(r.error); if (step === 'quiz' && /name|e-mail|mobile/i.test(r.error)) setStep('form'); return }
    setError(''); setRes(r.data!); setStep('done'); window.scrollTo({ top: 0 })
  })
  // the quiz timer: it hands the answers in when time is up
  useEffect(() => {
    if (step !== 'quiz' || left === null) return
    if (left <= 0) { submit(true); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  })

  const validForm = f.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(f.email.trim()) && (!e.askMobile || f.mobile.replace(/\D/g, '').length >= 10)
  const unanswered = answers.filter((a) => a < 0).length

  return (
    <main className="es">
      <style>{CSS}</style>
      <div className="es-card">
        <header className="es-head">
          <div className="es-logo"><BrandMark brand={brand} height={40} /></div>
          <span className="es-kind">{e.kindLabel}</span>
          <h1>{e.title}</h1>
          <p className="es-when">{fmt(e.startsAt)}{e.endsAt ? ` – ${fmt(e.endsAt)}` : ''}</p>
          <p className="es-where">{e.mode === 'online' ? 'Online' : e.mode === 'hybrid' ? 'At the venue & online' : 'At the venue'}{e.venue ? ` · ${e.venue}` : ''}{e.speaker ? ` · by ${e.speaker}` : ''}</p>
        </header>

        {step === 'form' && <>
          {e.description && <p className="es-about">{e.description}</p>}
          {!e.open ? <p className="es-closed">{e.why}</p> : <>
            <ol className="es-steps"><li className="on">Your details</li>{e.quiz.length > 0 && <li>Quiz ({e.quiz.length})</li>}{e.certificate && <li>Certificate</li>}</ol>
            <form className="es-form" onSubmit={(ev) => { ev.preventDefault(); if (validForm) submit(false) }}>
              <label>Full name <small>(as it should print on the certificate)</small><input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} autoComplete="name" maxLength={120} required /></label>
              <label>E-mail <small>(your certificate is sent here)</small><input type="email" value={f.email} onChange={(ev) => setF({ ...f, email: ev.target.value })} autoComplete="email" maxLength={160} required /></label>
              {e.askMobile && <label>Mobile number<input type="tel" value={f.mobile} onChange={(ev) => setF({ ...f, mobile: ev.target.value })} autoComplete="tel" maxLength={20} required /></label>}
              {e.askOrg && <label>College / company <small>(optional)</small><input value={f.organisation} onChange={(ev) => setF({ ...f, organisation: ev.target.value })} autoComplete="organization" maxLength={160} /></label>}
              {error && <p className="es-error" role="alert">{error}</p>}
              <button type="submit" disabled={!validForm || pending}>{pending ? 'Please wait…' : e.quiz.length ? 'Next: the quiz' : e.certificate ? 'Submit & get my certificate' : 'Submit'}</button>
              {e.quiz.length > 0 && <p className="es-note">{e.quiz.length} questions{e.quizMinutes ? `, ${e.quizMinutes} minute${e.quizMinutes > 1 ? 's' : ''}` : ''}.{e.certificate ? e.certFor === 'passed' ? ` Score ${e.passPercent}% or more to get the certificate.` : ' Everyone who takes part gets a certificate.' : ''} One try per e-mail.</p>}
            </form>
          </>}
        </>}

        {step === 'quiz' && <>
          <div className="es-quizbar">
            <span>{e.quiz.length - unanswered} of {e.quiz.length} answered</span>
            {left !== null && <span className={`es-timer${left < 60 ? ' low' : ''}`}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
          </div>
          <ol className="es-quiz">
            {e.quiz.map((q, i) => (
              <li key={i}>
                <p className="es-q"><b>{i + 1}.</b> {q.q}</p>
                <div className="es-opts" role="radiogroup" aria-label={`Question ${i + 1}`}>
                  {q.options.map((o, k) => (
                    <label key={k} className={answers[i] === k ? 'on' : ''}>
                      <input type="radio" name={`q${i}`} checked={answers[i] === k} onChange={() => setAnswers(answers.map((a, j) => (j === i ? k : a)))} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {error && <p className="es-error" role="alert">{error}</p>}
          <button type="button" className="es-submit" disabled={pending} onClick={() => { if (!unanswered || confirm(`${unanswered} question${unanswered > 1 ? 's are' : ' is'} not answered. Submit anyway?`)) submit(true) }}>{pending ? 'Submitting…' : 'Submit answers'}</button>
        </>}

        {step === 'done' && res && (
          <div className="es-done">
            {res.total !== null && <div className={`es-score${res.passed ? ' pass' : ''}`}><b>{res.score} / {res.total}</b><span>{res.passed ? 'Passed — well done!' : `Not passed (${e.passPercent}% needed)`}</span></div>}
            <h2>{res.already ? 'This e-mail has already taken part.' : `Thank you, ${res.name.split(' ')[0]}!`}</h2>
            {res.already ? <p>There is one try per e-mail.{e.certificate ? ' If a certificate was earned, it was sent to that inbox (check spam too); the organisers can send it again.' : ''}</p> : res.certNo ? <>
              <p>Your certificate <b>{res.certNo}</b> is ready and on its way to your e-mail.</p>
              <a className="es-cert" href={`/e/c/${res.hash}`}>View / download certificate</a>
            </> : e.certificate ? <p>{res.passed === false ? 'You need to pass the quiz for a certificate.' : 'Your certificate will be e-mailed to you.'}</p> : <p>You are signed up. See you at the {e.kindLabel.toLowerCase()}!</p>}
          </div>
        )}
      </div>
      <p className="es-foot">{e.branch && e.branch !== brand.name ? `${brand.name} · ${e.branch}` : brand.name}</p>
    </main>
  )
}

const CSS = `
.es { min-height: 100vh; background: linear-gradient(160deg, #0b4a73 0%, #10186a 55%, #21c1bd 140%); padding: 20px 14px 30px; display: grid; justify-items: center; align-content: start; gap: 12px; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #0f1437; }
.es-card { width: 100%; max-width: 620px; background: #fff; border-radius: 20px; padding: 22px 20px; box-shadow: 0 24px 60px -20px #0009; }
.es-head { text-align: center; display: grid; justify-items: center; gap: 6px; padding-bottom: 14px; border-bottom: 1px solid #eef0f6; }
.es-logo { width: 150px; height: auto; }
.es-kind { padding: 4px 12px; border-radius: 999px; background: #e0f7f6; color: #0e7c78; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.es-head h1 { margin: 4px 0 0; font-size: 24px; line-height: 1.2; }
.es-when { margin: 0; font-weight: 700; color: #1d2470; font-size: 14px; }
.es-where { margin: 0; color: #6b7394; font-size: 13px; }
.es-about { white-space: pre-line; color: #374151; font-size: 14px; line-height: 1.55; }
.es-closed { margin: 18px 0 4px; padding: 14px; border-radius: 12px; background: #fef2f2; color: #b91c1c; text-align: center; font-weight: 700; }
.es-steps { display: flex; gap: 6px; list-style: none; padding: 0; margin: 16px 0; counter-reset: s; flex-wrap: wrap; }
.es-steps li { counter-increment: s; flex: 1; min-width: 90px; padding: 8px; border-radius: 10px; background: #f3f4fc; color: #6b7394; font-size: 12px; font-weight: 700; text-align: center; }
.es-steps li::before { content: counter(s) '. '; }
.es-steps li.on { background: #10186a; color: #fff; }
.es-form { display: grid; gap: 12px; }
.es-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 700; }
.es-form small { color: #6b7394; font-weight: 500; }
.es-form input { height: 46px; padding: 0 14px; border: 1px solid #d8dbea; border-radius: 12px; font-size: 16px; }
.es-form input:focus { outline: 2px solid #21c1bd; border-color: transparent; }
.es button, .es-cert { height: 50px; border: 0; border-radius: 14px; background: #10186a; color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; display: grid; place-items: center; text-decoration: none; width: 100%; }
.es button:disabled { opacity: .5; cursor: default; }
.es-note { margin: 0; color: #6b7394; font-size: 12.5px; text-align: center; }
.es-error { margin: 0; padding: 10px 12px; border-radius: 10px; background: #fef2f2; color: #b91c1c; font-size: 13px; font-weight: 600; }
.es-quizbar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; margin: 12px -20px; padding: 10px 20px; background: #fffffff0; border-bottom: 1px solid #eef0f6; font-size: 13px; font-weight: 700; color: #6b7394; }
.es-timer { padding: 4px 12px; border-radius: 999px; background: #10186a; color: #fff; font-variant-numeric: tabular-nums; }
.es-timer.low { background: #dc2626; }
.es-quiz { list-style: none; margin: 0 0 16px; padding: 0; display: grid; gap: 16px; }
.es-q { margin: 0 0 8px; font-size: 15px; font-weight: 600; line-height: 1.45; }
.es-opts { display: grid; gap: 8px; }
.es-opts label { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border: 1.5px solid #d8dbea; border-radius: 12px; cursor: pointer; font-size: 14.5px; }
.es-opts label.on { border-color: #10186a; background: #eef0ff; }
.es-opts input { width: 18px; height: 18px; accent-color: #10186a; flex: none; }
.es-done { text-align: center; display: grid; gap: 10px; justify-items: center; padding-top: 16px; }
.es-done h2 { margin: 4px 0 0; font-size: 20px; }
.es-done p { margin: 0; color: #374151; }
.es-score { display: grid; gap: 2px; padding: 14px 26px; border-radius: 16px; background: #fef2f2; color: #b91c1c; }
.es-score.pass { background: #ecfdf5; color: #047857; }
.es-score b { font-size: 30px; }
.es-score span { font-weight: 700; font-size: 13px; }
.es-cert { background: #21a7a3; max-width: 320px; margin-top: 6px; }
.es-foot { color: #ffffffb3; font-size: 12px; margin: 0; }
`
