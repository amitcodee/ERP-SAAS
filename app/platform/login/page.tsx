'use client'
import { useActionState } from 'react'
import { platformLoginAction } from '../actions'

export default function PlatformLoginPage() {
  const [state, action, pending] = useActionState(platformLoginAction, undefined)
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form action={action} className="panel login-form" style={{ width: 'min(400px, 100%)', background: '#fff', borderRadius: 16 }}>
        <h1>Platform console</h1>
        <p className="login-sub">For the platform’s own team. Institutes sign in at their own address.</p>
        <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {state?.error && <p role="alert" className="login-error">{state.error}</p>}
        <button className="button primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
