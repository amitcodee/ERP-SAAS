'use client'
// Interview prep in the student portal: the free tools on InterviewPrep (interview-prep.app) — GitHub project
// analysis with tailored interview questions, ATS resume checker, AI resume builder — a step-by-step checklist suited
// to the student's course (ticks kept in this browser), and a way to ask a trainer for a mock interview.
import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, FileCode2, FileSearch, FileText, HandHelping, Lightbulb, Sparkles } from 'lucide-react'

const SITE = 'https://interview-prep.app'
const TOOLS = [
  { icon: FileCode2, title: 'GitHub project analysis', text: 'Paste the link of a project you built. It reads your code and asks you the interview questions an interviewer would ask about it.', href: `${SITE}/analyze`, cta: 'Analyse my project' },
  { icon: FileSearch, title: 'ATS resume checker', text: 'Most companies filter resumes by software first. Upload yours to see its score and what to fix before you apply.', href: `${SITE}/resume/checker`, cta: 'Check my resume' },
  { icon: FileText, title: 'AI resume builder', text: 'No resume yet? Build a clean, one-page resume step by step, with your course, skills and projects.', href: `${SITE}/resume/builder`, cta: 'Build my resume' },
] as const

type Track = 'code' | 'design' | 'office' | 'general'
/** What the course is about decides the checklist: coding, design / CAD, office & accounts, or general. */
function trackOf(course: string): Track {
  const c = course.toLowerCase()
  if (/(web|stack|python|java|php|react|node|android|app|data|software|program|coding|developer|\.net|c\+\+|ai|machine)/.test(c)) return 'code'
  if (/(design|graphic|autocad|cad|revit|3d|solid|catia|interior|video|animation|ui|ux|photo)/.test(c)) return 'design'
  if (/(tally|account|excel|office|gst|computer basic|dca|adca|typing|marketing|seo)/.test(c)) return 'office'
  return 'general'
}
const STEPS: Record<Track, string[]> = {
  code: [
    'Put your 2–3 best course projects on GitHub, each with a short README',
    'Run each project through the GitHub analysis and practise its questions out loud',
    'Revise the basics of your course language (data types, loops, functions, OOP)',
    'Make a one-page resume and get an ATS score of 70+',
    'Ask a trainer for a mock interview on your project',
  ],
  design: [
    'Collect your best 6–10 works from the course into one portfolio (PDF or Behance)',
    'For each work, be ready to explain the brief, the tools you used and why',
    'Revise shortcuts and commands of your software — interviews often include a quick test',
    'Make a one-page resume with a link to your portfolio and get an ATS score of 70+',
    'Ask a trainer for a mock interview and a portfolio review',
  ],
  office: [
    'Practise a short test: an Excel sheet with formulas / a Tally voucher entry, timed',
    'Revise GST basics and the reports you made in the course',
    'Make a one-page resume listing the software you know and get an ATS score of 70+',
    'Prepare answers to: tell me about yourself, why this job, your strengths',
    'Ask a trainer for a mock interview',
  ],
  general: [
    'List what you can do now that you could not before the course',
    'Make a one-page resume and get an ATS score of 70+',
    'Prepare answers to: tell me about yourself, why this job, your strengths',
    'Practise speaking for 1 minute on your best project or work',
    'Ask a trainer for a mock interview',
  ],
}
const TIPS = ['Reach 10 minutes early and keep two printed copies of your resume', 'Be honest — “I have not used it yet, but I learnt X which is close” beats guessing', 'Ask one question at the end, e.g. what a normal day in the role looks like', 'Send a short thank-you message the same day']

export function InterviewPrep({ course, regId, onAskTrainer }: { course: string; regId: string; onAskTrainer: () => void }) {
  const track = trackOf(course)
  const steps = STEPS[track]
  const key = `tc-prep-${regId}`
  const [done, setDone] = useState<number[]>([])
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { setDone([]) } }, [key])
  const toggle = (i: number) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i]
    setDone(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* the ticks just will not be remembered */ }
  }
  const pct = Math.round((done.length / steps.length) * 100)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="pt-card" style={{ background: 'linear-gradient(135deg, #10186a, #4a4af4 70%, #8b5cf6)', color: '#fff', border: 0 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,.16)', display: 'grid', placeItems: 'center' }}><Sparkles size={22} /></span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 19, color: '#fff' }}>Get interview-ready</h2>
            <p style={{ margin: '4px 0 0', opacity: .9, fontSize: 14 }}>Free AI tools to practise questions about your own projects and to make your resume pass company filters — and a checklist for {course}.</p>
          </div>
          <a href={SITE} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '10px 16px', borderRadius: 999, background: '#fff', color: '#10186a', fontWeight: 700, textDecoration: 'none', fontSize: 14 }}>Open InterviewPrep <ArrowUpRight size={15} /></a>
        </div>
      </section>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}>
        {TOOLS.map((t) => (
          <section key={t.title} className="pt-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0 }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--tint, #eef0ff)', color: '#4a4af4', display: 'grid', placeItems: 'center' }}><t.icon size={19} /></span>
            <h3 style={{ margin: '4px 0 0', fontSize: 15.5 }}>{t.title}</h3>
            <p style={{ margin: 0, color: 'var(--muted, #6b7394)', fontSize: 13.5, lineHeight: 1.5, flex: 1 }}>{t.text}</p>
            <a href={t.href} target="_blank" rel="noopener noreferrer" className="pt-link" style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontWeight: 700 }}>{t.cta} <ArrowUpRight size={14} /></a>
          </section>
        ))}
      </div>

      <section className="pt-card" style={{ margin: 0 }}>
        <div className="pt-card-head"><h2><span className="pt-ic"><Check size={16} /></span>Your prep checklist</h2><span style={{ fontWeight: 700, color: pct === 100 ? '#059669' : 'var(--muted, #6b7394)' }}>{done.length}/{steps.length}</span></div>
        <div style={{ height: 6, borderRadius: 6, background: 'var(--tint, #eef0ff)', margin: '0 0 12px' }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: pct === 100 ? '#10b981' : '#4a4af4', transition: 'width .3s' }} /></div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {steps.map((s, i) => (
            <li key={i}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 14, lineHeight: 1.45 }}>
                <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} style={{ width: 18, height: 18, marginTop: 1, accentColor: '#10b981', flex: 'none' }} />
                <span style={{ textDecoration: done.includes(i) ? 'line-through' : 'none', color: done.includes(i) ? 'var(--muted, #6b7394)' : 'inherit' }}>{s}</span>
              </label>
            </li>
          ))}
        </ul>
        {pct === 100 && <p style={{ margin: '12px 0 0', color: '#059669', fontWeight: 700 }}>🎉 All done — you are ready. All the best!</p>}
      </section>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <section className="pt-card" style={{ margin: 0 }}>
          <div className="pt-card-head"><h2><span className="pt-ic"><HandHelping size={16} /></span>Mock interview with a trainer</h2></div>
          <p style={{ margin: '0 0 12px', color: 'var(--muted, #6b7394)', fontSize: 14 }}>Ask for a practice interview or a resume / portfolio review. Trainers of every branch see it, and you pick who helps.</p>
          <button type="button" className="pt-btn" onClick={onAskTrainer}>Ask a trainer</button>
        </section>
        <section className="pt-card" style={{ margin: 0 }}>
          <div className="pt-card-head"><h2><span className="pt-ic"><Lightbulb size={16} /></span>On the day</h2></div>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--faint, #9aa1bd)', textAlign: 'center' }}>InterviewPrep is an outside website: it opens in a new tab and has its own sign-up and terms.</p>
    </div>
  )
}
