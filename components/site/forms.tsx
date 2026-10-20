'use client'
import Link from 'next/link'
import { useActionState } from 'react'
import { findInstituteAction, verifySignupAction } from '@/app/site/actions'

/** The sign-up code step. */
export function VerifyForm() {
  const [state, action, pending] = useActionState(verifySignupAction, undefined)
  return (
    <form action={action} className="site-form">
      <label>Code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required /></label>
      {state?.error && <p role="alert" className="site-error">{state.error}</p>}
      {state?.sent && <p role="status" className="site-ok">A new code is on its way.</p>}
      <button className="lp-btn lp-btn-dark" disabled={pending}>{pending ? 'Setting up your institute…' : 'Confirm'}</button>
      <button name="resend" value="1" formNoValidate className="lp-btn" style={{ border: '1px solid var(--line)' }} disabled={pending}>Send a new code</button>
      <small>Wrong e-mail? <Link href="/signup">Start again</Link>.</small>
    </form>
  )
}

/** "Find my institute". */
export function FindForm() {
  const [state, action, pending] = useActionState(findInstituteAction, undefined)
  return (
    <form action={action} className="site-form">
      <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
      {state?.error && <p role="alert" className="site-error">{state.error}</p>}
      {state?.sent && <p role="status" className="site-ok">If that e-mail has a login anywhere, the links are on their way.</p>}
      <button className="lp-btn lp-btn-dark" disabled={pending}>Send me the links</button>
      <small>New here? <Link href="/signup">Start a free trial</Link>.</small>
    </form>
  )
}
