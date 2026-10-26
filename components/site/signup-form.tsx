'use client'
// The public sign-up (app/site/signup): the institute and its web address (checked as it is typed, and shown live as the
// full address under the field), the owner's login, the plan after the trial, the terms.
import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { ArrowRight, Check, Globe, X } from 'lucide-react'
import { checkSlugAction, signupAction } from '@/app/site/actions'

const suggest = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')

/** 0-4: length, a letter, a number, something else (or 14+ characters). */
const strength = (p: string) => (p.length < 10 ? (p ? 1 : 0) : 1 + Number(/[a-z]/i.test(p) && /\d/.test(p)) + Number(/[^a-z0-9]/i.test(p) || p.length >= 14) + Number(p.length >= 12))
const STRENGTH = ['', 'Too short', 'Fair', 'Good', 'Strong']

export type SignupPlan = { key: string; name: string; price: string }

export function SignupForm({ plans, plan, suffix, name: startName = '' }: { plans: SignupPlan[]; plan: string; suffix: string; name?: string }) {
  const [state, action, pending] = useActionState(signupAction, undefined)
  const [name, setName] = useState(startName)
  const [slug, setSlug] = useState('')
  const [edited, setEdited] = useState(false)
  const [slugNote, setSlugNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const address = edited ? slug : suggest(name)
  const level = strength(pw)

  // is the address free? asked a moment after typing stops
  useEffect(() => {
    if (address.length < 2) { setSlugNote(null); return }
    const t = setTimeout(async () => { const why = await checkSlugAction(address); setSlugNote(why ? { ok: false, text: why } : { ok: true, text: 'Available' }) }, 400)
    return () => clearTimeout(t)
  }, [address])

  return (
    <form action={action} className="au-card">
      <div className="au-sec">
        <h3><i>1</i> Your institute</h3>
        <label className="au-field">Institute name<input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} placeholder="e.g. Bright Future Academy" autoFocus={!startName} /></label>
        <label className="au-field">Web address
          <span className="au-addrin"><input name="slug" value={address} onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()) }} required aria-describedby="slug-note" placeholder="your-institute" /><span>{suffix}</span></span>
          {slugNote ? <span id="slug-note" className={`au-note ${slugNote.ok ? 'ok' : 'no'}`}>{slugNote.ok ? <Check size={14} /> : <X size={14} />}{slugNote.text}</span> : <small id="slug-note">Your staff and students sign in here. You can add your own domain later.</small>}
        </label>
        <div className="au-url" aria-live="polite"><Globe size={16} /><span>{name ? `${name} will live at ` : 'Your institute will live at '}https://<b>{address || 'your-institute'}</b>{suffix}</span></div>
      </div>

      <div className="au-sec">
        <h3><i>2</i> Your login</h3>
        <div className="au-two">
          <label className="au-field">Your name<input name="ownerName" required autoComplete="name" placeholder="Full name" /></label>
          <label className="au-field">Mobile<input name="mobile" type="tel" required autoComplete="tel" placeholder="98765 43210" /></label>
        </div>
        <label className="au-field">E-mail<input name="email" type="email" required autoComplete="email" placeholder="you@institute.com" /><small>You sign in with it; we send a 6-digit code here.</small></label>
        <label className="au-field">Password
          <span className="au-pw"><input name="password" type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} autoComplete="new-password" placeholder="At least 10 characters" />
            <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide the characters' : 'Show the characters'}>{show ? 'Hide' : 'Show'}</button></span>
        </label>
        {pw && <div><div className={`au-meter s${level}`} aria-hidden="true"><i /><i /><i /><i /></div><small className="au-note" style={{ color: level >= 3 ? 'var(--teal-d)' : 'var(--muted)', marginTop: 6 }}>{STRENGTH[level]}{level < 2 ? ': use 10 or more characters, with a letter and a number' : ''}</small></div>}
      </div>

      <div className="au-sec">
        <h3><i>3</i> Plan after the free trial</h3>
        <div className="au-plans" role="radiogroup" aria-label="Plan after the trial">
          {plans.map((p) => <label key={p.key} className="au-plan"><input type="radio" name="plan" value={p.key} defaultChecked={p.key === plan} /><b>{p.name}</b><small>{p.price}</small></label>)}
        </div>
        <small style={{ color: 'var(--muted)', fontSize: 13 }}>Every feature is open during the trial; change the plan any time.</small>
      </div>

      <label className="au-agree"><input type="checkbox" name="accept" required /><span>I accept the <Link href="/terms" target="_blank">terms</Link> and the <Link href="/privacy" target="_blank">privacy policy</Link>.</span></label>
      {state?.error && <p role="alert" className="au-error">{state.error}</p>}
      <button className="lp-btn sx-btn-brand au-submit" disabled={pending}>{pending ? 'Checking…' : 'Create my institute'} <ArrowRight size={17} /></button>
      <p className="au-fine" style={{ margin: 0 }}>No card needed. Already have one? <Link href="/find">Find your institute’s sign-in page</Link>.</p>
    </form>
  )
}
