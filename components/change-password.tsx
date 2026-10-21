'use client'

import { useState, useTransition } from 'react'
import { changePasswordAction, startPasswordChangeAction } from '@/app/actions'
import { logoutAction } from '@/app/login/actions'
import { PasswordInput } from '@/components/password-input'
import { useBrand } from '@/components/brand-context'

const HINT = 'At least 10 characters, with a letter and a number.'

/**
 * withCode (staff, from My account / Settings): after the passwords are checked, a 6-digit code is e-mailed and the
 * password only changes once that code is entered. Without it (first sign-in with a temporary password, students) it changes at once.
 */
export function ChangePasswordForm({ onDone, withCode = false }: { onDone?: () => void; withCode?: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('') // set once the code is mailed: the form then asks for it
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [pending, start] = useTransition()
  const sendCode = () => start(async () => {
    const r = await startPasswordChangeAction(current, next)
    if (!r.ok) return setError(r.error)
    setError(''); setCode(''); setSentTo(r.data?.email ?? 'your e-mail')
  })
  function submit(e: React.FormEvent) {
    e.preventDefault()
    setOk(false)
    if (next !== confirm) return setError('The two new passwords do not match')
    if (withCode && !sentTo) return sendCode()
    start(async () => {
      const r = await changePasswordAction(current, next, withCode ? code : undefined)
      if (!r.ok) return setError(r.error)
      setError(''); setOk(true); setCurrent(''); setNext(''); setConfirm(''); setCode(''); setSentTo(''); onDone?.()
    })
  }
  return (
    <form onSubmit={submit}>
      {!sentTo ? (
        <>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>Current password<PasswordInput name="current" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
            <label>New password<PasswordInput name="next" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /></label>
            <label>Repeat new password<PasswordInput name="confirm" autoComplete="new-password" required minLength={10} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          </div>
          <p className="section-hint" style={{ margin: '10px 0 0' }}>{HINT}{withCode ? ' We then e-mail you a code to confirm the change.' : ''}</p>
        </>
      ) : (
        <>
          <p className="section-hint" style={{ margin: '0 0 12px' }}>We sent a 6-digit code to {sentTo}. Enter it to change your password. The code works for 10 minutes.</p>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>Code from the e-mail<span className="required-mark">*</span><input name="code" value={code} required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="6-digit code" onChange={(e) => setCode(e.target.value)} /></label>
          </div>
          <p className="section-hint" style={{ margin: '10px 0 0' }}>Did not get it? Check spam, or <button type="button" className="link-button" disabled={pending} onClick={sendCode}>send it again</button>.</p>
        </>
      )}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 11, marginTop: 10 }}>{error}</p>}
      {ok && <p role="status" style={{ color: '#15803d', fontSize: 12, marginTop: 10 }}>Password changed.</p>}
      <div className="modal-actions">
        {sentTo && <button type="button" className="button secondary" onClick={() => { setSentTo(''); setCode(''); setError('') }}>Back</button>}
        <button className="button primary" disabled={pending}>{pending ? (withCode && !sentTo ? 'Sending code…' : 'Saving…') : withCode && !sentTo ? 'Send code to my e-mail' : 'Change password'}</button>
      </div>
    </form>
  )
}

/** Full page shown instead of the app when an account must choose its own password first. */
export function ForcedChangeScreen({ name }: { name: string }) {
  const brand = useBrand()
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: '#f5f7fa' }}>
      <div className="modal-card" style={{ width: 'min(420px,100%)' }}>
        <div className="modal-head"><div><p className="eyebrow">{brand.name}</p><h2>Set a new password</h2></div></div>
        <p className="section-hint" style={{ margin: '-6px 0 14px' }}>Welcome, {name.split(' ')[0]}. The password you signed in with was temporary. Choose your own to continue.</p>
        <ChangePasswordForm onDone={() => window.location.reload()} />
        <form action={logoutAction} style={{ marginTop: 8 }}><button className="filter-button" type="submit">Sign out</button></form>
      </div>
    </main>
  )
}
