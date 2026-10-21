import { BrandMark } from '@/components/brand-mark'
import { orgBrand } from '@/lib/brand'
import { requestOrg, requireRequestOrg } from '@/lib/tenant/request'
import Link from 'next/link'
import { FEATURES, JOURNEY, SECURITY } from '@/components/site/content'
import { LANDING_CSS } from '@/components/site/landing-css'
import {
  ArrowRight, BadgeCheck, BellRing, Building2, Check, GraduationCap, KeyRound, LogIn, Sparkles, Users,
} from 'lucide-react'

// The public home page: what a visitor who is not signed in sees at the panel's address (and /support). Who it is for,
// the journey from the first call to the certificate, what it does, how it keeps data safe, certificate checks, step-by-
// step help and answers. Server-rendered, no script; the "screens" are illustrations, not live data.
export async function generateMetadata() {
  const org = await requestOrg()
  return { title: `${org?.name ?? 'Institute'} | sign in, help & certificate check` }
}

const AUDIENCES = [
  { icon: Users, tag: 'Staff', title: 'Run your branch', href: '/login', cta: 'Staff sign in',
    items: ['Calls, leads and enquiries with follow-ups', 'Admissions, fee plans and receipts', 'Batches, attendance, tests and certificates'] },
  { icon: GraduationCap, tag: 'Students', title: 'Your course, in your pocket', href: '/login', cta: 'Student sign in',
    items: ['Fees paid and due, with every receipt', 'Classes, attendance, notes and tests', 'Your certificate, the day it is issued'] },
  { icon: BadgeCheck, tag: 'Employers & colleges', title: 'Check a certificate', href: '/verify', cta: 'Verify a certificate',
    items: ['Scan the QR code on the certificate', 'Or type its number or the registration no.', 'See instantly whether it is genuine'] },
]




const GUIDES = [
  { title: 'Take a new enquiry', menu: 'Visited Enquiry', steps: ['Open Visited Enquiry from the menu', 'Add the person, the course they want and a follow-up date', 'Record each follow-up in Enquiry Update'] },
  { title: 'Register a student', menu: 'Registration', steps: ['Open Registration and pick the enquiry (or enter the details)', 'Set the course, total fee and payment plan', 'Save: the registration number and ID card are ready'] },
  { title: 'Collect a fee', menu: 'Fees', steps: ['Open Fees and find the student', 'Record payment: amount, mode and proof', 'Print or share the receipt that is created'] },
  { title: 'Mark today’s class', menu: 'My Classes', steps: ['Open My Classes and choose the batch', 'Tick the topics taught and who was present', 'Save the class'] },
  { title: 'Issue a certificate', menu: 'Certificate Requests', steps: ['Request it once the course is complete', 'Accounts confirms the fees are cleared', 'Issue it: it is e-mailed with its verification link'] },
  { title: 'Run a seminar or workshop', menu: 'Seminars & Workshops', steps: ['Create the event, add a quiz if you want one', 'Pick the certificate design', 'Share the link or print the QR poster'] },
]

const FAQ = [
  { q: 'I forgot my password. What do I do?', a: 'On the sign-in page press "Forgot Password?", enter your e-mail and open the link that is sent to you. The link works for 30 minutes and only once. If no e-mail arrives, ask your branch office to reset it.' },
  { q: 'It says "Too many attempts".', a: 'After a few wrong passwords, sign-in pauses for a short while (from 30 seconds, longer if the wrong tries go on). Wait and try again, or use "Forgot Password?". Your branch manager can also clear the lock.' },
  { q: 'Why was I asked to change my password?', a: 'A password given to you by someone else is temporary. This happens the first time you sign in and after the office resets your password.' },
  { q: 'I was signed out on my own.', a: 'A sign-in lasts 12 hours. You are also signed out everywhere when your password is changed or reset, or if your account is switched off.' },
  { q: 'I cannot see a section or a record.', a: 'Each account only shows what it is allowed to use, and staff see their own branch. If something you need is missing, ask your branch manager.' },
  { q: 'I am a student. Where are my receipts and certificate?', a: 'Sign in with the e-mail on your registration. Your portal shows your fees and receipts, classes, notes and tests, and your certificate once it is issued.' },
  { q: 'How do I check that a certificate is real?', a: 'Scan the QR code printed on it, or open Verify a certificate and type the certificate or registration number. No account is needed.' },
  { q: 'How do I change my password later?', a: 'Sign in, open your profile (top right) → My account → Change password. Staff get a code by e-mail to confirm it.' },
]

export default async function SupportPage() {
  const org = await requireRequestOrg()
  const brand = await orgBrand(org.id)
  const year = new Date().getFullYear()
  return (
    <div className="lp">
      <style>{LANDING_CSS}</style>

      {/* ---- top bar ---- */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-logo"><BrandMark brand={brand} height={40} /></Link>
          <nav aria-label="Sections">
            <a href="#who">Who it’s for</a>
            <a href="#features">Features</a>
            <a href="#help">Help</a>
            <Link href="/verify">Verify certificate</Link>
          </nav>
          <Link href="/login" className="lp-btn lp-btn-dark">Sign In <ArrowRight size={15} /></Link>
        </div>
      </header>

      {/* ---- hero ---- */}
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <span className="lp-pill"><Sparkles size={14} /> The workspace of every {brand.name} branch</span>
            <h1>From the first call to the <span>certificate in hand.</span></h1>
            <p>Leads, admissions, fees, classes and certificates for every {brand.name} branch — one sign-in, each person seeing just their part.</p>
            <div className="lp-hero-cta">
              <Link href="/login" className="lp-btn lp-btn-lime">Sign In <ArrowRight size={16} /></Link>
              <Link href="/verify" className="lp-btn lp-btn-ghost"><BadgeCheck size={16} /> Verify a certificate</Link>
            </div>
            <ul className="lp-hero-ticks">
              <li><Check size={15} /> For staff, trainers and students</li>
              <li><Check size={15} /> Works on phone and computer</li>
              <li><Check size={15} /> Certificates anyone can check</li>
            </ul>
          </div>

          {/* an illustration of the panel, not live data */}
          <div className="lp-shot" aria-hidden="true">
            <div className="lp-shot-bar"><i /><i /><i /><span>Dashboard</span></div>
            <div className="lp-shot-body">
              <div className="lp-shot-greet"><b>Good morning 👋</b><em>This month</em></div>
              <div className="lp-shot-kpis">
                <div><small>Enquiries</small><b /><span className="up">▲</span></div>
                <div><small>Admissions</small><b /><span className="up">▲</span></div>
                <div><small>Collected</small><b /><span className="up">▲</span></div>
              </div>
              <div className="lp-shot-chart">{[34, 52, 41, 66, 58, 82, 70, 90].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
              <div className="lp-shot-rows">
                {['Follow-up due', 'Fee reminder sent', 'Certificate issued'].map((t, i) => <div key={t}><span className={`d d${i}`} /><em>{t}</em><b /></div>)}
              </div>
            </div>
            <div className="lp-shot-float"><BadgeCheck size={18} /><div><b>Certificate verified</b><small>Genuine · {brand.name}</small></div></div>
          </div>
        </div>
      </section>

      {/* ---- who it is for ---- */}
      <section className="lp-sec" id="who">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">Who it’s for</span><h2>One place, three ways in</h2></div>
          <div className="lp-aud">
            {AUDIENCES.map((a) => (
              <Link key={a.tag} href={a.href} className="lp-aud-card">
                <span className="lp-ico"><a.icon size={22} /></span>
                <span className="lp-tag">{a.tag}</span>
                <h3>{a.title}</h3>
                <ul>{a.items.map((x) => <li key={x}><Check size={15} />{x}</li>)}</ul>
                <span className="lp-more">{a.cta} <ArrowRight size={15} /></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---- the journey ---- */}
      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">The journey</span><h2>Every student, start to finish</h2><p>Each step hands over to the next, so nothing is typed twice and nobody is forgotten.</p></div>
          <ol className="lp-journey">
            {JOURNEY.map((j, i) => (
              <li key={j.title}>
                <span className="lp-jn">{i + 1}</span>
                <span className="lp-ico lp-ico-sm"><j.icon size={18} /></span>
                <b>{j.title}</b>
                <small>{j.text}</small>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- features ---- */}
      <section className="lp-sec" id="features">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">Features</span><h2>Built for how an institute really works</h2><p>What you see depends on your account; these are the main parts.</p></div>
          <div className="lp-bento">
            {FEATURES.map((f) => (
              <div key={f.title} className={`lp-feat${f.big ? ' big' : ''}`}>
                <span className="lp-ico lp-ico-sm"><f.icon size={18} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- security ---- */}
      <section className="lp-dark">
        <div className="lp-wrap">
          <div className="lp-head lp-head-light"><span className="lp-eyebrow">Safe by design</span><h2>Students’ records stay private</h2></div>
          <div className="lp-sec4">
            {SECURITY.map((s) => (
              <div key={s.title}><span className="lp-ico lp-ico-glass"><s.icon size={20} /></span><h3>{s.title}</h3><p>{s.text}</p></div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- verify ---- */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-verify">
            <div className="lp-verify-text">
              <span className="lp-eyebrow">For employers & colleges</span>
              <h2>Is this {brand.name} certificate genuine?</h2>
              <p>Scan the QR code printed on it, or type the certificate number or the student’s registration number. You see the student, the course and whether it stands — in seconds, with no account.</p>
              <Link href="/verify" className="lp-btn lp-btn-dark">Verify a certificate <ArrowRight size={15} /></Link>
            </div>
            <div className="lp-verify-card" aria-hidden="true">
              <div className="ok"><BadgeCheck size={20} /> Genuine certificate</div>
              <div className="who"><span>AG</span><div><b>Student name</b><small>Registration no. TCD/4002/1234</small></div></div>
              <div className="rows"><div><small>Course</small><b>Full Stack Development</b></div><div><small>Issued</small><b>by {brand.name}</b></div></div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- help: getting started, how-to, questions ---- */}
      <section className="lp-sec lp-soft" id="help">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">Help</span><h2>Getting started and common questions</h2></div>
          <div className="lp-start">
            {[[LogIn, 'Sign in', 'Use the e-mail and password your branch office gave you.'], [KeyRound, 'Set your password', 'The first one is temporary: choose your own (10+ characters, a letter and a number).'], [Building2, 'Start working', 'The menu on the left shows the sections your account can use.']].map(([I, t, x], i) => {
              const Icon = I as typeof LogIn
              return <div key={t as string}><span className="lp-jn">{i + 1}</span><Icon size={18} /><b>{t as string}</b><small>{x as string}</small></div>
            })}
          </div>
          <div className="lp-help">
            <div>
              <h3 className="lp-sub">How to…</h3>
              <div className="lp-acc">
                {GUIDES.map((g) => (
                  <details key={g.title}>
                    <summary><span>{g.title}</span><em>{g.menu}</em></summary>
                    <ol>{g.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  </details>
                ))}
              </div>
            </div>
            <div>
              <h3 className="lp-sub">Questions</h3>
              <div className="lp-acc">
                {FAQ.map((f) => (
                  <details key={f.q}>
                    <summary><span>{f.q}</span></summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- closing call ---- */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-cta">
            <div><h2>Ready to start?</h2><p>Sign in with your {brand.name} account. Stuck? Your branch office can reset your password and set up what you see.</p></div>
            <div className="lp-cta-btns">
              <Link href="/login" className="lp-btn lp-btn-lime">Sign In <ArrowRight size={16} /></Link>
              <Link href="/login/forgot" className="lp-btn lp-btn-ghost"><BellRing size={16} /> Forgot password</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-foot-brand">
            <BrandMark brand={brand} height={40} />
            <p>{brand.tagline ? `${brand.tagline}. ` : ''}Admissions, fees, classes and certificates for every {brand.name} branch.</p>
          </div>
          <div><h4>Sign in</h4><Link href="/login">Staff &amp; students</Link><Link href="/login/forgot">Forgot password</Link></div>
          <div><h4>Check</h4><Link href="/verify">Verify a certificate</Link><a href="#help">Help &amp; questions</a></div>
          <div><h4>Explore</h4><a href="#who">Who it’s for</a><a href="#features">Features</a></div>
        </div>
        <div className="lp-wrap lp-copy">© {year} {brand.legalName}. All rights reserved.</div>
      </footer>
    </div>
  )
}
