'use client'
// New registration as a page of its own, with no side menu, filled in one step at a time.
// (/registrations/new, or /registrations/new?enquiry=<id> to start from a lead or visited enquiry.)
// Step 1 is the office's: find the student's enquiry (their details are then fetched), the course and the fee. The
// tablet can then be handed to the student for their profile, contact numbers and photo; the last step is a check.
import { useEffect, useState, useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { BranchMatches } from '@/components/branch-matches'
import { useRouter } from 'next/navigation'
import { IdCard as IdCardIcon } from 'lucide-react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ListPlus, Plus, Trash2, UserRound, X } from 'lucide-react'
import { callForRegistrationAction, enquiryForRegistrationAction, findRegistrationSourcesAction, findRegistrationsToUpgradeAction, registerStudentAction, registrationForUpgradeAction } from '@/app/actions'
import { DateInput } from '@/components/date-input'
import { EnquirySearch, type EnquiryHit } from '@/components/enquiry-search'
import { FeePlanEditor, newPlanState, planLines, planPayload, planStateProblem, type PlanState } from '@/components/fee-plan-editor'
import { planLabel, planLimits } from '@/modules/fees/plan'
import { Err } from '@/components/modal'
import { PhotoCapture } from '@/components/photo-capture'
import type { TemplateRef } from '@/modules/letters/service'
import { companyTemplateOptions, letterCompaniesOf } from '@/lib/letters/options'
import type { Catalogs } from '@/modules/catalog/service'
import { formatAadhaar, isValidAadhaar } from '@/modules/people/aadhaar'
import type { CallForRegistration, EnquiryForRegistration, RegistrationForUpgrade, SourceFilter, StudentPrefill } from '@/modules/registrations/service'
import { useBrand } from '@/components/brand-context'
import { BrandMark } from '@/components/brand-mark'

const money = (paise: number) => (paise ? `₹${(paise / 100).toLocaleString('en-IN')}` : '₹0')
const inr = (paise: number | null) => (paise ? `₹${(paise / 100).toLocaleString('en-IN')}` : '—')
const fmtDay = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const STATUS: Record<string, string> = { new: 'New', contacted: 'Contacted', follow_up: 'Follow-up', demo: 'Demo', joined: 'Joined', not_joined: 'Not joined', dead: 'Dead' }
const GST_RATES = ['0', '5', '6', '12', '18']
const MOBILE = '(\\+?91[\\s\\-]?)?[6-9][0-9]{9}' // a 10-digit Indian mobile, with or without +91
/** "24 weeks (about 6 months)" */
const duration = (weeks: number | null | undefined) => (weeks ? `${weeks} week${weeks === 1 ? '' : 's'}${weeks >= 8 ? ` (about ${Math.round(weeks / 4.345)} months)` : ''}` : 'Not set for this course')
const digits = (v: string) => v.replace(/\D/g, '') // money boxes take whole rupees: digits only
const REG_STATUS: Record<string, string> = { active: 'Active', on_hold: 'On hold', discontinued: 'Discontinued', completed: 'Completed' }
const FILTERS: [SourceFilter, string][] = [['all', 'All'], ['call', 'Random calls'], ['lead', 'Leads'], ['visited', 'Visited']]
const TAG = { call: 'Random call', lead: 'Lead', visited: 'Visited', registration: 'Registration' } as const
// A course's duration (weeks) is counted at this pace; other daily hours finish it sooner or later.
const BASE_HOURS_PER_DAY = 2
const BASE_DAYS_PER_WEEK = 6
const DAILY = [['60', '1 hour'], ['90', '1½ hours'], ['120', '2 hours'], ['180', '3 hours'], ['240', '4 hours']]
// Class slots can start on the hour from 7 AM to 8 PM; how long a slot is comes from the daily class time.
const SLOT_STARTS = Array.from({ length: 14 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`)
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** "11 AM", "12:30 PM" */
const clock = (hhmm: string, plusMin = 0) => { const [h, m] = hhmm.split(':').map(Number); const t = (h * 60 + m + plusMin) % 1440; const hh = Math.floor(t / 60); return `${hh % 12 || 12}${t % 60 ? `:${String(t % 60).padStart(2, '0')}` : ''} ${hh < 12 ? 'AM' : 'PM'}` }
/** "about 6 weeks" / "about 3 months" */
const span = (days: number) => (days < 56 ? `about ${Math.max(1, Math.round(days / 7))} week${Math.round(days / 7) === 1 ? '' : 's'}` : `about ${Math.round(days / 30.4)} months`)
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
/** The name a field goes by in a message: its label's text, or its aria-label. */
const fieldName = (el: Field) => (el.getAttribute('aria-label') ?? el.closest('label')?.firstChild?.textContent ?? 'This field').replace(/\*/g, '').trim()
/** What is wrong with a field, in plain words (the browser's own pop-up messages are switched off). */
function problem(el: Field): string {
  const v = el.validity, name = fieldName(el)
  if (v.valueMissing) return el instanceof HTMLSelectElement ? `Choose ${name.toLowerCase()}.` : `${name} is required.`
  if (v.typeMismatch && el.type === 'email') return 'Enter a valid email address, like name@example.com.'
  if (v.patternMismatch) return el.title ? `Enter a ${el.title.toLowerCase()}.` : `${name} is not in the right form.`
  if (v.tooShort) return `${name} is too short.`
  return `${name} is not valid.`
}
/** Marks the fields of the form that are not filled in properly, each with its message; returns them. */
function markProblems(form: HTMLFormElement): Field[] {
  form.querySelectorAll('[data-error]').forEach((n) => n.removeAttribute('data-error'))
  const bad = [...form.querySelectorAll<Field>('input, select, textarea')].filter((el) => !el.disabled && !el.checkValidity())
  for (const el of bad) el.closest('label, .reg-module')?.setAttribute('data-error', problem(el))
  return bad
}
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

type F = {
  firstName: string; lastName: string; phone: string; altPhone: string; email: string; dob: string; gender: string; address: string
  fatherName: string; motherName: string; guardianPhone: string
  aadhaar: string; occTypeId: string; qualification: string; college: string
  deptId: string; courseId: string; classModeId: string; enrollmentDate: string; joiningDate: string
  dailyMin: string; daysPerWeek: string; classStart: string // class time each day, class days a week, and when the class starts ('HH:MM')
  courseFee: string; gstPct: string // the course's fee in rupees before GST, and the GST rate: together the total fees
  offerFee: string // the fee offered to this student, GST included; empty = the total fees (no discount)
}
/** A customized course: the student's own choice of modules instead of a course from the list. */
type Custom = { on: boolean; title: string; weeks: string; feeMode: 'modules' | 'total'; modules: { name: string; fee: string }[] }
const NO_CUSTOM: Custom = { on: false, title: '', weeks: '', feeMode: 'modules', modules: [{ name: '', fee: '' }] }
const EMPTY: F = { firstName: '', lastName: '', phone: '', altPhone: '', email: '', dob: '', gender: '', address: '', fatherName: '', motherName: '', guardianPhone: '', aadhaar: '', occTypeId: '', qualification: '', college: '', deptId: '', courseId: '', classModeId: '', enrollmentDate: '', joiningDate: '', dailyMin: '120', daysPerWeek: '6', classStart: '', courseFee: '', gstPct: '0', offerFee: '' }
const fromEnquiry = (e: StudentPrefill, keep: F): F => ({
  ...keep,
  firstName: e.firstName, lastName: e.lastName ?? '', phone: e.phone, altPhone: e.altPhone ?? '', email: e.email ?? '', dob: e.dob ?? '', gender: e.gender ?? '', address: e.address ?? '',
  fatherName: e.fatherName ?? '', motherName: e.motherName ?? '', guardianPhone: e.guardianPhone ?? '',
  aadhaar: e.aadhaarNo ? formatAadhaar(e.aadhaarNo) : '', occTypeId: e.occupationTypeId ?? '', qualification: e.qualification ?? '', college: e.schoolOrCollege ?? '',
  deptId: e.departmentId ?? '', courseId: e.courseId ?? '', classModeId: e.classModeId ?? '',
  // The enquiry's actual fee is the course fee; its discounted / proposed fee is the offer.
  courseFee: e.courseFee ?? e.proposedFee ? String((e.courseFee ?? e.proposedFee)! / 100) : '',
  offerFee: e.courseFee && e.proposedFee && e.proposedFee < e.courseFee ? String(e.proposedFee / 100) : '',
})

const STEPS = [
  { title: 'Office details', hint: 'Filled by the institute' },
  { title: 'Student profile', hint: 'As on the ID proof' },
  { title: 'Contact details', hint: 'Student and parents' },
  { title: 'Photo', hint: 'For the ID card' },
  { title: 'Check & register', hint: 'Confirm everything' },
] as const

export function RegistrationNew({ catalogs, enquiry, regNo, branchName, templates, defaultGst = 0 }: { catalogs: Catalogs; enquiry: EnquiryForRegistration | null; regNo: string | null; branchName: string | null; templates: TemplateRef[]; defaultGst?: number }) {
  const brand = useBrand()
  const router = useRouter()
  const [done, setDone] = useState<{ id: string; regNo: string; name: string; note: string } | null>(null)
  const [plan, setPlan] = useState<PlanState>(() => newPlanState(today())) // how the fee is paid
  const [enq, setEnq] = useState<EnquiryForRegistration | null>(enquiry)
  // the institute's usual GST (Set Up → Fees), when it is one of the rates offered
  const blank = (): F => ({ ...EMPTY, enrollmentDate: today(), joiningDate: today(), gstPct: GST_RATES.includes(String(defaultGst)) ? String(defaultGst) : '0' })
  const [f, setF] = useState<F>(() => (enquiry ? fromEnquiry(enquiry, blank()) : blank()))
  const [kind, setKind] = useState<'new' | 'upgrade'>('new')
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [call, setCall] = useState<CallForRegistration | null>(null) // the random call the details were fetched from
  const [prev, setPrev] = useState<RegistrationForUpgrade | null>(null) // upgrade: the older registration
  const [ownSlot, setOwnSlot] = useState(false) // class time typed by hand instead of one of the slots
  const [custom, setCustom] = useState<Custom>(NO_CUSTOM)
  const [projectCert, setProjectCert] = useState(false) // a project certificate comes with the course certificate
  // internship letters the student needs, the company they come from ('' = the main one) and the template for each ('' = Standard)
  const [letters, setLetters] = useState({ offer: false, completion: false, offerTpl: '', completionTpl: '', company: '' })
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [idCard, setIdCard] = useState<File | null>(null) // a picture or PDF of the Aadhaar card (optional)
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const set = (patch: Partial<F>) => setF((cur) => ({ ...cur, ...patch }))
  const courses = catalogs.courses.filter((c) => !f.deptId || c.departmentId === f.deptId)
  const last = STEPS.length - 1
  const course = catalogs.courses.find((c) => c.id === f.courseId)
  // Money is kept in paise. Course fee + GST = total fees; the offer fee (the total unless a lower one is typed) is
  // what the student pays, and the difference is the discount. The offer includes GST, so it is split back into its parts.
  // A customized course priced by module: its course fee is the sum of the module fees.
  const byModule = custom.on && custom.feeMode === 'modules'
  const rupees = (v: string) => (v ? Math.round(Number(v) * 100) : 0)
  const feePaise = byModule ? custom.modules.reduce((n, m) => n + rupees(m.fee), 0) : rupees(f.courseFee)
  const setModule = (i: number, patch: Partial<Custom['modules'][number]>) => setCustom((c) => ({ ...c, modules: c.modules.map((m, k) => (k === i ? { ...m, ...patch } : m)) }))
  const courseName = custom.on ? `${custom.title || '—'} (customized)` : course?.title ?? '—'
  const courseTime = custom.on ? (custom.weeks ? duration(Number(custom.weeks)) : '—') : course ? duration(course.durationWeeks) : '—'
  const totalPaise = feePaise + Math.round(feePaise * Number(f.gstPct) / 100)
  const payPaise = f.offerFee ? Math.round(Number(f.offerFee) * 100) : totalPaise
  const offerTooHigh = totalPaise > 0 && payPaise > totalPaise
  const discountPaise = totalPaise - payPaise
  const payBase = Math.round(payPaise * 100 / (100 + Number(f.gstPct)))
  const payGst = payPaise - payBase
  // Class schedule: the course's hours (from its duration) at the chosen daily class time give the finish date.
  const weeks = custom.on ? Number(custom.weeks) || 0 : course?.durationWeeks ?? 0
  const totalHours = weeks * BASE_DAYS_PER_WEEK * BASE_HOURS_PER_DAY
  const classDays = totalHours ? Math.ceil(totalHours * 60 / Number(f.dailyMin)) : 0
  const runDays = classDays ? Math.ceil(classDays / Number(f.daysPerWeek) * 7) : 0
  const endDate = runDays && f.joiningDate ? addDays(f.joiningDate, runDays) : ''
  const limits = planLimits(f.joiningDate, endDate) // installments: fewer than the course's months, the last a month before it ends
  const classTime = f.classStart ? `${clock(f.classStart)} to ${clock(f.classStart, Number(f.dailyMin))}` : ''
  const locked = !!enq || !!prev // the student is already on record: name and number are not retyped
  const source = enq ?? call ?? prev
  /** Leaves the fetched student: the form is emptied, the office's dates are kept. */
  const clearSource = () => { setEnq(null); setCall(null); setPrev(null); setF((cur) => ({ ...blank(), enrollmentDate: cur.enrollmentDate, joiningDate: cur.joiningDate })) }

  useEffect(() => {
    if (!photo) { setPhotoUrl(''); return }
    const u = URL.createObjectURL(photo)
    setPhotoUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])

  // A red message goes away as soon as its field is right, also when the form filled it in (e.g. the fee of a chosen course).
  useEffect(() => {
    document.querySelectorAll('.reg-wizard [data-error]').forEach((n) => {
      if ([...n.querySelectorAll<Field>('input, select, textarea')].every((el) => el.checkValidity())) n.removeAttribute('data-error')
    })
  })

  const go = (n: number) => { setError(''); setStep(n); setReached((r) => Math.max(r, n)); window.scrollTo({ top: 0 }) }
  const pick = (id: string, hit: { kind: string }) => {
    start(async () => {
      setError('')
      if (hit.kind === 'registration') {
        const r = await registrationForUpgradeAction(id)
        if (!r.ok || !r.data) return setError(r.ok ? 'This registration is not available' : r.error)
        setPrev(r.data); setCustom(NO_CUSTOM); setF((cur) => ({ ...fromEnquiry(r.data!, cur), courseId: '', courseFee: '', offerFee: '' })) // the upgraded course is chosen fresh
      } else if (hit.kind === 'call') {
        const r = await callForRegistrationAction(id)
        if (!r.ok || !r.data) return setError(r.ok ? 'This call is not available' : r.error)
        setCall(r.data); setF((cur) => ({ ...fromEnquiry(r.data!, cur), classModeId: cur.classModeId }))
      } else {
        const r = await enquiryForRegistrationAction(id)
        if (!r.ok || !r.data) return setError(r.ok ? 'This enquiry is not available' : r.error)
        setEnq(r.data); setF((cur) => fromEnquiry(r.data!, cur))
      }
    })
  }
  const changeKind = (k: 'new' | 'upgrade') => { if (k !== kind) { setKind(k); if (source) clearSource() } }

  /** What still stops this step from being left; '' when it is complete. (Required fields are checked by the browser.) */
  function blocked() {
    if (step === 0 && kind === 'upgrade' && !prev) return 'Search and choose the registration this student is upgrading from.'
    if (step === 0 && f.joiningDate < f.enrollmentDate) return 'The joining date cannot be before the registration date.'
    if (step === 0 && custom.on && !custom.modules.some((m) => m.name.trim())) return 'Add at least one module to the customized course.'
    if (step === 0 && byModule && custom.modules.some((m) => rupees(m.fee) <= 0)) return 'Enter the fee of every module, or switch to one fee for the whole course.'
    if (step === 0 && feePaise <= 0) return 'Enter the course fee.'
    if (step === 0 && payPaise <= 0) return 'Enter the offer fee, or leave it empty when there is no discount.'
    if (step === 0 && payPaise > totalPaise) return `The offer fee cannot be more than the total fees (${inr(totalPaise)}).`
    if (step === 0 && (!f.enrollmentDate || !f.joiningDate)) return 'Choose the registration date and the joining date.'
    if (step === 0 && planStateProblem(plan, payPaise, limits)) return `Payment plan: ${planStateProblem(plan, payPaise, limits)}`
    if (step === 1 && !f.dob) return 'Choose the date of birth.'
    if (step === 1 && f.aadhaar && !isValidAadhaar(f.aadhaar)) return 'The Aadhaar number is not valid. Check the 12 digits on the card, or leave it empty for now.'
    return ''
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const bad = markProblems(e.currentTarget as HTMLFormElement)
    if (bad.length) {
      setError(bad.length === 1 ? 'One field needs your attention. It is marked in red.' : `${bad.length} fields need your attention. They are marked in red.`)
      bad[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); bad[0].focus({ preventScroll: true })
      return
    }
    const why = blocked()
    if (why) return setError(why)
    if (step < last) return go(step + 1)
    start(async () => {
      // The occupation is history (a new row each time), so it is sent only when it was entered or changed here.
      const occChanged = f.occTypeId && (f.occTypeId !== (source?.occupationTypeId ?? '') || f.qualification !== (source?.qualification ?? '') || f.college !== (source?.schoolOrCollege ?? ''))
      const res = await registerStudentAction({
        enquiryId: enq?.id ?? null,
        person: enq ? undefined : { firstName: f.firstName, lastName: f.lastName || null, phone: f.phone },
        profile: {
          fatherName: f.fatherName || null, motherName: f.motherName || null, guardianPhone: f.guardianPhone || null, dob: f.dob || null,
          gender: (f.gender || null) as 'male' | 'female' | 'other' | null, altPhone: f.altPhone || null, email: f.email || null, address: f.address || null,
          aadhaarNo: f.aadhaar || null,
        },
        occupation: occChanged ? { typeId: f.occTypeId, qualification: f.qualification || null, schoolOrCollege: f.college || null } : undefined,
        departmentId: f.deptId || null, courseId: custom.on ? null : f.courseId || null, classModeId: f.classModeId || null,
        customCourse: custom.on ? { title: custom.title, durationWeeks: custom.weeks ? Number(custom.weeks) : null, feeMode: custom.feeMode, modules: custom.modules.filter((m) => m.name.trim()).map((m) => ({ name: m.name, fee: byModule ? rupees(m.fee) : null })) } : null,
        enrollmentDate: f.enrollmentDate || today(), joiningDate: f.joiningDate || null,
        classMinutesPerDay: Number(f.dailyMin), classDaysPerWeek: Number(f.daysPerWeek), classStartTime: f.classStart || null, courseHours: totalHours || null, expectedEndDate: endDate || null,
        totalFee: payPaise, feePlan: planPayload(plan, payPaise), listFee: totalPaise, courseFee: payBase, gstAmount: payGst,
        kind, previousRegistrationId: kind === 'upgrade' ? prev?.id ?? null : null,
        projectCertificate: projectCert,
        internshipOffer: letters.offer, internshipCompletion: letters.completion,
        offerTemplateId: letters.offer && letters.offerTpl ? letters.offerTpl : null, completionTemplateId: letters.completion && letters.completionTpl ? letters.completionTpl : null,
        letterCompanyId: (letters.offer || letters.completion) && letters.company ? letters.company : null,
      })
      if (!res.ok || !res.data) return setError(res.ok ? 'Could not register' : res.error)
      let note = ''
      if (photo) {
        // The photo is saved as the registration's "Photo" document.
        const fd = new FormData()
        fd.set('registrationId', res.data.id); fd.set('kind', 'photo'); fd.set('file', new File([photo], `photo-${res.data.regNo}.jpg`, { type: photo.type || 'image/jpeg' }))
        const up = await fetch('/api/documents', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Upload failed' }))
        if (!up.ok) note = `The photo was not saved (${up.error}). The office can add it from Documents.`
      }
      if (idCard) {
        const fd = new FormData()
        fd.set('registrationId', res.data.id); fd.set('kind', 'id_proof'); fd.set('file', idCard)
        const up = await fetch('/api/documents', { method: 'POST', body: fd }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Upload failed' }))
        if (!up.ok) note = `${note} The Aadhaar card file was not saved (${up.error}). The office can add it from Documents.`.trim()
      }
      setDone({ id: res.data.id, regNo: res.data.regNo, name: [f.firstName, f.lastName].filter(Boolean).join(' '), note })
      window.scrollTo({ top: 0 })
    })
  }

  const reset = () => { setDone(null); setEnq(null); setCall(null); setPrev(null); setOwnSlot(false); setFilter('all'); setF(blank()); setPhoto(null); setIdCard(null); setPlan(newPlanState(today())); setCustom(NO_CUSTOM); setKind('new'); setError(''); setStep(0); setReached(0); router.refresh() /* the next registration no. */ }
  const bar = (
    <header className="kiosk-bar">
      <BrandMark brand={brand} height={40} />
      <div><strong>Student registration</strong><span>{branchName ?? 'Admission form'}</span></div>
      <Link className="button secondary" href="/registrations" prefetch={false}><ArrowLeft size={16} /> Back to panel</Link>
    </header>
  )

  if (done) {
    return (
      <main className="kiosk reg-new">
        {bar}
        <div className="kiosk-body">
          <div className="panel kiosk-done">
            <CheckCircle2 size={56} />
            <h1>Registration complete</h1>
            <p>{done.name ? `${done.name} is registered.` : 'The student is registered.'} Registration no. <strong>{done.regNo}</strong></p>
            {done.note && <p className="section-hint" style={{ margin: 0 }}>{done.note}</p>}
            <p className="section-hint" style={{ margin: 0 }}>Please hand the device back to the office.</p>
            <div className="kiosk-done-actions">
              <a className="button primary" href={`/registrations/${done.id}/id-card`} target="_blank" rel="noreferrer"><IdCardIcon size={16} /> Print ID card</a>
              <button type="button" className="button secondary" onClick={reset}>Register another student</button>
              <Link className="button secondary" href="/registrations" prefetch={false}>Back to panel</Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  const name = [f.firstName, f.lastName].filter(Boolean).join(' ')
  const lookup = (list: { id: string; value: string }[], id: string) => list.find((x) => x.id === id)?.value ?? '—'
  const head = (
    <div className="panel-header"><div><h2><i className="kiosk-step">{step + 1}</i> {STEPS[step].title}</h2><span>{[
      'Set the official details, find the student (their details are fetched and filled in), then the course, the class timing and the fee.',
      source ? 'These details are already on record. Check them and fill in what is missing.' : 'Fill in your details as on your ID proof.',
      'The numbers we can reach you and your parents on.',
      'Look straight at the camera. The photo is checked so that it is clear enough for the ID card.',
      'Check the details below. Go back to a step to change anything.',
    ][step]}</span></div></div>
  )

  return (
    <main className="kiosk reg-new">
      {bar}
      <form onSubmit={submit} noValidate className="kiosk-body reg-wizard" onInput={(e) => (e.target as HTMLElement).closest('[data-error]')?.removeAttribute('data-error')} onChange={(e) => (e.target as HTMLElement).closest('[data-error]')?.removeAttribute('data-error')}>
        <ol className="reg-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className={i === step ? 'current' : i <= reached ? 'done' : ''}>
              <button type="button" disabled={i > reached || i === step} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
                <i>{i !== step && i <= reached ? <Check size={14} /> : i + 1}</i>
                <span><strong>{s.title}</strong><small>{s.hint}</small></span>
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="panel">
            {head}
            <h3 className="reg-sub first">Official details</h3>
            <div className="form-grid">
              <label>Registration no.<input className="reg-fixed" value={regNo ?? '—'} readOnly tabIndex={-1} aria-describedby="regno-note" /><small id="regno-note" className="reg-note">Given automatically. It cannot be changed.</small></label>
              <label>Branch<input className="reg-fixed" value={branchName ?? '—'} readOnly tabIndex={-1} /></label>
              <label>Registration date<span className="required-mark">*</span><DateInput name="enrollmentDate" type="date" required value={f.enrollmentDate} onChange={(e) => set({ enrollmentDate: e.target.value, ...(f.joiningDate < e.target.value ? { joiningDate: e.target.value } : {}) })} /></label>
              <label>Joining date<span className="required-mark">*</span><DateInput name="joiningDate" type="date" required min={f.enrollmentDate} value={f.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
                <small className="reg-note">{f.joiningDate && f.joiningDate > f.enrollmentDate ? `Classes start ${Math.round((Date.parse(f.joiningDate) - Date.parse(f.enrollmentDate)) / 86400000)} day(s) after the registration.` : 'The day classes start. It can be later than the registration date.'}</small>
              </label>
              <label>Registration type<span className="required-mark">*</span>
                <select value={kind} onChange={(e) => changeKind(e.target.value as 'new' | 'upgrade')}><option value="new">New registration</option><option value="upgrade">Upgrade (already our student)</option></select>
              </label>
            </div>

            <h3 className="reg-sub">{kind === 'upgrade' ? 'Upgrading from' : 'Find the student'}</h3>
            {!source && kind === 'new' && (
              <>
                <div className="reg-seg reg-filter" role="radiogroup" aria-label="Search in">
                  {FILTERS.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={filter === v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>)}
                </div>
                <EnquirySearch<EnquiryHit & { kind: string }> searchKey={filter} disabled={pending} onPick={pick} none={filter === 'call' ? 'No random call found' : filter === 'lead' ? 'No lead found' : filter === 'visited' ? 'No visited enquiry found' : 'No random call, lead or enquiry found'}
                  search={async (q) => (await findRegistrationSourcesAction(q, filter)).map((h) => ({ ...h, tag: TAG[h.kind] }))} />
                <p className="section-hint" style={{ margin: '10px 0 0' }}>{pending ? 'Fetching the student\'s details…' : 'Search all enquiries, or only random calls, leads or visited enquiries, and pick the student: their details are filled in. Not found? Leave this empty: it is then a direct registration and the details are typed in the next steps.'}</p>
              </>
            )}
            {!source && kind === 'upgrade' && (
              <>
                <EnquirySearch<EnquiryHit & { kind: string }> searchKey="upgrade" disabled={pending} onPick={pick} placeholder="Type the student's name, phone or registration no." label="Search the student's registration" none="No registration found"
                  search={async (q) => (await findRegistrationsToUpgradeAction(q)).map((h) => ({ ...h, tag: TAG[h.kind] }))} />
                <p className="section-hint" style={{ margin: '10px 0 0' }}>{pending ? 'Fetching the registration…' : 'Find the student\'s earlier registration. Its details are shown and the student\'s details are filled in; then choose the upgraded course below.'}</p>
              </>
            )}
            {enq && (
              <div className="reg-enq" style={{ marginTop: 0 }}>
                <div className="reg-enq-head"><strong>{enq.enquiryNo}</strong><span className="status-badge status-blue">{enq.visited ? 'Visited enquiry' : 'Lead (not visited yet)'}</span><span className="status-badge status-slate">{STATUS[enq.status] ?? enq.status}</span>
                  <button type="button" className="link-button" onClick={clearSource}>Remove</button></div>
                <dl className="detail-list">
                  <div><dt>Name</dt><dd>{[enq.firstName, enq.lastName].filter(Boolean).join(' ')}</dd></div>
                  <div><dt>Contact no.</dt><dd>{enq.phone}</dd></div>
                  <div><dt>Came from</dt><dd>{enq.source ?? '—'}</dd></div>
                  <div><dt>Department</dt><dd>{enq.department ?? '—'}</dd></div>
                  <div><dt>Course</dt><dd>{enq.course ?? '—'}</dd></div>
                  <div><dt>Mode of classes</dt><dd>{enq.classMode ?? '—'}</dd></div>
                  <div><dt>Actual fee</dt><dd>{inr(enq.courseFee)}</dd></div>
                  <div><dt>Discounted / proposed fee</dt><dd>{inr(enq.proposedFee)}</dd></div>
                  <div><dt>Lead category</dt><dd>{enq.category ?? '—'}</dd></div>
                  <div><dt>Enquiry date</dt><dd>{fmtDay(enq.createdAt)}</dd></div>
                  <div><dt>Visited on</dt><dd>{enq.visited ? fmtDay(enq.visitedAt) : 'Not visited yet'}</dd></div>
                  <div><dt>Handled by</dt><dd>{enq.assignedTo ?? '—'}</dd></div>
                </dl>
                {enq.callRemark && <div className="detail-note"><span>Last call remark</span>{enq.callRemark}</div>}
              </div>
            )}
            {call && (
              <div className="reg-enq" style={{ marginTop: 0 }}>
                <div className="reg-enq-head"><strong>{[call.firstName, call.lastName].filter(Boolean).join(' ')}</strong><span className="status-badge status-blue">Random call</span>{call.status && <span className="status-badge status-slate">{call.status}</span>}
                  <button type="button" className="link-button" onClick={clearSource}>Remove</button></div>
                <dl className="detail-list">
                  <div><dt>Contact no.</dt><dd>{call.phone}</dd></div>
                  <div><dt>Called on</dt><dd>{fmtDay(call.calledAt)}</dd></div>
                  <div><dt>Call taken by</dt><dd>{call.receivedBy ?? '—'}</dd></div>
                  <div><dt>Department</dt><dd>{call.department ?? '—'}</dd></div>
                  <div><dt>Course</dt><dd>{call.course ?? '—'}</dd></div>
                  <div><dt>Proposed fee</dt><dd>{inr(call.proposedFee)}</dd></div>
                </dl>
                {call.callRemark && <div className="detail-note"><span>Call remark</span>{call.callRemark}</div>}
              </div>
            )}
            {prev && (
              <div className="reg-enq" style={{ marginTop: 0 }}>
                <div className="reg-enq-head"><strong>{prev.regNo}</strong><span className="status-badge status-blue">{prev.kind === 'upgrade' ? 'Upgrade' : 'Registration'}</span><span className="status-badge status-slate">{REG_STATUS[prev.status] ?? prev.status}</span>
                  <button type="button" className="link-button" onClick={clearSource}>Remove</button></div>
                <dl className="detail-list">
                  <div><dt>Name</dt><dd>{[prev.firstName, prev.lastName].filter(Boolean).join(' ')}</dd></div>
                  <div><dt>Contact no.</dt><dd>{prev.phone}</dd></div>
                  <div><dt>Father&apos;s name</dt><dd>{prev.fatherName ?? '—'}</dd></div>
                  <div><dt>Department</dt><dd>{prev.department ?? '—'}</dd></div>
                  <div><dt>Course</dt><dd>{prev.course ?? '—'}</dd></div>
                  <div><dt>Mode of classes</dt><dd>{prev.classMode ?? '—'}</dd></div>
                  <div><dt>Registered on</dt><dd>{fmtDay(prev.enrollmentDate)}</dd></div>
                  <div><dt>Joined on</dt><dd>{fmtDay(prev.joiningDate)}</dd></div>
                  <div><dt>Expected to finish</dt><dd>{fmtDay(prev.expectedEndDate)}</dd></div>
                  <div><dt>Total fees</dt><dd>{inr(prev.totalFee)}</dd></div>
                  <div><dt>Paid</dt><dd>{prev.paid ? inr(prev.paid) : '₹0'}</dd></div>
                  <div><dt>Balance</dt><dd className={prev.balance > 0 ? 'due' : ''}>{prev.balance > 0 ? inr(prev.balance) : 'Nothing due'}</dd></div>
                </dl>
                {prev.balance > 0 && <div className="detail-note"><span>Note</span>The earlier registration still has {inr(prev.balance)} to pay. It stays on that registration; the upgrade gets its own fee.</div>}
              </div>
            )}

            <h3 className="reg-sub">{kind === 'upgrade' ? 'Upgraded course and fees' : 'Course and fees'}</h3>
            <div className="form-grid">
              <label>Department<span className="required-mark">*</span>
                <select name="deptId" value={f.deptId} required onChange={(e) => set({ deptId: e.target.value, courseId: '' })}><option value="" disabled>Select department</option>{catalogs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
              </label>
              <label>Course<span className="required-mark">*</span>
                {/* Choosing a course brings its fee and its duration with it. */}
                {custom.on
                  ? <input name="customTitle" required minLength={2} maxLength={120} value={custom.title} placeholder="Name of the customized course" autoComplete="off" onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} />
                  : <select name="courseId" value={f.courseId} required onChange={(e) => { const c = courses.find((x) => x.id === e.target.value); set({ courseId: e.target.value, ...(c?.baseFee ? { courseFee: String(c.baseFee / 100), offerFee: '' } : {}) }) }}><option value="" disabled>{courses.length ? 'Select course' : 'No courses defined yet'}</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>}
                <button type="button" className="link-button reg-custom-toggle" onClick={() => { setCustom((c) => ({ ...c, on: !c.on })); set({ courseId: '', offerFee: '', ...(custom.on ? {} : { courseFee: '' }) }) }}>
                  {custom.on ? <><X size={14} /> Choose from the course list instead</> : <><ListPlus size={14} /> Course not in the list? Make a customized course</>}
                </button>
              </label>
              <label>Mode of classes<span className="required-mark">*</span><select name="classModeId" value={f.classModeId} required onChange={(e) => set({ classModeId: e.target.value })}><option value="" disabled>Select mode</option>{catalogs.classModes.map((m) => <option key={m.id} value={m.id}>{m.value}</option>)}</select></label>
              <div className="reg-field">
                <span className="reg-field-label">Project certificate included</span>
                <div className="reg-seg" role="radiogroup" aria-label="Project certificate included">
                  <button type="button" role="radio" aria-checked={!projectCert} className={!projectCert ? 'on' : ''} onClick={() => setProjectCert(false)}>No</button>
                  <button type="button" role="radio" aria-checked={projectCert} className={projectCert ? 'on' : ''} onClick={() => setProjectCert(true)}>Yes</button>
                </div>
                <small className="reg-note">Yes: the student also gets a project certificate with the course certificate.</small>
              </div>
              {(letters.offer || letters.completion) && (
                <label>Company the letters come from<select value={letters.company || letterCompaniesOf(templates)[0]?.id || ''} onChange={(e) => setLetters((l) => ({ ...l, company: e.target.value, offerTpl: '', completionTpl: '' }))}>{letterCompaniesOf(templates).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><small className="reg-note">Its templates, letterhead and stamp make the letters.</small></label>
              )}
              {([['offer', 'offerTpl', 'Internship selection letter', 'internship_offer'], ['completion', 'completionTpl', 'Internship completion letter', 'internship_completion']] as const).map(([on, tpl, label, kind]) => (
                <div key={on} className="reg-field">
                  <span className="reg-field-label">{label}</span>
                  <div className="reg-seg" role="radiogroup" aria-label={label}>
                    <button type="button" role="radio" aria-checked={!letters[on]} className={!letters[on] ? 'on' : ''} onClick={() => setLetters((l) => ({ ...l, [on]: false }))}>No</button>
                    <button type="button" role="radio" aria-checked={letters[on]} className={letters[on] ? 'on' : ''} onClick={() => setLetters((l) => ({ ...l, [on]: true }))}>Yes</button>
                  </div>
                  {letters[on] && <select className="reg-tpl" value={letters[tpl]} onChange={(e) => setLetters((l) => ({ ...l, [tpl]: e.target.value }))} aria-label={`${label} template`}>
                    {companyTemplateOptions(templates, kind, letters.company).map((o) => <option key={o.value || 'std'} value={o.value}>{o.label}</option>)}
                  </select>}
                  <small className="reg-note">{letters[on] ? 'The letter is set up in Internship Requests, where the role, stipend and hours are added. Can be changed later.' : 'Yes if this student needs it.'}</small>
                </div>
              ))}
              {custom.on
                ? <label>Course duration (weeks)<input name="customWeeks" inputMode="numeric" value={custom.weeks} placeholder="e.g. 12" autoComplete="off" onChange={(e) => setCustom((c) => ({ ...c, weeks: digits(e.target.value).slice(0, 3) }))} /><small className="reg-note">{custom.weeks ? duration(Number(custom.weeks)) : 'How long the customized course runs.'}</small></label>
                : <label>Course duration<input className="reg-fixed" value={courseTime} readOnly tabIndex={-1} /><small className="reg-note">Comes from the course.</small></label>}
              {custom.on && (
                <div className="reg-modules">
                  <div className="reg-modules-head">
                    <strong>Modules of the customized course<span className="required-mark">*</span></strong>
                    <div className="reg-seg" role="radiogroup" aria-label="How the fee is set">
                      <button type="button" role="radio" aria-checked={custom.feeMode === 'modules'} className={custom.feeMode === 'modules' ? 'on' : ''} onClick={() => { setCustom((c) => ({ ...c, feeMode: 'modules' })); set({ offerFee: '' }) }}>Fee for each module</button>
                      <button type="button" role="radio" aria-checked={custom.feeMode === 'total'} className={custom.feeMode === 'total' ? 'on' : ''} onClick={() => { setCustom((c) => ({ ...c, feeMode: 'total' })); set({ offerFee: '' }) }}>One fee for the whole course</button>
                    </div>
                  </div>
                  <p className="reg-note" style={{ margin: '0 0 12px' }}>{byModule ? 'Type each module and its fee: the course fee is added up for you.' : 'List the modules, then type one course fee for all of them below.'}</p>
                  {custom.modules.map((m, i) => (
                    <div className="reg-module" key={i}>
                      <i>{i + 1}</i>
                      <input aria-label={`Module ${i + 1} name`} required maxLength={120} value={m.name} placeholder="Module name, e.g. Advanced Excel" autoComplete="off" onChange={(e) => setModule(i, { name: e.target.value })} />
                      {byModule && <input aria-label={`Module ${i + 1} fee`} className="reg-module-fee" inputMode="numeric" required value={m.fee} placeholder="Fee (₹)" autoComplete="off" onChange={(e) => { setModule(i, { fee: digits(e.target.value).slice(0, 8) }); set({ offerFee: '' }) }} />}
                      <button type="button" className="filter-button icon-only danger" title="Remove module" aria-label={`Remove module ${i + 1}`} disabled={custom.modules.length === 1} onClick={() => { setCustom((c) => ({ ...c, modules: c.modules.filter((_, k) => k !== i) })); set({ offerFee: '' }) }}><Trash2 size={15} /></button>
                    </div>
                  ))}
                  <div className="reg-modules-foot">
                    <button type="button" className="button secondary" disabled={custom.modules.length >= 40} onClick={() => setCustom((c) => ({ ...c, modules: [...c.modules, { name: '', fee: '' }] }))}><Plus size={15} /> Add module</button>
                    {byModule && <span>{custom.modules.length} module{custom.modules.length === 1 ? '' : 's'} · course fee <strong>{feePaise ? inr(feePaise) : '—'}</strong></span>}
                  </div>
                </div>
              )}
            </div>
            <h3 className="reg-sub">Class timing</h3>
            <div className="form-grid">
              <label>Class time each day<span className="required-mark">*</span><select name="dailyMin" value={f.dailyMin} required onChange={(e) => set({ dailyMin: e.target.value })}>{DAILY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label>Class days a week<span className="required-mark">*</span><select name="daysPerWeek" value={f.daysPerWeek} required onChange={(e) => set({ daysPerWeek: e.target.value })}>{['7', '6', '5', '4', '3', '2', '1'].map((d) => <option key={d} value={d}>{d} day{d === '1' ? '' : 's'}</option>)}</select></label>
              <label>Class time (slot)<select name="classSlot" value={ownSlot ? 'custom' : f.classStart} onChange={(e) => { const own = e.target.value === 'custom'; setOwnSlot(own); set({ classStart: own ? '' : e.target.value }) }}>
                <option value="">Not fixed yet</option>
                {SLOT_STARTS.map((t) => <option key={t} value={t}>{clock(t)} to {clock(t, Number(f.dailyMin))}</option>)}
                <option value="custom">Custom time…</option>
              </select><small className="reg-note">{ownSlot ? 'Set the start time in the next box.' : classTime ? `The student comes ${classTime}, ${f.daysPerWeek} days a week.` : `Slots of ${DAILY.find(([v]) => v === f.dailyMin)?.[1]}: choose the one the student wants.`}</small></label>
              {ownSlot && <label>Custom start time<span className="required-mark">*</span><input name="classStart" type="time" required value={f.classStart} onChange={(e) => set({ classStart: e.target.value })} />
                <small className="reg-note">{classTime ? `The student comes ${classTime}, ${f.daysPerWeek} days a week.` : `The class runs ${DAILY.find(([v]) => v === f.dailyMin)?.[1]} from this time.`}</small></label>}
            </div>
            <dl className="reg-total">
              <div><dt>Course hours</dt><dd>{totalHours ? `${totalHours} hours` : custom.on ? 'Enter the duration' : course ? 'No duration on this course' : '—'}</dd></div>
              <div><dt>Classes needed</dt><dd>{classDays ? `${classDays} class${classDays === 1 ? '' : 'es'} · ${span(runDays)}` : '—'}</dd></div>
              <div className="sum"><dt>Expected to finish</dt><dd>{endDate ? fmtDay(endDate) : '—'}</dd></div>
            </dl>

            <h3 className="reg-sub">Fees</h3>
            <div className="form-grid">
              {byModule
                ? <label>Course fee (₹)<input className="reg-fixed" value={feePaise ? (feePaise / 100).toLocaleString('en-IN') : '—'} readOnly tabIndex={-1} /><small className="reg-note">Added up from the module fees, before GST.</small></label>
                : <label>Course fee (₹)<span className="required-mark">*</span><input name="courseFee" inputMode="numeric" required value={f.courseFee} autoComplete="off" onChange={(e) => set({ courseFee: digits(e.target.value).slice(0, 8) })} />
                  <small className="reg-note">{custom.on ? 'One fee for all the modules, before GST' : course?.baseFee ? `Course's fee: ${inr(course.baseFee)}` : 'Before GST'}{enq && (enq.courseFee || enq.proposedFee) ? ` · Enquiry: actual ${inr(enq.courseFee)}, proposed ${inr(enq.proposedFee)}` : ''}</small>
                </label>}
              <label>GST<span className="required-mark">*</span><select name="gstPct" value={f.gstPct} required onChange={(e) => set({ gstPct: e.target.value })}>{GST_RATES.map((r) => <option key={r} value={r}>{r === '0' ? 'No GST (0%)' : `${r}%`}</option>)}</select></label>
            </div>
            <dl className="reg-total">
              <div><dt>Course fee</dt><dd>{feePaise ? inr(feePaise) : '—'}</dd></div>
              <div><dt>GST ({f.gstPct}%)</dt><dd>{feePaise ? money(totalPaise - feePaise) : '—'}</dd></div>
              <div><dt>Total fees</dt><dd>{feePaise ? inr(totalPaise) : '—'}</dd></div>
            </dl>
            <div className="form-grid" style={{ marginTop: 18 }}>
              <label>Offer fee (₹)<input name="offerFee" inputMode="numeric" autoComplete="off" aria-invalid={offerTooHigh} className={offerTooHigh ? 'reg-bad' : undefined} value={f.offerFee} placeholder={totalPaise ? String(totalPaise / 100) : 'Same as the total fees'} onChange={(e) => set({ offerFee: digits(e.target.value).slice(0, 8) })} />
                {offerTooHigh
                  ? <small className="reg-note bad" role="alert">This is more than the total fees ({inr(totalPaise)}). The offer fee can be the total or less; clear it when there is no discount.</small>
                  : <small className="reg-note">The fee offered to this student, GST included. Leave empty when there is no discount: it is then the same as the total fees.</small>}
              </label>
            </div>
            <dl className={`reg-total${offerTooHigh ? ' bad' : ''}`}>
              <div><dt>Total fees</dt><dd>{feePaise ? inr(totalPaise) : '—'}</dd></div>
              <div><dt>Discount{discountPaise > 0 && totalPaise ? ` (${Math.round(discountPaise * 1000 / totalPaise) / 10}%)` : ''}</dt><dd className={discountPaise > 0 ? 'off' : ''}>{!feePaise || offerTooHigh ? '—' : discountPaise > 0 ? `− ${inr(discountPaise)}` : 'No discount'}</dd></div>
              <div className="sum"><dt>Fees to pay</dt><dd>{offerTooHigh ? 'Fix the offer fee' : feePaise && payPaise > 0 ? inr(payPaise) : '—'}</dd></div>
            </dl>

            <h3 className="reg-sub">Payment plan</h3>
            <p className="section-hint" style={{ margin: '-6px 0 14px' }}>How the fees to pay are collected: all at once, or in installments. Accounts can change the plan later on the Fees page.</p>
            <FeePlanEditor total={offerTooHigh ? 0 : payPaise} value={plan} onChange={setPlan} limits={limits} />
          </div>
        )}

        {step === 1 && (
          <div className="panel">
            {head}
            <div className="form-grid">
              <label>First name<span className="required-mark">*</span><input name="firstName" required value={f.firstName} disabled={locked} autoComplete="off" onChange={(e) => set({ firstName: e.target.value })} /></label>
              <label>Last name<input name="lastName" value={f.lastName} disabled={locked} autoComplete="off" onChange={(e) => set({ lastName: e.target.value })} /></label>
              <label>Father&apos;s name<span className="required-mark">*</span><input name="fatherName" required value={f.fatherName} autoComplete="off" onChange={(e) => set({ fatherName: e.target.value })} /></label>
              <label>Mother&apos;s name<input name="motherName" value={f.motherName} autoComplete="off" onChange={(e) => set({ motherName: e.target.value })} /></label>
              <label>Date of birth<span className="required-mark">*</span><DateInput name="dob" type="date" required value={f.dob} max={today()} onChange={(e) => set({ dob: e.target.value })} /></label>
              <label>Gender<span className="required-mark">*</span><select name="gender" value={f.gender} required onChange={(e) => set({ gender: e.target.value })}><option value="" disabled>Select</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
              <label>Email ID<span className="required-mark">*</span><input name="email" type="email" required value={f.email} autoComplete="off" onChange={(e) => set({ email: e.target.value })} /></label>
              <label>Aadhaar no.<input name="aadhaar" inputMode="numeric" value={f.aadhaar} placeholder="12 digits (not needed if the card picture is attached)" autoComplete="off" maxLength={14} onChange={(e) => set({ aadhaar: formatAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12)) })} /></label>
              <label>Aadhaar card (picture or PDF)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setIdCard(e.target.files?.[0] ?? null)} /><small className="reg-note">{idCard ? `Chosen: ${idCard.name}` : 'Optional. Up to 5 MB; kept with the registration as ID proof.'}</small></label>
              <label>Currently<span className="required-mark">*</span><select name="occTypeId" value={f.occTypeId} required onChange={(e) => set({ occTypeId: e.target.value })}><option value="" disabled>Select</option>{catalogs.occupationTypes.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}</select></label>
              <label>Qualification<span className="required-mark">*</span><input name="qualification" required value={f.qualification} placeholder="e.g. 12th pass, pursuing B.Com" autoComplete="off" onChange={(e) => set({ qualification: e.target.value })} /></label>
              <label>Workplace / college<span className="required-mark">*</span><input name="college" required value={f.college} autoComplete="off" onChange={(e) => set({ college: e.target.value })} /></label>
            </div>
            <label className="full-label">Address<span className="required-mark">*</span><textarea name="address" required value={f.address} onChange={(e) => set({ address: e.target.value })} placeholder="House no., street, area, city, PIN code" /></label>
          </div>
        )}

        {step === 2 && (
          <div className="panel">
            {head}
            <div className="form-grid">
              <label>Mobile no.<span className="required-mark">*</span><input name="phone" type="tel" inputMode="numeric" required pattern={MOBILE} title="10-digit mobile number" value={f.phone} disabled={locked} placeholder="10-digit mobile" autoComplete="off" onChange={(e) => set({ phone: e.target.value })} /></label>
              <label>WhatsApp / alternate no.<input name="altPhone" type="tel" inputMode="numeric" pattern={MOBILE} title="10-digit mobile number" value={f.altPhone} placeholder="If different from the mobile no." autoComplete="off" onChange={(e) => set({ altPhone: e.target.value })} /></label>
              <label>Parent / guardian no.<span className="required-mark">*</span><input name="guardianPhone" type="tel" inputMode="numeric" required pattern={MOBILE} title="10-digit mobile number" value={f.guardianPhone} placeholder="10-digit mobile" autoComplete="off" onChange={(e) => set({ guardianPhone: e.target.value })} /></label>
              {/* the same student already known here or in another branch: their details can be copied in */}
              {!locked && <BranchMatches phone={f.phone} email={f.email} dob={f.dob} firstName={f.firstName} onUse={(m) => set({
                firstName: f.firstName || m.firstName, lastName: f.lastName || m.lastName || '', altPhone: f.altPhone || m.altPhone || '', email: f.email || m.email || '', dob: f.dob || m.dob || '',
                gender: f.gender || m.gender || '', address: f.address || m.address || '', fatherName: f.fatherName || m.fatherName || '', motherName: f.motherName || m.motherName || '',
              })} />}
            </div>
          </div>
        )}

        {step === 3 && <div className="panel">{head}<PhotoCapture photo={photo} url={photoUrl} setPhoto={setPhoto} /></div>}

        {step === last && (
          <div className="panel">
            {head}
            <div className="reg-review">
              <div className="reg-review-photo">{photoUrl ? <img src={photoUrl} alt="Student" /> : <div className="reg-photo-empty"><UserRound size={44} /><span>No photo</span></div>}</div>
              <div>
                <Review title="Office details" onEdit={() => go(0)} rows={[
                  ['Registration no.', regNo ?? '—'], ['Branch', branchName ?? '—'], ['Registration date', fmtDay(f.enrollmentDate)], ['Joining date', fmtDay(f.joiningDate || null)],
                  ['Student from', enq ? `${enq.visited ? 'Visited enquiry' : 'Lead'} ${enq.enquiryNo}` : call ? 'Random call' : prev ? `Registration ${prev.regNo}` : 'Direct registration'],
                  ['Type', kind === 'upgrade' ? `Upgrade${prev ? ` from ${prev.regNo}` : ''}` : 'New registration'],
                  ['Department', catalogs.departments.find((d) => d.id === f.deptId)?.name ?? '—'], ['Course', courseName],
                  ...(custom.on ? [['Modules', custom.modules.filter((m) => m.name.trim()).map((m) => (byModule ? `${m.name} (${inr(rupees(m.fee))})` : m.name)).join(', ') || '—'] as [string, string]] : []),
                  ['Course duration', courseTime], ['Mode of classes', lookup(catalogs.classModes, f.classModeId)], ['Project certificate', projectCert ? 'Included' : 'Not included'], ['Internship letters', [letters.offer && `Selection (${templates.find((t) => t.kind === 'internship_offer' && (t.id ?? '') === letters.offerTpl)?.name ?? 'Standard'})`, letters.completion && `Completion (${templates.find((t) => t.kind === 'internship_completion' && (t.id ?? '') === letters.completionTpl)?.name ?? 'Standard'})`].filter(Boolean).join(', ').replace(/^(?=.)/, `${letterCompaniesOf(templates).find((c) => c.id === letters.company)?.name ?? letterCompaniesOf(templates)[0]?.name ?? ''}: `) || 'None'],
                  ['Class time', `${DAILY.find(([v]) => v === f.dailyMin)?.[1] ?? '—'} a day, ${f.daysPerWeek} days a week${classTime ? ` (${classTime})` : ''}`],
                  ['Course hours', totalHours ? `${totalHours} hours` : '—'], ['Expected to finish', endDate ? `${fmtDay(endDate)} (${span(runDays)})` : '—'],
                  ['Course fee', inr(feePaise)], [`GST (${f.gstPct}%)`, money(totalPaise - feePaise)], ['Total fees', inr(totalPaise)],
                  ['Discount', discountPaise > 0 ? `${inr(discountPaise)} (${Math.round(discountPaise * 1000 / totalPaise) / 10}%)` : 'No discount'], ['Fees to pay', inr(payPaise)],
                  ['Payment plan', `${planLabel(planPayload(plan, payPaise))}${planLines(plan, payPaise)[0] ? `, first ${inr(planLines(plan, payPaise)[0].amount)} on ${fmtDay(planLines(plan, payPaise)[0].dueDate)}` : ''}`],
                ]} />
                <Review title="Student profile" onEdit={() => go(1)} rows={[
                  ['Name', name || '—'], ['Father\'s name', f.fatherName || '—'], ['Mother\'s name', f.motherName || '—'], ['Date of birth', fmtDay(f.dob || null)],
                  ['Gender', f.gender ? f.gender[0].toUpperCase() + f.gender.slice(1) : '—'], ['Email ID', f.email || '—'], ['Aadhaar no.', f.aadhaar || '—'], ['Aadhaar card', idCard ? idCard.name : 'Not attached'], ['Currently', lookup(catalogs.occupationTypes, f.occTypeId)],
                  ['Qualification', f.qualification || '—'], ['Workplace / college', f.college || '—'], ['Address', f.address || '—'],
                ]} />
                <Review title="Contact details" onEdit={() => go(2)} rows={[['Mobile no.', f.phone || '—'], ['WhatsApp / alternate no.', f.altPhone || '—'], ['Parent / guardian no.', f.guardianPhone || '—']]} />
              </div>
            </div>
            {!photo && <p className="section-hint" style={{ margin: '14px 0 0' }}>No photo taken. You can still register; the office can add it later from Documents.</p>}
          </div>
        )}

        <div className="kiosk-submit reg-nav">
          {error && <p className="reg-error" role="alert">{error}</p>}
          {step > 0 && <button type="button" className="button secondary" onClick={() => go(step - 1)} disabled={pending}><ArrowLeft size={16} /> Back</button>}
          <button className="button primary" disabled={pending}>{step === last ? (pending ? 'Saving…' : 'Register student') : step === 3 && !photo ? <>Skip photo <ArrowRight size={16} /></> : <>Next: {STEPS[step + 1].title} <ArrowRight size={16} /></>}</button>
        </div>
      </form>
    </main>
  )
}

function Review({ title, rows, onEdit }: { title: string; rows: [string, string][]; onEdit: () => void }) {
  return (
    <section className="reg-review-block">
      <div className="reg-review-head"><h3>{title}</h3><button type="button" className="link-button" onClick={onEdit}>Change</button></div>
      <dl className="detail-list">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  )
}
