'use client'
// My account: the signed-in person's own details (Profile) and how they sign in (Security).
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound, MailCheck, ShieldCheck, UserRound } from 'lucide-react'
import { confirmTwoFactorAction, disableTwoFactorAction, startTwoFactorAction, updateProfileAction } from '@/app/actions'
import { ChangePasswordForm } from '@/components/change-password'
import { Err } from '@/components/modal'
import { useNotify } from '@/components/panel-shell'
import type { Profile } from '@/modules/auth/account'
import { PasswordInput } from '@/components/password-input'

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const dayTime = (d: string | null) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never')

export function AccountPanel({ profile, tab, initials, roleLabel, branch }: { profile: Profile; tab: 'profile' | 'security'; initials: string; roleLabel: string; branch: string }) {
  return (
    <section className="page-container acct-page">
      <div className="page-heading"><div><p className="eyebrow">My account</p><h1>{tab === 'profile' ? 'Profile' : 'Security'}</h1><p className="subheading">{tab === 'profile' ? 'Your own details as the panel shows them to your team.' : 'Your password and how you sign in.'}</p></div></div>
      <div className="acct-tabs" role="tablist">
        <Link href="/account" role="tab" aria-selected={tab === 'profile'} className={tab === 'profile' ? 'on' : ''}><UserRound size={15} /> Profile</Link>
        <Link href="/account?tab=security" role="tab" aria-selected={tab === 'security'} className={tab === 'security' ? 'on' : ''}><ShieldCheck size={15} /> Security</Link>
      </div>
      {tab === 'profile' ? <ProfileTab profile={profile} initials={initials} roleLabel={roleLabel} branch={branch} /> : <SecurityTab profile={profile} />}
    </section>
  )
}

function ProfileTab({ profile, initials, roleLabel, branch }: { profile: Profile; initials: string; roleLabel: string; branch: string }) {
  const notify = useNotify()
  const router = useRouter()
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const changed = name.trim() !== profile.name || phone.trim() !== (profile.phone ?? '')
  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = await updateProfileAction({ name, phone })
      if (!res.ok) return setError(res.error)
      setError(''); notify('Profile saved'); router.refresh()
    })
  }
  return (
    <div className="acct-grid">
      <div className="panel acct-card">
        <div className="acct-who">
          <div className="avatar">{initials}</div>
          <div><strong>{profile.name}</strong><span>{profile.email}</span></div>
        </div>
        <dl className="acct-facts">
          <div><dt>Role</dt><dd>{roleLabel}</dd></div>
          <div><dt>Branch</dt><dd>{branch}</dd></div>
          <div><dt>Member since</dt><dd>{day(profile.createdAt)}</dd></div>
          <div><dt>Last sign-in</dt><dd>{dayTime(profile.lastLoginAt)}</dd></div>
          <div><dt>Two-step sign-in</dt><dd>{profile.twoFactorEmail ? 'On (e-mail code)' : 'Off'}</dd></div>
        </dl>
      </div>
      <form className="panel" onSubmit={submit}>
        <div className="panel-header"><div><h2>Your details</h2><span>Your name and phone number can be changed here.</span></div></div>
        <div className="form-grid">
          <label>Full name<span className="required-mark">*</span><input value={name} required minLength={2} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
          <label>Phone<input value={phone} type="tel" autoComplete="tel" maxLength={17} placeholder="10-digit mobile" onChange={(e) => setPhone(e.target.value)} /></label>
          <label>E-mail (your sign-in)<input value={profile.email} disabled readOnly /></label>
          <label>Role<input value={roleLabel} disabled readOnly /></label>
          <label style={{ gridColumn: '1 / -1' }}>Branch<input value={branch} disabled readOnly /></label>
        </div>
        <p className="section-hint" style={{ margin: '14px 0 0' }}>Your e-mail, role and branch are set by your administrator. Ask them if one of these is wrong.</p>
        <Err msg={error} />
        <div className="modal-actions"><button className="button primary" disabled={pending || !changed}>{pending ? 'Saving…' : 'Save changes'}</button></div>
      </form>
    </div>
  )
}

function SecurityTab({ profile }: { profile: Profile }) {
  return (
    <div className="acct-grid even">
      <div className="panel">
        <div className="panel-header"><div><h2><KeyRound size={16} /> Password</h2><span>Last changed {day(profile.passwordChangedAt)}. We e-mail you a code to confirm the change; changing it signs you out everywhere else.</span></div></div>
        <ChangePasswordForm withCode />
      </div>
      <TwoFactorCard email={profile.email} on={profile.twoFactorEmail} />
    </div>
  )
}

/** Two-step sign-in by e-mail. Turning it on needs a code from the mailbox first; turning it off needs the password. */
function TwoFactorCard({ email, on }: { email: string; on: boolean }) {
  const notify = useNotify()
  const router = useRouter()
  const [step, setStep] = useState<'idle' | 'code' | 'off'>('idle')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const reset = () => { setStep('idle'); setValue(''); setError('') }
  const send = () => start(async () => {
    const res = await startTwoFactorAction()
    if (!res.ok) return setError(res.error)
    setError(''); setValue(''); setStep('code'); notify(`Code sent to ${email}`)
  })
  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const res = step === 'code' ? await confirmTwoFactorAction(value) : await disableTwoFactorAction(value)
      if (!res.ok) return setError(res.error)
      notify(step === 'code' ? 'Two-step sign-in is on' : 'Two-step sign-in is off'); reset(); router.refresh()
    })
  }
  return (
    <div className="panel">
      <div className="panel-header">
        <div><h2><MailCheck size={16} /> Two-step sign-in</h2><span>After your password, we e-mail a 6-digit code to {email}. Nobody can sign in with the password alone.</span></div>
        <span className={`status-badge ${on ? 'status-green' : 'status-slate'}`}><span className="status-dot" />{on ? 'On' : 'Off'}</span>
      </div>
      {step === 'idle' && (
        <>
          <ul className="acct-points">
            <li>The code works for 10 minutes and is asked at every sign-in.</li>
            <li>Make sure you can open the mailbox {email} before you turn this on.</li>
          </ul>
          <Err msg={error} />
          <div className="modal-actions">
            {on ? <button type="button" className="button secondary" onClick={() => { setError(''); setStep('off') }}>Turn off</button>
              : <button type="button" className="button primary" disabled={pending} onClick={send}>{pending ? 'Sending code…' : 'Turn on'}</button>}
          </div>
        </>
      )}
      {step !== 'idle' && (
        <form onSubmit={submit}>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            {step === 'code'
              ? <label>Code from the e-mail<span className="required-mark">*</span><input value={value} required autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="6-digit code" onChange={(e) => setValue(e.target.value)} /></label>
              : <label>Your password, to turn it off<span className="required-mark">*</span><PasswordInput value={value} required autoFocus autoComplete="current-password" onChange={(e) => setValue(e.target.value)} /></label>}
          </div>
          {step === 'code' && <p className="section-hint" style={{ margin: '10px 0 0' }}>Did not get it? Check spam, or <button type="button" className="link-button" disabled={pending} onClick={send}>send it again</button>.</p>}
          <Err msg={error} />
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={reset}>Cancel</button>
            <button className={`button ${step === 'code' ? 'primary' : 'danger'}`} disabled={pending}>{pending ? 'Checking…' : step === 'code' ? 'Confirm and turn on' : 'Turn off two-step sign-in'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
