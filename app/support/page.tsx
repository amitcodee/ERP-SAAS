import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight, BadgeCheck, BellRing, Briefcase, Building2, CalendarCheck, ChartColumn, Check, ClipboardList, FileCheck2, Fingerprint, GraduationCap,
  KeyRound, LifeBuoy, Lock, LogIn, Megaphone, Mic, Palette, PhoneCall, QrCode, Receipt, ShieldCheck, Sparkles, UserPlus, Users, Wallet,
} from 'lucide-react'

// The public home page: what a visitor who is not signed in sees at the panel's address (and /support). Who it is for,
// the journey from the first call to the certificate, what it does, how it keeps data safe, certificate checks, step-by-
// step help and answers. Server-rendered, no script; the "screens" are illustrations, not live data.
export const metadata = { title: 'techcadd | Institute ERP — sign in, help & certificate check' }

const AUDIENCES = [
  { icon: Users, tag: 'Staff', title: 'Run your branch', href: '/login', cta: 'Staff sign in',
    items: ['Calls, leads and enquiries with follow-ups', 'Admissions, fee plans and receipts', 'Batches, attendance, tests and certificates'] },
  { icon: GraduationCap, tag: 'Students', title: 'Your course, in your pocket', href: '/login', cta: 'Student sign in',
    items: ['Fees paid and due, with every receipt', 'Classes, attendance, notes and tests', 'Your certificate, the day it is issued'] },
  { icon: BadgeCheck, tag: 'Employers & colleges', title: 'Check a certificate', href: '/verify', cta: 'Verify a certificate',
    items: ['Scan the QR code on the certificate', 'Or type its number or the registration no.', 'See instantly whether it is genuine'] },
]

const JOURNEY = [
  { icon: PhoneCall, title: 'Call or lead', text: 'Walk-in, phone or website form' },
  { icon: ClipboardList, title: 'Enquiry', text: 'Follow-ups until they decide' },
  { icon: UserPlus, title: 'Registration', text: 'Course, fee plan, ID card' },
  { icon: Wallet, title: 'Fees', text: 'Instalments and QR receipts' },
  { icon: CalendarCheck, title: 'Classes', text: 'Batches, attendance, tests' },
  { icon: FileCheck2, title: 'Certificate', text: 'Issued, e-mailed, verifiable' },
]

const FEATURES = [
  { icon: PhoneCall, title: 'Leads that do not slip', text: 'Every call, walk-in and website form lands in one list, is shared out to telecallers and comes back on its follow-up date. Overdue ones go up to the branch manager.', big: true },
  { icon: Wallet, title: 'Fees without surprises', text: 'Fee plans and instalments, approved discounts and changes, reminders before the due date, and a numbered receipt with a QR code for every payment.', big: true },
  { icon: CalendarCheck, title: 'Classes & attendance', text: 'Batches, trainers, daily attendance, syllabus progress, tests and notes.' },
  { icon: BadgeCheck, title: 'Certificates', text: 'Course and project certificates, from request to e-mailed PDF.' },
  { icon: Mic, title: 'Seminars & workshops', text: 'Sign-up link and QR, optional quiz, certificates by e-mail.' },
  { icon: Palette, title: 'Certificate designs', text: 'Design on a canvas from templates, pictures and the logo.' },
  { icon: Briefcase, title: 'Internship letters', text: 'Selection and completion letters on the right letterhead.' },
  { icon: Megaphone, title: 'Messages', text: 'Reminders, birthday wishes, announcements, bulk WhatsApp.' },
  { icon: LifeBuoy, title: 'Help desk', text: 'Students ask from their portal; staff answer and close.' },
  { icon: ChartColumn, title: 'Dashboard & reports', text: 'Any dates, any branch, every list exportable.' },
]

const SECURITY = [
  { icon: Lock, title: 'Each branch sees its own', text: 'The database itself keeps branches and students apart, not just the screens.' },
  { icon: Fingerprint, title: 'Strong sign-in', text: 'Encrypted passwords, lockout on guessing, optional e-mail code at sign-in.' },
  { icon: QrCode, title: 'Documents you can check', text: 'Receipts and certificates carry codes that cannot be guessed or forged.' },
  { icon: ShieldCheck, title: 'Every change recorded', text: 'Who did what and when is kept, and payments can never be edited.' },
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

export default function SupportPage() {
  const year = new Date().getFullYear()
  return (
    <div className="lp">
      <style>{CSS}</style>

      {/* ---- top bar ---- */}
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-logo"><Image src="/tce.webp" alt="techcadd — Your Skill & Technology Partner" width={940} height={270} priority /></Link>
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
            <span className="lp-pill"><Sparkles size={14} /> The workspace of every techcadd branch</span>
            <h1>From the first call to the <span>certificate in hand.</span></h1>
            <p>Leads, admissions, fees, classes and certificates for every techcadd branch — one sign-in, each person seeing just their part.</p>
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
            <div className="lp-shot-float"><BadgeCheck size={18} /><div><b>Certificate verified</b><small>Genuine · techcadd</small></div></div>
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
              <h2>Is this techcadd certificate genuine?</h2>
              <p>Scan the QR code printed on it, or type the certificate number or the student’s registration number. You see the student, the course and whether it stands — in seconds, with no account.</p>
              <Link href="/verify" className="lp-btn lp-btn-dark">Verify a certificate <ArrowRight size={15} /></Link>
            </div>
            <div className="lp-verify-card" aria-hidden="true">
              <div className="ok"><BadgeCheck size={20} /> Genuine certificate</div>
              <div className="who"><span>AG</span><div><b>Student name</b><small>Registration no. TCD/4002/1234</small></div></div>
              <div className="rows"><div><small>Course</small><b>Full Stack Development</b></div><div><small>Issued</small><b>by techcadd</b></div></div>
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
            <div><h2>Ready to start?</h2><p>Sign in with your techcadd account. Stuck? Your branch office can reset your password and set up what you see.</p></div>
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
            <Image src="/tce.webp" alt="techcadd" width={940} height={270} />
            <p>Your Skill &amp; Technology Partner. The institute ERP of every techcadd branch.</p>
          </div>
          <div><h4>Sign in</h4><Link href="/login">Staff &amp; students</Link><Link href="/login/forgot">Forgot password</Link></div>
          <div><h4>Check</h4><Link href="/verify">Verify a certificate</Link><a href="#help">Help &amp; questions</a></div>
          <div><h4>Explore</h4><a href="#who">Who it’s for</a><a href="#features">Features</a></div>
        </div>
        <div className="lp-wrap lp-copy">© {year} techcadd Computer Education. All rights reserved.</div>
      </footer>
    </div>
  )
}

const CSS = `
.lp { --navy: #10186a; --ink: #0f1437; --text: #4a5170; --muted: #7a82a3; --line: #e6e8f3; --indigo: #4a4af4; --lime: #c9f74a; --soft: #f5f6fc;
  background: #fff; color: var(--ink); font-size: 15px; line-height: 1.6; overflow-x: hidden; }
.lp * { box-sizing: border-box; }
.lp h1, .lp h2, .lp h3 { font-family: inherit; letter-spacing: -.02em; margin: 0; }
.lp-wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 32px); }
.lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 22px; border-radius: 12px; font-size: 14.5px; font-weight: 700; text-decoration: none; white-space: nowrap; transition: transform .15s, box-shadow .15s, background .15s; }
.lp-btn:hover { transform: translateY(-2px); }
.lp-btn-dark { background: var(--navy); color: #fff; box-shadow: 0 12px 26px -12px #10186aaa; }
.lp-btn-lime { background: var(--lime); color: var(--navy); box-shadow: 0 14px 30px -12px #c9f74a99; }
.lp-btn-ghost { border: 1.5px solid #ffffff4d; color: #fff; background: #ffffff12; }
.lp-eyebrow { display: inline-block; margin-bottom: 10px; color: var(--indigo); font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.lp-head { max-width: 680px; margin-bottom: 36px; }
.lp-head h2 { font-size: clamp(28px, 3.6vw, 40px); line-height: 1.12; font-weight: 800; }
.lp-head p { margin: 12px 0 0; color: var(--text); font-size: 16px; }
.lp-head-light h2 { color: #fff; }
.lp-head-light .lp-eyebrow { color: var(--lime); }
.lp-sec { padding: clamp(56px, 8vw, 96px) 0; }
.lp-soft { background: var(--soft); }
.lp-ico { width: 50px; height: 50px; display: grid; place-items: center; border-radius: 15px; background: linear-gradient(135deg, var(--navy), var(--indigo)); color: #fff; flex: none; }
.lp-ico-sm { width: 40px; height: 40px; border-radius: 12px; }
.lp-ico-glass { background: #ffffff1a; border: 1px solid #ffffff2e; }

/* top bar */
.lp-nav { position: sticky; top: 0; z-index: 20; background: #ffffffe6; backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.lp-nav-in { display: flex; align-items: center; gap: 24px; height: 68px; }
.lp-logo img { width: 128px; height: auto; display: block; }
.lp-nav nav { display: flex; gap: 26px; margin-left: auto; }
.lp-nav nav a { color: var(--text); font-size: 14px; font-weight: 600; text-decoration: none; }
.lp-nav nav a:hover { color: var(--navy); }
.lp-nav .lp-btn { height: 42px; }

/* hero */
.lp-hero { position: relative; padding: clamp(48px, 7vw, 88px) 0 clamp(64px, 9vw, 110px); color: #fff;
  background: radial-gradient(50% 70% at 85% 10%, #4a4af455 0%, transparent 70%), radial-gradient(40% 60% at 0% 100%, #5cc8ff33 0%, transparent 70%), linear-gradient(160deg, #0a0f4d 0%, #10186a 55%, #1b2490 100%); }
.lp-hero-in { display: grid; grid-template-columns: 1.05fr 1fr; gap: clamp(28px, 5vw, 64px); align-items: center; }
.lp-pill { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: #ffffff14; border: 1px solid #ffffff26; color: #dfe3ff; font-size: 13px; font-weight: 600; }
.lp-pill svg { color: var(--lime); }
.lp-hero h1 { margin: 20px 0 18px; font-size: clamp(36px, 5.4vw, 60px); line-height: 1.04; font-weight: 800; letter-spacing: -.035em; }
.lp-hero h1 span { color: var(--lime); }
.lp-hero-copy > p { margin: 0; max-width: 540px; color: #c9cdf2; font-size: 17px; }
.lp-hero-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.lp-hero-ticks { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 24px 0 0; padding: 0; list-style: none; color: #b8bdea; font-size: 13.5px; }
.lp-hero-ticks li { display: inline-flex; align-items: center; gap: 6px; }
.lp-hero-ticks svg { color: var(--lime); }
.lp-shot { position: relative; border-radius: 18px; background: #fff; color: var(--ink); box-shadow: 0 40px 90px -30px #000a, 0 0 0 1px #ffffff22; transform: perspective(1600px) rotateY(-8deg) rotateX(2deg); }
.lp-shot-bar { display: flex; align-items: center; gap: 6px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.lp-shot-bar i { width: 10px; height: 10px; border-radius: 50%; background: #e2e4ef; }
.lp-shot-bar span { margin-left: 10px; color: var(--muted); font-size: 12px; font-weight: 700; }
.lp-shot-body { padding: 16px; display: grid; gap: 12px; }
.lp-shot-greet { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-radius: 12px; background: linear-gradient(120deg, var(--navy), var(--indigo)); color: #fff; }
.lp-shot-greet b { font-size: 14px; } .lp-shot-greet em { font-style: normal; font-size: 11px; padding: 3px 9px; border-radius: 999px; background: #ffffff26; }
.lp-shot-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.lp-shot-kpis div { position: relative; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; }
.lp-shot-kpis small { display: block; color: var(--muted); font-size: 10.5px; font-weight: 700; }
.lp-shot-kpis b { display: block; width: 60%; height: 14px; margin-top: 6px; border-radius: 4px; background: #dfe2f5; }
.lp-shot-kpis .up { position: absolute; right: 10px; top: 10px; color: #16a34a; font-size: 10px; }
.lp-shot-chart { display: flex; align-items: flex-end; gap: 8px; height: 110px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; }
.lp-shot-chart i { flex: 1; border-radius: 6px 6px 3px 3px; background: linear-gradient(180deg, var(--indigo), #9fa5ff); }
.lp-shot-chart i:last-child { background: linear-gradient(180deg, var(--navy), var(--indigo)); }
.lp-shot-rows { display: grid; gap: 6px; }
.lp-shot-rows div { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 10px; background: var(--soft); font-size: 12px; }
.lp-shot-rows em { font-style: normal; color: var(--text); font-weight: 600; flex: 1; }
.lp-shot-rows b { width: 52px; height: 8px; border-radius: 4px; background: #dfe2f5; }
.lp-shot-rows .d { width: 9px; height: 9px; border-radius: 50%; } .d0 { background: #f59e0b; } .d1 { background: var(--indigo); } .d2 { background: #16a34a; }
.lp-shot-float { position: absolute; left: -26px; bottom: -22px; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 14px; background: #fff; box-shadow: 0 20px 40px -16px #0f143788; color: #047857; }
.lp-shot-float b { display: block; color: var(--ink); font-size: 13px; } .lp-shot-float small { color: var(--muted); font-size: 11.5px; }

/* who it is for */
.lp-aud { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.lp-aud-card { display: grid; align-content: start; gap: 10px; padding: 28px 26px; border: 1px solid var(--line); border-radius: 22px; background: #fff; color: inherit; text-decoration: none; transition: transform .15s, box-shadow .15s, border-color .15s; }
.lp-aud-card:hover { transform: translateY(-5px); border-color: #c9ccf5; box-shadow: 0 30px 60px -32px #10186a77; }
.lp-tag { margin-top: 6px; color: var(--indigo); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.lp-aud-card h3 { font-size: 21px; font-weight: 800; color: var(--navy); }
.lp-aud-card ul { margin: 6px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; color: var(--text); font-size: 14px; }
.lp-aud-card li { display: flex; gap: 8px; align-items: flex-start; } .lp-aud-card li svg { flex: none; margin-top: 3px; color: #16a34a; }
.lp-more { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--indigo); font-weight: 800; font-size: 14px; }

/* journey */
.lp-journey { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin: 0; padding: 0; list-style: none; }
.lp-journey::before { content: ''; position: absolute; left: 6%; right: 6%; top: 21px; height: 2px; background: linear-gradient(90deg, var(--indigo), var(--lime)); opacity: .5; }
.lp-journey li { position: relative; display: grid; justify-items: center; gap: 8px; text-align: center; }
.lp-jn { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; background: #fff; border: 2px solid var(--indigo); color: var(--navy); font-weight: 800; position: relative; z-index: 1; }
.lp-journey b { font-size: 15px; color: var(--navy); } .lp-journey small { color: var(--muted); font-size: 12.5px; line-height: 1.4; }

/* features */
.lp-bento { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.lp-feat { display: grid; align-content: start; gap: 10px; padding: 22px; border: 1px solid var(--line); border-radius: 18px; background: #fff; }
.lp-feat h3 { font-size: 16px; font-weight: 800; color: var(--navy); }
.lp-feat p { margin: 0; color: var(--text); font-size: 13.5px; }
.lp-feat.big { grid-column: span 2; padding: 28px; background: linear-gradient(135deg, #f3f4ff, #fff 70%); }
.lp-feat.big h3 { font-size: 21px; } .lp-feat.big p { font-size: 15px; max-width: 460px; }

/* security */
.lp-dark { padding: clamp(56px, 8vw, 92px) 0; color: #fff; background: radial-gradient(40% 80% at 100% 0%, #4a4af455, transparent 70%), linear-gradient(160deg, #0a0f4d, #10186a); }
.lp-sec4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.lp-sec4 > div { padding: 24px; border-radius: 18px; background: #ffffff0d; border: 1px solid #ffffff1f; }
.lp-sec4 h3 { margin-top: 14px; font-size: 17px; font-weight: 800; }
.lp-sec4 p { margin: 6px 0 0; color: #c2c7ee; font-size: 14px; }

/* verify */
.lp-verify { display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: center; padding: clamp(28px, 4vw, 48px); border-radius: 28px; background: linear-gradient(120deg, #eef0ff, #e8fbf3); border: 1px solid #dfe3fb; }
.lp-verify h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 800; line-height: 1.15; }
.lp-verify-text p { margin: 14px 0 22px; color: var(--text); font-size: 15.5px; }
.lp-verify-card { border-radius: 20px; background: #fff; box-shadow: 0 30px 60px -30px #10186a66; overflow: hidden; }
.lp-verify-card .ok { display: flex; align-items: center; gap: 8px; padding: 14px 18px; background: linear-gradient(135deg, #059669, #10b981); color: #fff; font-weight: 800; }
.lp-verify-card .who { display: flex; gap: 12px; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
.lp-verify-card .who span { width: 46px; height: 46px; display: grid; place-items: center; border-radius: 14px; background: linear-gradient(135deg, var(--navy), var(--indigo)); color: #fff; font-weight: 800; }
.lp-verify-card .who b { display: block; } .lp-verify-card small { color: var(--muted); font-size: 12px; }
.lp-verify-card .rows { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 16px 18px; }
.lp-verify-card .rows div { padding: 10px 12px; border-radius: 12px; background: var(--soft); } .lp-verify-card .rows b { display: block; font-size: 13.5px; }

/* help */
.lp-start { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 40px; }
.lp-start > div { display: grid; grid-template-columns: auto auto 1fr; grid-template-rows: auto auto; align-items: center; column-gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: 16px; background: #fff; }
.lp-start .lp-jn { grid-row: span 2; width: 38px; height: 38px; }
.lp-start svg { color: var(--indigo); } .lp-start b { color: var(--navy); }
.lp-start small { grid-column: 2 / 4; color: var(--text); font-size: 13px; }
.lp-help { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.lp-sub { margin-bottom: 14px !important; font-size: 18px; font-weight: 800; color: var(--navy); }
.lp-acc { display: grid; gap: 10px; }
.lp-acc details { border: 1px solid var(--line); border-radius: 14px; background: #fff; }
.lp-acc summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 18px; cursor: pointer; font-weight: 700; color: var(--ink); list-style: none; }
.lp-acc summary::-webkit-details-marker { display: none; }
.lp-acc summary::after { content: '+'; flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; background: var(--soft); color: var(--indigo); font-weight: 800; }
.lp-acc details[open] summary::after { content: '−'; }
.lp-acc summary em { margin-left: auto; font-style: normal; padding: 3px 9px; border-radius: 999px; background: #eef0ff; color: var(--indigo); font-size: 11px; font-weight: 800; white-space: nowrap; }
.lp-acc details p, .lp-acc details ol { margin: 0; padding: 0 18px 16px; color: var(--text); font-size: 14px; }
.lp-acc details ol { padding-left: 38px; display: grid; gap: 4px; }

/* closing call */
.lp-cta { display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: clamp(28px, 4vw, 48px); border-radius: 28px; color: #fff; background: radial-gradient(40% 90% at 100% 0%, #4a4af466, transparent 70%), linear-gradient(120deg, #0a0f4d, #10186a); }
.lp-cta h2 { font-size: clamp(26px, 3vw, 34px); font-weight: 800; } .lp-cta p { margin: 8px 0 0; color: #c2c7ee; max-width: 520px; }
.lp-cta-btns { display: flex; gap: 12px; flex-wrap: wrap; }

/* footer */
.lp-foot { padding: 48px 0 28px; border-top: 1px solid var(--line); background: #fafbff; }
.lp-foot-in { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 28px; }
.lp-foot-brand img { width: 140px; height: auto; } .lp-foot-brand p { margin: 12px 0 0; color: var(--muted); font-size: 13.5px; max-width: 300px; }
.lp-foot h4 { margin: 0 0 10px; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--navy); }
.lp-foot-in > div:not(.lp-foot-brand) { display: grid; gap: 8px; align-content: start; }
.lp-foot a { color: var(--text); text-decoration: none; font-size: 14px; } .lp-foot a:hover { color: var(--indigo); }
.lp-copy { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; }

/* smaller screens */
@media (max-width: 1000px) {
  .lp-hero-in, .lp-verify { grid-template-columns: 1fr; }
  .lp-shot { transform: none; max-width: 560px; }
  .lp-bento { grid-template-columns: repeat(2, 1fr); }
  .lp-sec4 { grid-template-columns: repeat(2, 1fr); }
  .lp-journey { grid-template-columns: repeat(3, 1fr); row-gap: 28px; } .lp-journey::before { display: none; }
  .lp-foot-in { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 760px) {
  .lp-nav nav { display: none; } .lp-nav .lp-btn { margin-left: auto; }
  .lp-aud, .lp-start, .lp-help { grid-template-columns: 1fr; }
  .lp-shot-float { left: 10px; }
}
@media (max-width: 520px) {
  .lp-bento, .lp-sec4 { grid-template-columns: 1fr; } .lp-feat.big { grid-column: auto; }
  .lp-journey { grid-template-columns: repeat(2, 1fr); }
  .lp-foot-in { grid-template-columns: 1fr; }
  .lp-hero-cta .lp-btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .lp-btn, .lp-aud-card { transition: none; } }
`
