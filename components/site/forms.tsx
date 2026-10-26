'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { ArrowRight } from 'lucide-react'
import { findInstituteAction, verifySignupAction } from '@/app/site/actions'

/** The sign-up code step. */
export function VerifyForm() {
  const [state, action, pending] = useActionState(verifySignupAction, undefined)
  return (
    <form action={action} className="au-card">
      <label className="au-field">Code<input name="code" className="au-code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required placeholder="••••••" autoFocus /></label>
      {state?.error && <p role="alert" className="au-error">{state.error}</p>}
      {state?.sent && <p role="status" className="au-ok">A new code is on its way.</p>}
      <button className="lp-btn sx-btn-brand au-submit" disabled={pending}>{pending ? 'Setting up your institute…' : 'Confirm'} <ArrowRight size={16} /></button>
      <button name="resend" value="1" formNoValidate className="lp-btn sx-btn-line" style={{ width: '100%' }} disabled={pending}>Send a new code</button>
      <p className="au-fine" style={{ margin: 0 }}>Wrong e-mail? <Link href="/signup">Start again</Link>.</p>
    </form>
  )
}

/** "Find my institute". */
export function FindForm() {
  const [state, action, pending] = useActionState(findInstituteAction, undefined)
  return (
    <form action={action} className="au-card">
      <label className="au-field">E-mail<input name="email" type="email" required autoComplete="email" placeholder="you@institute.com" autoFocus /></label>
      {state?.error && <p role="alert" className="au-error">{state.error}</p>}
      {state?.sent && <p role="status" className="au-ok">If that e-mail has a login anywhere, the links are on their way.</p>}
      <button className="lp-btn sx-btn-brand au-submit" disabled={pending}>Send me the links <ArrowRight size={16} /></button>
      <p className="au-fine" style={{ margin: 0 }}>New here? <Link href="/signup">Start a free trial</Link>.</p>
    </form>
  )
}
