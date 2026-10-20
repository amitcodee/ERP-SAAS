'use client'
// New / Edit event: 1. what and when, 2. what to ask people, 3. the quiz (or none), 4. the certificate (design, and
// whether everyone gets one or only those who pass). Saved events get a sign-up link and QR code at once.
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Plus, Save, Trash2 } from 'lucide-react'
import { saveEventAction } from '@/app/event-actions'
import { DesignSvg } from '@/components/cert-design-svg'
import { useNotify } from '@/components/panel-shell'
import { SAMPLE_VALUES, type Design } from '@/lib/cert-design'
import type { EventKind, QuizQuestion } from '@/lib/db/schema'
import type { EventFull, EventInput } from '@/modules/events/service'

const KINDS: [EventKind, string][] = [['seminar', 'Seminar'], ['workshop', 'Workshop'], ['webinar', 'Webinar'], ['bootcamp', 'Bootcamp'], ['competition', 'Competition'], ['other', 'Other']]
/** An ISO time as the value of a datetime-local input, in India time. */
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16) : '')
/** A datetime-local value (India time) as ISO. */
const toIso = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : '')
const blankQ = (): QuizQuestion => ({ q: '', options: ['', '', '', ''], answer: 0 })

type DesignOpt = { id: string; name: string; branch: string | null; design: Design }

export function EventForm({ event, designs, canDesign }: { event: EventFull | null; designs: DesignOpt[]; canDesign: boolean }) {
  const router = useRouter()
  const notify = useNotify()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const locked = !!event && event.joined > 0 // the quiz stays as it was once people have answered
  const [f, setF] = useState(() => ({
    kind: event?.kind ?? 'seminar' as EventKind, title: event?.title ?? '', description: event?.description ?? '',
    startsAt: local(event?.startsAt ?? null), endsAt: local(event?.endsAt ?? null), mode: event?.mode ?? 'offline' as 'offline' | 'online' | 'hybrid',
    venue: event?.venue ?? '', speaker: event?.speaker ?? '', askMobile: event?.askMobile ?? true, askOrg: event?.askOrg ?? true,
    hasQuiz: event?.hasQuiz ?? false, quiz: event?.quiz?.length ? event.quiz : [blankQ()], passPercent: event?.passPercent ?? 60, quizMinutes: event?.quizMinutes ?? null as number | null,
    certificate: event?.certificate ?? true, certFor: event?.certFor ?? 'passed' as 'all' | 'passed', designId: event?.designId ?? designs[0]?.id ?? '', closesAt: local(event?.closesAt ?? null),
  }))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const setQ = (i: number, q: Partial<QuizQuestion>) => set('quiz', f.quiz.map((x, j) => (j === i ? { ...x, ...q } : x)))
  const design = designs.find((d) => d.id === f.designId)

  const save = () => start(async () => {
    const input: EventInput = {
      ...f, startsAt: toIso(f.startsAt), endsAt: toIso(f.endsAt) || null, closesAt: toIso(f.closesAt) || null,
      quiz: f.hasQuiz ? f.quiz.map((q) => ({ ...q, options: q.options.map((o) => o.trim()).filter(Boolean) })) : [],
      quizMinutes: f.hasQuiz ? f.quizMinutes : null, designId: f.certificate ? f.designId || null : null,
    }
    // options left empty are dropped; the right answer follows its option
    if (f.hasQuiz) input.quiz = f.quiz.map((q) => { const keep = q.options.map((o, i) => [o.trim(), i] as const).filter(([o]) => o); return { q: q.q, options: keep.map(([o]) => o), answer: Math.max(0, keep.findIndex(([, i]) => i === q.answer)) } })
    const r = await saveEventAction(event?.id ?? null, input)
    if (!r.ok) return setError(r.error)
    notify(event ? 'Event saved' : 'Event created: share its link or QR code')
    router.push(`/events/${r.data}`)
    router.refresh()
  })

  return (
    <section className="page-container">
      <style>{CSS}</style>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Events / Seminars &amp; Workshops / {event ? 'Edit' : 'New'}</p>
          <h1>{event ? `Edit: ${event.title}` : 'New seminar, workshop or event'}</h1>
          <p className="subheading">Fill in the event, choose whether people take a quiz, and pick the certificate design. Once saved it gets a sign-up link and a QR code: people fill in their details there{f.hasQuiz ? ', take the quiz' : ''} and get their certificate by e-mail.</p>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>1. The event</h2><span>What people see on the sign-up page, and what the certificate prints.</span></div></div>
        <div className="seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {KINDS.map(([k, l]) => <button key={k} type="button" className={f.kind === k ? 'on' : ''} aria-pressed={f.kind === k} onClick={() => set('kind', k)}>{l}</button>)}
        </div>
        <div className="wl-form">
          <label className="wide">Title<span className="required-mark">*</span><input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={160} placeholder="e.g. Hands-on Workshop on Generative AI" /></label>
          <label>Starts<span className="required-mark">*</span><input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></label>
          <label>Ends<input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></label>
          <label>Where<select value={f.mode} onChange={(e) => set('mode', e.target.value as typeof f.mode)}><option value="offline">At the branch / a venue</option><option value="online">Online (live)</option><option value="hybrid">Both</option></select></label>
          <label>{f.mode === 'online' ? 'Meeting link or platform' : 'Venue'}<input value={f.venue} onChange={(e) => set('venue', e.target.value)} maxLength={300} placeholder={f.mode === 'online' ? 'e.g. Google Meet' : 'e.g. techcadd Jalandhar, Hall 2'} /></label>
          <label>Speaker / trainer<input value={f.speaker} onChange={(e) => set('speaker', e.target.value)} maxLength={160} placeholder="Printed on the certificate" /></label>
          <label>Sign-ups close<input type="datetime-local" value={f.closesAt} onChange={(e) => set('closesAt', e.target.value)} /><small className="section-hint">Leave empty to close by hand</small></label>
          <label className="wide">About the event<textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={3000} placeholder="Shown on the sign-up page" /></label>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>2. What people fill in</h2><span>Name and e-mail are always asked (the certificate goes to the e-mail).</span></div></div>
        <div className="set-checks">
          <label className={`set-check${f.askMobile ? ' on' : ''}`}><input type="checkbox" checked={f.askMobile} onChange={() => set('askMobile', !f.askMobile)} /><span><b>Mobile number</b><small>Required when ticked</small></span></label>
          <label className={`set-check${f.askOrg ? ' on' : ''}`}><input type="checkbox" checked={f.askOrg} onChange={() => set('askOrg', !f.askOrg)} /><span><b>College / company</b><small>Optional for them; can print on the certificate</small></span></label>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>3. Quiz</h2><span>{locked ? `${event!.joined} people have already taken part: the quiz can no longer change.` : 'People answer it right after filling in their details; it is marked at once.'}</span></div></div>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button type="button" className={!f.hasQuiz ? 'on' : ''} aria-pressed={!f.hasQuiz} disabled={locked} onClick={() => set('hasQuiz', false)}>No quiz</button>
          <button type="button" className={f.hasQuiz ? 'on' : ''} aria-pressed={f.hasQuiz} disabled={locked} onClick={() => set('hasQuiz', true)}>With a quiz</button>
        </div>
        {f.hasQuiz && <>
          <div className="wl-form" style={{ marginBottom: 12 }}>
            <label>Pass mark (%)<input type="number" min={0} max={100} value={f.passPercent} disabled={locked} onChange={(e) => set('passPercent', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /></label>
            <label>Time limit (minutes)<input type="number" min={1} max={300} value={f.quizMinutes ?? ''} disabled={locked} placeholder="No limit" onChange={(e) => set('quizMinutes', e.target.value ? Math.max(1, Math.min(300, Number(e.target.value))) : null)} /></label>
          </div>
          <ol className="ev-quiz">
            {f.quiz.map((q, i) => (
              <li key={i}>
                <div className="ev-q-head">
                  <b>Q{i + 1}</b>
                  <input value={q.q} disabled={locked} onChange={(e) => setQ(i, { q: e.target.value })} placeholder="The question" maxLength={500} aria-label={`Question ${i + 1}`} />
                  {!locked && f.quiz.length > 1 && <button type="button" className="ev-icon" aria-label={`Remove question ${i + 1}`} onClick={() => set('quiz', f.quiz.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
                </div>
                <div className="ev-opts">
                  {q.options.map((o, k) => (
                    <div key={k} className={`ev-opt${q.answer === k ? ' right' : ''}`}>
                      <button type="button" className="ev-icon" disabled={locked} title="Mark as the right answer" aria-label={`Option ${k + 1} is the right answer`} aria-pressed={q.answer === k} onClick={() => setQ(i, { answer: k })}>{q.answer === k ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button>
                      <input value={o} disabled={locked} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={`Option ${k + 1}`} maxLength={200} aria-label={`Question ${i + 1} option ${k + 1}`} />
                      {!locked && q.options.length > 2 && <button type="button" className="ev-icon" aria-label={`Remove option ${k + 1}`} onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k), answer: q.answer === k ? 0 : q.answer > k ? q.answer - 1 : q.answer })}><Trash2 size={13} /></button>}
                    </div>
                  ))}
                  {!locked && q.options.length < 6 && <button type="button" className="button secondary ev-small" onClick={() => setQ(i, { options: [...q.options, ''] })}><Plus size={13} /> Option</button>}
                </div>
              </li>
            ))}
          </ol>
          {!locked && <button type="button" className="button secondary" onClick={() => set('quiz', [...f.quiz, blankQ()])} disabled={f.quiz.length >= 100}><Plus size={14} /> Add a question</button>}
          <p className="section-hint" style={{ marginTop: 8 }}>Tick the circle beside the right option. {f.quiz.length} question{f.quiz.length === 1 ? '' : 's'}; passing needs {Math.ceil((f.quiz.length * f.passPercent) / 100)} right.</p>
        </>}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header"><div><h2>4. Certificate</h2><span>E-mailed to each person as soon as they finish, with a link to view and download it.</span></div></div>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button type="button" className={f.certificate ? 'on' : ''} aria-pressed={f.certificate} onClick={() => set('certificate', true)}>Give certificates</button>
          <button type="button" className={!f.certificate ? 'on' : ''} aria-pressed={!f.certificate} onClick={() => set('certificate', false)}>No certificate</button>
        </div>
        {f.certificate && <>
          {f.hasQuiz && <div className="set-checks" style={{ marginBottom: 12 }}>
            <label className={`set-check${f.certFor === 'passed' ? ' on' : ''}`}><input type="radio" name="certFor" checked={f.certFor === 'passed'} onChange={() => set('certFor', 'passed')} /><span><b>Only those who pass</b><small>{f.passPercent}% or more</small></span></label>
            <label className={`set-check${f.certFor === 'all' ? ' on' : ''}`}><input type="radio" name="certFor" checked={f.certFor === 'all'} onChange={() => set('certFor', 'all')} /><span><b>Everyone who takes part</b><small>The score can print on it</small></span></label>
          </div>}
          {designs.length ? (
            <div className="ev-designs">
              {designs.map((d) => (
                <button key={d.id} type="button" className={`ev-design${f.designId === d.id ? ' on' : ''}`} aria-pressed={f.designId === d.id} onClick={() => set('designId', d.id)}>
                  <DesignSvg design={d.design} values={{ ...SAMPLE_VALUES, event: f.title || SAMPLE_VALUES.event, speaker: f.speaker || SAMPLE_VALUES.speaker, kind: KINDS.find(([k]) => k === f.kind)![1] }} style={{ width: '100%', display: 'block' }} />
                  <span>{d.name}<small>{d.branch ?? 'Head office'}</small></span>
                </button>
              ))}
            </div>
          ) : <p className="fee-note">No certificate designs yet. {canDesign ? <Link href="/certificate-designs">Make one in Certificate Designs</Link> : 'Ask your branch manager to make one in Certificate Designs.'} (it takes a minute from a template).</p>}
          {design && canDesign && <p className="section-hint" style={{ marginTop: 8 }}>To change how it looks, edit “{design.name}” in <Link href={`/certificate-designs/${design.id}`}>Certificate Designs</Link>.</p>}
        </>}
      </div>

      <div className="fee-action-row">
        <Link href={event ? `/events/${event.id}` : '/events'} className="button secondary">Cancel</Link>
        <button type="button" className="button primary" onClick={save} disabled={pending}><Save size={14} /> {pending ? 'Saving…' : event ? 'Save changes' : 'Create event'}</button>
      </div>
    </section>
  )
}

const CSS = `
.ev-quiz { margin: 0 0 12px; padding: 0; list-style: none; display: grid; gap: 12px; }
.ev-quiz > li { padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--tint-2); }
.ev-q-head { display: flex; align-items: center; gap: 8px; }
.ev-q-head b { color: var(--indigo-600, #4f46e5); font-size: 13px; }
.ev-q-head input, .ev-opt input { flex: 1; min-width: 0; height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; font: inherit; }
.ev-opts { display: grid; gap: 6px; margin: 8px 0 0 28px; }
.ev-opt { display: flex; align-items: center; gap: 6px; }
.ev-opt.right input { border-color: #22c55e; background: #f0fdf4; }
.ev-icon { width: 30px; height: 30px; display: inline-grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--muted); flex: none; }
.ev-opt.right .ev-icon:first-child { color: #16a34a; }
.ev-small { height: 30px !important; padding: 0 10px !important; font-size: 12px !important; justify-self: start; }
.ev-designs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.ev-design { display: grid; gap: 6px; padding: 8px; border: 2px solid var(--line); border-radius: 12px; background: #fff; text-align: left; cursor: pointer; }
.ev-design.on { border-color: #4f46e5; box-shadow: 0 0 0 3px #e0e7ff; }
.ev-design svg { border-radius: 6px; box-shadow: 0 1px 4px #0002; max-height: 170px; }
.ev-design span { font-size: 12.5px; font-weight: 700; color: var(--ink); display: grid; }
.ev-design small { font-weight: 500; color: var(--muted); }
`
