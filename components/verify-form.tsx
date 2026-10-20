'use client'
// The search of the public verification page: the number on the certificate (or the registration number) and the
// drawn sum. A right answer and a match open that certificate's verification page.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { findCertificateAction, newPuzzleAction } from '@/app/verify/actions'
import type { Puzzle } from '@/lib/verify-puzzle'

export function VerifyForm({ first }: { first: Puzzle }) {
  const router = useRouter()
  const [puzzle, setPuzzle] = useState(first)
  const [number, setNumber] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const r = await findCertificateAction(number, answer, puzzle.token)
      if (r.ok) { router.push(r.href); return }
      setError(r.error); setPuzzle(r.puzzle); setAnswer('')
    })
  }
  return (
    <form className="vq" onSubmit={submit}>
      <style>{CSS}</style>
      <div className="vq-head">
        <span className="vq-icon"><ShieldCheck size={26} /></span>
        <div><h1>Verify a certificate</h1><p>Check that a techcadd certificate is genuine. Enter the number printed on it — the certificate number or the student’s registration number. Dashes and slashes are optional.</p></div>
      </div>
      <label className="vq-field">Certificate or registration number
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. CERT-MOH-2026-0002 or TCD/4002/123" autoComplete="off" spellCheck={false} maxLength={60} required />
      </label>
      <div className="vq-puzzle">
        <div>
          <span className="vq-label">Solve the sum (keeps robots out)</span>
          <div className="vq-img" dangerouslySetInnerHTML={{ __html: puzzle.svg }} />
        </div>
        <label className="vq-field vq-answer">Answer<input value={answer} onChange={(e) => setAnswer(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" autoComplete="off" maxLength={4} required /></label>
        <button type="button" className="vq-refresh" title="A different sum" aria-label="A different sum" disabled={pending}
          onClick={() => start(async () => { const p = await newPuzzleAction(); if (p) { setPuzzle(p); setAnswer(''); setError('') } else setError('Too many new sums: please wait a few minutes') })}><RefreshCw size={16} /></button>
      </div>
      {error && <p className="vq-error" role="alert">{error}</p>}
      <button type="submit" className="vq-go" disabled={pending || number.trim().length < 3 || !answer}><Search size={17} /> {pending ? 'Checking…' : 'Verify'}</button>
      <p className="vq-note">You can also scan the QR code printed on the certificate: it opens its verification page directly.</p>
    </form>
  )
}

const CSS = `
.vq { padding: 30px 30px 26px; display: grid; gap: 18px; }
.vq-head { display: flex; gap: 16px; align-items: flex-start; }
.vq-icon { flex: none; width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; background: #eef0ff; color: #4f46e5; }
.vq-head h1 { margin: 2px 0 6px; font-size: 24px; letter-spacing: -.4px; }
.vq-head p { margin: 0; color: #556080; font-size: 14px; line-height: 1.55; }
.vq-field { display: grid; gap: 6px; font-size: 13px; font-weight: 700; color: #0f1437; }
.vq-field input { width: 100%; box-sizing: border-box; height: 48px; padding: 0 14px; border: 1.5px solid #d8dbea; border-radius: 12px; font-size: 16px; font-family: ui-monospace, Menlo, Consolas, monospace; letter-spacing: .02em; }
.vq-field input:focus { outline: 0; border-color: #4f46e5; box-shadow: 0 0 0 4px #e0e7ff; }
.vq-puzzle { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 14px; border-radius: 14px; background: #f6f7fc; border: 1px dashed #d8dbea; }
.vq-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 700; color: #6b7394; }
.vq-img { width: 170px; height: 46px; padding: 3px 8px; background: #fff; border: 1px solid #e5e7f2; border-radius: 10px; }
.vq-img svg { width: 100%; height: 100%; display: block; }
.vq-answer { width: 110px; }
.vq-answer input { text-align: center; font-family: inherit; font-weight: 700; }
.vq-refresh { width: 44px; height: 48px; display: grid; place-items: center; border: 1.5px solid #d8dbea; border-radius: 12px; background: #fff; color: #4f46e5; cursor: pointer; }
.vq-error { margin: 0; padding: 11px 13px; border-radius: 12px; background: #fef2f2; color: #b91c1c; font-size: 13.5px; font-weight: 600; }
.vq-go { height: 52px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 14px; background: linear-gradient(135deg, #10186a, #4a4af4); color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; }
.vq-go:disabled { opacity: .55; cursor: default; }
.vq-note { margin: 0; color: #8a93ad; font-size: 12.5px; text-align: center; }
@media (max-width: 520px) { .vq { padding: 22px 18px; } .vq-head h1 { font-size: 21px; } }
`
