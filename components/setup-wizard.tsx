'use client'
// Set Up: one card per step, in order. A step is done when the institute has really done it; each can also be marked
// done or skipped. Branding, courses and fees are filled in here; the others open the screen that does them.
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleDashed, SkipForward } from 'lucide-react'
import { enableFeatureAction, setupBrandingAction, setupCatalogueAction, setupFeesAction, setupStepAction } from '@/app/actions'
import { useNotify } from '@/components/panel-shell'
import type { Onboarding, StepKey } from '@/modules/onboarding/service'

type Contact = { address: string; phone: string; website: string; social: string }
type Branding = { legalName: string; tagline: string; color: string; hasLogo: boolean; hasAccreditations: boolean; contact: Contact }
type BrandingSave = { legalName: string; tagline: string; color: string; logo: string; accreditations: string; removeAccreditations: boolean; contact: Contact }

/** A picked image as a PNG data URL, at most `max` px wide (certificates and receipts print PNG or JPEG only). */
function asPng(file: File, max = 1200): Promise<string> {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      const w = Math.min(max, img.naturalWidth || max), h = Math.round(((img.naturalHeight || w) * w) / (img.naturalWidth || w))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      c.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url); ok(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('That file is not an image')) }
    img.src = url
  })
}
type CatalogueRef = { key: string; label: string; about: string; courses: number }

const LINKS: Partial<Record<StepKey, { href: string; label: string }>> = {
  branch: { href: '/branches', label: 'Open Branches' },
  staff: { href: '/users', label: 'Open Users & Staff' },
  email: { href: '/settings?tab=email', label: 'Open Settings → E-mail' },
  import: { href: '/import', label: 'Import from a spreadsheet' },
}
const GST = [0, 5, 12, 18]

export function SetupWizard({ state, branding, catalogues, gst, modes }: { state: Onboarding; branding: Branding; catalogues: CatalogueRef[]; gst: number; modes: string[] }) {
  const notify = useNotify()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState<StepKey | null>(state.steps.find((s) => !s.done && !s.skipped)?.key ?? null)
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); notify(r.ok ? msg : r.error ?? 'Failed'); if (r.ok) router.refresh() })

  return (
    <section className="page-container">
      <div className="page-heading">
        <div><p className="eyebrow">Setup / Set Up</p><h1>Set up your institute</h1><p className="subheading">{state.settled} of {state.steps.length} done. Each step is ticked as soon as it is really done, here or on its own screen.</p></div>
        {state.complete && !state.dismissed && <button type="button" className="button primary" disabled={pending} onClick={() => act(() => setupStepAction('dismiss', 'done'), 'All set')}>Finish</button>}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {state.steps.map((s, i) => (
          <div key={s.key} className="panel" style={{ borderLeft: `4px solid ${s.done ? '#16a34a' : s.skipped ? '#94a3b8' : '#4a4af4'}` }}>
            <button type="button" onClick={() => setOpen(open === s.key ? null : s.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }} aria-expanded={open === s.key}>
              {s.done ? <Check size={20} color="#16a34a" /> : s.skipped ? <SkipForward size={20} color="#94a3b8" /> : <CircleDashed size={20} color="#4a4af4" />}
              <span style={{ flex: 1 }}><strong>{i + 1}. {s.label}</strong><small style={{ display: 'block', color: '#64748b' }}>{s.about}</small></span>
              <span className="filter-button">{s.done ? 'Done' : s.skipped ? 'Skipped' : 'To do'}</span>
            </button>
            {open === s.key && (
              <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
                {s.key === 'branding' && <BrandingStep b={branding} pending={pending} save={(v) => act(() => setupBrandingAction(v), 'Saved')} />}
                {s.key === 'courses' && (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                    {catalogues.map((c) => (
                      <div key={c.key} className="panel" style={{ border: '1px solid var(--line)', display: 'grid', gap: 8 }}>
                        <strong>{c.label}</strong><small>{c.about} {c.courses} courses.</small>
                        <button type="button" className="button secondary" disabled={pending} onClick={() => start(async () => { const r = await setupCatalogueAction(c.key); notify(r.ok ? `Added ${r.data!.departments} departments and ${r.data!.courses} courses` : r.error); router.refresh() })}>Add these</button>
                      </div>
                    ))}
                    <p className="section-hint" style={{ margin: 0 }}>Or add your own under <Link href="/courses">Courses</Link>. Fees and durations can be changed there.</p>
                  </div>
                )}
                {s.key === 'branch' && <ShapeStep pending={pending} franchises={() => act(() => enableFeatureAction('franchise'), 'Franchises is on: make a branch a franchise from Branches')} />}
                {s.key === 'fees' && <FeesStep gst={gst} modes={modes} pending={pending} save={(v) => act(() => setupFeesAction(v), 'Saved')} />}
                {LINKS[s.key] && <p style={{ margin: 0 }}><Link className="button secondary" href={LINKS[s.key]!.href}>{LINKS[s.key]!.label}</Link></p>}
                <div className="row-actions">
                  {!s.done && <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => setupStepAction(s.key, 'done'), 'Marked done')}>Mark done</button>}
                  {!s.done && !s.skipped && <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => setupStepAction(s.key, 'skip'), 'Skipped')}>Skip for now</button>}
                  {s.skipped && <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => setupStepAction(s.key, 'undo'), 'Back on the list')}>Do it after all</button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {!state.complete && !state.dismissed && <p className="section-hint" style={{ marginTop: 16 }}>Not now? <button type="button" className="filter-button" disabled={pending} onClick={() => act(() => setupStepAction('dismiss', 'done'), 'Put away: Set Up stays under Administration')}>Hide the checklist</button></p>}
    </section>
  )
}

/** How the institute is run: one centre, several of its own, or with franchises; each answer says what to do next. */
function ShapeStep({ pending, franchises }: { pending: boolean; franchises: () => void }) {
  const [shape, setShape] = useState<'one' | 'several' | 'franchise' | null>(null)
  const opt = (k: 'one' | 'several' | 'franchise', label: string, sub: string) => (
    <button type="button" className={`panel${shape === k ? ' on' : ''}`} onClick={() => { setShape(k); if (k === 'franchise') franchises() }} disabled={pending}
      style={{ textAlign: 'left', border: `1.5px solid ${shape === k ? 'var(--navy)' : 'var(--line)'}`, cursor: 'pointer', display: 'grid', gap: 4 }}>
      <strong>{label}</strong><small style={{ color: '#64748b' }}>{sub}</small>
    </button>
  )
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <strong>How is your institute run?</strong>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {opt('one', 'One centre', 'Fill in its details; you work in it directly.')}
        {opt('several', 'Several centres of my own', 'Add each one in Branches; head office sees them all.')}
        {opt('franchise', 'My own centres and franchises', 'Partners run some centres and pay you a royalty.')}
      </div>
      {shape === 'one' && <p className="section-hint" style={{ margin: 0 }}>Open Branches, complete your branch’s details (address, phone, e-mail) and activate it.</p>}
      {shape === 'several' && <p className="section-hint" style={{ margin: 0 }}>Open Branches: complete the first branch, then <b>Add branch</b> for each other centre. Each gets its own manager login.</p>}
      {shape === 'franchise' && <p className="section-hint" style={{ margin: 0 }}>Add each centre in Branches; for a franchise, press <b>Make a franchise</b> there: the partner’s name goes on its receipts and its royalty shows under Franchises.</p>}
    </div>
  )
}

function BrandingStep({ b, pending, save }: { b: Branding; pending: boolean; save: (v: BrandingSave) => void }) {
  const [v, setV] = useState<BrandingSave>({ legalName: b.legalName, tagline: b.tagline, color: b.color, logo: '', accreditations: '', removeAccreditations: false, contact: b.contact })
  const contact = (k: keyof Contact, value: string) => setV((x) => ({ ...x, contact: { ...x.contact, [k]: value } }))
  const [err, setErr] = useState('')
  const pick = (key: 'logo' | 'accreditations', file: File | undefined) => {
    setErr('')
    if (!file) return
    if (file.size > 2_000_000) return setErr('Use an image under 2 MB')
    asPng(file, key === 'logo' ? 1000 : 1600).then((png) => {
      if (png.length > 450_000) return setErr('That image is too detailed: use a smaller one')
      setV((x) => ({ ...x, [key]: png, ...(key === 'accreditations' ? { removeAccreditations: false } : {}) }))
    }, (e: Error) => setErr(e.message))
  }
  return (
    <form className="wl-form" onSubmit={(e) => { e.preventDefault(); save(v) }}>
      <label className="wide">Name as printed (receipts, certificates)<input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} required minLength={2} maxLength={160} /></label>
      <label className="wide">Tagline<input value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} maxLength={120} placeholder="e.g. Skills for a better career" /></label>
      <label>Colour<input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} /></label>
      <label>Logo{b.hasLogo ? ' (one is saved; pick another to change it)' : ''}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick('logo', e.target.files?.[0])} /></label>
      <label>Affiliations / accreditations (optional, printed on course certificates){b.hasAccreditations && !v.removeAccreditations ? ' (one is saved)' : ''}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick('accreditations', e.target.files?.[0])} /></label>
      {b.hasAccreditations && !v.accreditations && <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={v.removeAccreditations} onChange={(e) => setV({ ...v, removeAccreditations: e.target.checked })} /> Remove the saved accreditations image</label>}
      <p className="wide section-hint" style={{ margin: 0 }}>Printed on the student ID card (each is optional):</p>
      <label className="wide">Address<input value={v.contact.address} onChange={(e) => contact('address', e.target.value)} maxLength={200} placeholder="e.g. Main office, 2nd floor, Mall Road, Ludhiana" /></label>
      <label>Phone<input value={v.contact.phone} onChange={(e) => contact('phone', e.target.value)} maxLength={40} placeholder="e.g. +91 98xxxxxxxx" /></label>
      <label>Website<input value={v.contact.website} onChange={(e) => contact('website', e.target.value)} maxLength={120} placeholder="e.g. www.yourinstitute.com" /></label>
      <label className="wide">Social page (the card's “Follow us” code)<input value={v.contact.social} onChange={(e) => contact('social', e.target.value)} maxLength={200} placeholder="https://www.instagram.com/…" /></label>
      {err && <p className="login-error" style={{ margin: 0 }}>{err}</p>}
      <div className="wide"><button className="button primary" disabled={pending}>Save</button></div>
    </form>
  )
}

function FeesStep({ gst, modes, pending, save }: { gst: number; modes: string[]; pending: boolean; save: (v: { gstPct: number; paymentModes: string[] }) => void }) {
  const [pct, setPct] = useState(gst)
  const [extra, setExtra] = useState('')
  return (
    <form className="wl-form" onSubmit={(e) => { e.preventDefault(); save({ gstPct: pct, paymentModes: extra.split(',').map((x) => x.trim()).filter(Boolean) }) }}>
      <label>GST on your fees<select value={pct} onChange={(e) => setPct(Number(e.target.value))}>{GST.map((g) => <option key={g} value={g}>{g === 0 ? 'No GST' : `${g}%`}</option>)}</select></label>
      <label className="wide">Ways to pay you take now: {modes.join(', ') || 'none yet'}<input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Add more, separated by commas (e.g. UPI, Bank transfer)" /></label>
      <div className="wide"><button className="button primary" disabled={pending}>Save</button></div>
    </form>
  )
}
