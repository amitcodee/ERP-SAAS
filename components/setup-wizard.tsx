'use client'
// Set Up: one card per step, in order. A step is done when the institute has really done it; each can also be marked
// done or skipped. Branding, courses and fees are filled in here; the others open the screen that does them.
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CircleDashed, SkipForward } from 'lucide-react'
import { setupBrandingAction, setupCatalogueAction, setupFeesAction, setupStepAction } from '@/app/actions'
import { useNotify } from '@/components/panel-shell'
import type { Onboarding, StepKey } from '@/modules/onboarding/service'

type Branding = { legalName: string; tagline: string; color: string; hasLogo: boolean }
type CatalogueRef = { key: string; label: string; about: string; courses: number }

const LINKS: Partial<Record<StepKey, { href: string; label: string }>> = {
  branch: { href: '/branches', label: 'Open Branches' },
  staff: { href: '/users', label: 'Open Users & Staff' },
  email: { href: '/settings?tab=email', label: 'Open Settings → E-mail' },
  import: { href: '/import-old', label: 'Open the import' },
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
        <div><p className="eyebrow">Administration / Set Up</p><h1>Set up your institute</h1><p className="subheading">{state.settled} of {state.steps.length} done. Each step is ticked as soon as it is really done, here or on its own screen.</p></div>
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

function BrandingStep({ b, pending, save }: { b: Branding; pending: boolean; save: (v: { legalName: string; tagline: string; color: string; logo: string }) => void }) {
  const [v, setV] = useState({ legalName: b.legalName, tagline: b.tagline, color: b.color, logo: '' })
  const [err, setErr] = useState('')
  const pick = (file: File | undefined) => {
    setErr('')
    if (!file) return
    if (file.size > 200_000) return setErr('Use a logo under 200 KB')
    const r = new FileReader(); r.onload = () => setV((x) => ({ ...x, logo: String(r.result) })); r.readAsDataURL(file)
  }
  return (
    <form className="wl-form" onSubmit={(e) => { e.preventDefault(); save(v) }}>
      <label className="wide">Name as printed (receipts, certificates)<input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} required minLength={2} maxLength={160} /></label>
      <label className="wide">Tagline<input value={v.tagline} onChange={(e) => setV({ ...v, tagline: e.target.value })} maxLength={120} placeholder="e.g. Skills for a better career" /></label>
      <label>Colour<input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} /></label>
      <label>Logo{b.hasLogo ? ' (one is saved; pick another to change it)' : ''}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} /></label>
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
