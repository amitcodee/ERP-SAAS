'use client'
import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'
import { checkSlugAction, signupAction } from '@/app/site/actions'

const suggest = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')

export function SignupForm({ plans, plan, suffix }: { plans: { key: string; name: string }[]; plan: string; suffix: string }) {
  const [state, action, pending] = useActionState(signupAction, undefined)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [edited, setEdited] = useState(false)
  const [slugNote, setSlugNote] = useState<{ ok: boolean; text: string } | null>(null)
  const address = edited ? slug : suggest(name)

  // is the address free? asked a moment after typing stops
  useEffect(() => {
    if (address.length < 2) { setSlugNote(null); return }
    const t = setTimeout(async () => { const why = await checkSlugAction(address); setSlugNote(why ? { ok: false, text: why } : { ok: true, text: 'Available' }) }, 400)
    return () => clearTimeout(t)
  }, [address])

  return (
    <form action={action} className="site-form">
      <label>Institute name<input name="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} placeholder="e.g. Bright Future Academy" /></label>
      <label>Web address
        <span className="addr"><input name="slug" value={address} onChange={(e) => { setEdited(true); setSlug(e.target.value.toLowerCase()) }} required aria-describedby="slug-note" /><span>{suffix}</span></span>
        {slugNote && <small id="slug-note" style={{ color: slugNote.ok ? '#166534' : '#b91c1c' }}>{slugNote.text}</small>}
      </label>
      <label>Your name<input name="ownerName" required autoComplete="name" /></label>
      <label>E-mail<input name="email" type="email" required autoComplete="email" /><small>You sign in with it. We send the code here.</small></label>
      <label>Mobile<input name="mobile" type="tel" required autoComplete="tel" placeholder="98765 43210" /></label>
      <label>Password<input name="password" type="password" required minLength={10} autoComplete="new-password" /><small>At least 10 characters, with a letter and a number.</small></label>
      <label>Plan after the trial<select name="plan" defaultValue={plan}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select><small>You can change it any time.</small></label>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}><input type="checkbox" name="accept" required style={{ height: 18, width: 18, marginTop: 2 }} /><span>I accept the <Link href="/terms" target="_blank">terms</Link> and the <Link href="/privacy" target="_blank">privacy policy</Link>.</span></label>
      {state?.error && <p role="alert" className="site-error">{state.error}</p>}
      <button className="lp-btn lp-btn-dark" disabled={pending}>{pending ? 'Checking…' : 'Create my institute'}</button>
      <small>Already have one? <Link href="/find">Find your institute’s sign-in page</Link>.</small>
    </form>
  )
}
