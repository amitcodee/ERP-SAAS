'use client'
// The admission form a visitor fills in (/apply on the institute's address, or /apply/embed inside its own website):
// name, mobile, the centre and course, and what the institute asks for besides. Sent, it becomes a lead
// (modules/web-leads/apply.ts). Embedded, it tells the page holding it how tall it is (/apply/embed.js listens).
import { useEffect, useRef, useState, useTransition } from 'react'
import { submitApplicationAction } from '@/app/apply/actions'
import { useBrand } from '@/components/brand-context'
import { BrandMark } from '@/components/brand-mark'
import type { ApplyForm, Utm } from '@/modules/web-leads/apply'

export function AdmissionForm({ f, embed, page, referrer, utm, branchCode }: {
  f: ApplyForm; embed: boolean
  /** Embedded: the website page holding the form (else this page's own address). */
  page?: string; referrer?: string; utm: Utm; branchCode?: string
}) {
  const brand = useBrand()
  const preset = f.branches.find((b) => branchCode && b.code.toLowerCase() === branchCode.toLowerCase())
  const [v, setV] = useState({ name: '', phone: '', email: '', course: '', branchId: f.branches.length === 1 ? f.branches[0].id : preset?.id ?? '', location: '', message: '', website: '' })
  const [error, setError] = useState('')
  const [thanks, setThanks] = useState('')
  const [pending, start] = useTransition()
  const box = useRef<HTMLElement>(null)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value })

  // embedded: keep the frame as tall as the form (the page holding it sets the height it is told)
  useEffect(() => {
    if (!embed || !box.current || window.parent === window) return
    const tell = () => window.parent.postMessage({ type: 'apply:height', h: Math.ceil(document.documentElement.scrollHeight) }, '*')
    const ro = new ResizeObserver(tell)
    ro.observe(box.current)
    tell()
    return () => ro.disconnect()
  }, [embed])

  const send = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const r = await submitApplicationAction({ ...v, page: page || window.location.href, referrer: referrer ?? document.referrer, utm, ticket: f.ticket })
      if (!r.ok) { setError(r.error); return }
      setError(''); setThanks(r.data.thanks)
      if (!embed) window.scrollTo({ top: 0 })
    })
  }
  const ready = v.name.trim().length >= 2 && v.phone.replace(/\D/g, '').length >= 10 && !!v.branchId

  return (
    <main ref={box} className={`ap${embed ? ' ap-embed' : ''}`}>
      <style>{CSS}</style>
      <div className="ap-card">
        <header className="ap-head">
          {!embed && <div className="ap-logo"><BrandMark brand={brand} height={40} /></div>}
          <h1>{f.form.heading || 'Apply for admission'}</h1>
          {!embed && <p className="ap-org">{brand.name}</p>}
        </header>
        {!f.enabled ? <p className="ap-closed">Admissions are not open online right now. Please call or visit the institute.</p>
          : thanks ? <div className="ap-done" role="status"><div className="ap-tick" aria-hidden>✓</div><h2>Form received</h2><p>{thanks}</p></div>
          : <>
            {f.form.intro && <p className="ap-intro">{f.form.intro}</p>}
            <form className="ap-form" onSubmit={send}>
              <label>Full name<input value={v.name} onChange={set('name')} autoComplete="name" maxLength={120} required /></label>
              <label>Mobile number<input type="tel" inputMode="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" maxLength={20} required /></label>
              {f.form.askEmail && <label>E-mail <small>(optional)</small><input type="email" value={v.email} onChange={set('email')} autoComplete="email" maxLength={160} /></label>}
              {f.branches.length > 1 && (
                <label>Centre
                  <select value={v.branchId} onChange={set('branchId')} required>
                    <option value="">Choose the centre nearest to you</option>
                    {f.branches.map((b) => <option key={b.id} value={b.id}>{b.city && !b.name.toLowerCase().includes(b.city.toLowerCase()) ? `${b.name} (${b.city})` : b.name}</option>)}
                  </select>
                </label>
              )}
              {f.courses.length > 0 && (
                <label>Course <small>(optional)</small>
                  <select value={v.course} onChange={set('course')}>
                    <option value="">Not sure yet</option>
                    {f.courses.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {f.form.askLocation && <label>Your area or city <small>(optional)</small><input value={v.location} onChange={set('location')} autoComplete="address-level2" maxLength={160} /></label>}
              {f.form.askMessage && <label>Anything you would like to ask? <small>(optional)</small><textarea value={v.message} onChange={set('message')} rows={3} maxLength={1500} /></label>}
              {/* people never see this field; robots fill it */}
              <label className="ap-hp" aria-hidden="true">Website<input value={v.website} onChange={set('website')} tabIndex={-1} autoComplete="off" /></label>
              {error && <p className="ap-error" role="alert">{error}</p>}
              <button type="submit" disabled={!ready || pending}>{pending ? 'Sending…' : 'Send'}</button>
              <p className="ap-note">By sending this form you agree that {brand.name} may call, WhatsApp or e-mail you about admission.</p>
            </form>
          </>}
      </div>
    </main>
  )
}

const CSS = `
.ap { min-height: 100vh; background: linear-gradient(160deg, var(--navy-900) 0%, var(--navy) 60%, var(--indigo) 140%); padding: 20px 14px 30px; display: grid; justify-items: center; align-content: start; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--ink); }
.ap.ap-embed { min-height: 0; background: transparent; padding: 0; }
.ap-card { width: 100%; max-width: 560px; background: #fff; border-radius: 20px; padding: 22px 20px; box-shadow: 0 24px 60px -20px #0009; box-sizing: border-box; }
.ap-embed .ap-card { max-width: none; box-shadow: none; border: 1px solid var(--line); border-radius: 16px; }
.ap-head { text-align: center; display: grid; justify-items: center; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.ap-logo { max-width: 160px; }
.ap-head h1 { margin: 4px 0 0; font-size: 23px; line-height: 1.2; }
.ap-org { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; }
.ap-intro { white-space: pre-line; color: var(--text); font-size: 14px; line-height: 1.55; margin: 14px 0 0; }
.ap-closed { margin: 18px 0 4px; padding: 14px; border-radius: 12px; background: #fff7e6; color: #92400e; text-align: center; font-weight: 600; }
.ap-form { display: grid; gap: 12px; margin-top: 16px; }
.ap-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 700; }
.ap-form small { color: var(--muted); font-weight: 500; }
.ap-form input, .ap-form select, .ap-form textarea { min-height: 46px; padding: 0 14px; border: 1px solid #d8dbea; border-radius: 12px; font: inherit; font-size: 16px; font-weight: 400; background: #fff; color: var(--ink); width: 100%; box-sizing: border-box; }
.ap-form textarea { padding: 10px 14px; resize: vertical; }
.ap-form input:focus, .ap-form select:focus, .ap-form textarea:focus { outline: 2px solid var(--navy); border-color: transparent; }
.ap-hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.ap button { height: 50px; border: 0; border-radius: 14px; background: var(--navy); color: #fff; font-size: 16px; font-weight: 800; cursor: pointer; width: 100%; }
.ap button:disabled { opacity: .5; cursor: default; }
.ap-note { margin: 0; color: var(--muted); font-size: 12px; text-align: center; line-height: 1.45; }
.ap-error { margin: 0; padding: 10px 12px; border-radius: 10px; background: #fef2f2; color: #b91c1c; font-size: 13px; font-weight: 600; }
.ap-done { text-align: center; display: grid; gap: 8px; justify-items: center; padding: 18px 0 6px; }
.ap-tick { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: #ecfdf5; color: #047857; font-size: 26px; font-weight: 800; }
.ap-done h2 { margin: 0; font-size: 20px; }
.ap-done p { margin: 0; color: var(--text); white-space: pre-line; }
`
