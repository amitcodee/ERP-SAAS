import Link from 'next/link'
import { ArrowRight, BadgeCheck, Building2, Check, Monitor, School, Sparkles } from 'lucide-react'
import { FEATURES, JOURNEY, SECURITY } from '@/components/site/content'
import { SiteShell } from '@/components/site/shell'
import { PRODUCT } from '@/lib/product'

export const metadata = { title: { absolute: `${PRODUCT.name} | Institute management for coaching and training institutes` } }

const FOR = [
  { icon: School, title: 'Coaching institutes', items: ['Batches, timetables and attendance', 'Fee plans, instalments and reminders', 'Tests and results'] },
  { icon: Monitor, title: 'Computer centres', items: ['Course catalogue with syllabus', 'Certificates anyone can verify', 'Internship and project letters'] },
  { icon: Building2, title: 'Training academies with branches', items: ['Every branch in one place', 'Head office sees all, branches their own', 'Transfers and shared students'] },
]

// The platform's home page (the apex domain): what it is, who it is for, a free trial.
export default function Home() {
  return (
    <SiteShell>
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <span className="lp-pill"><Sparkles size={14} /> 14-day free trial · no card needed</span>
            <h1>Run your institute from the first call to the <span>certificate in hand.</span></h1>
            <p>Leads, admissions, fees, classes and certificates in one place, for every branch, with each person seeing just their part.</p>
            <div className="lp-hero-cta">
              <Link href="/signup" className="lp-btn lp-btn-lime">Start free trial <ArrowRight size={16} /></Link>
              <Link href="/pricing" className="lp-btn lp-btn-ghost">See pricing</Link>
            </div>
            <ul className="lp-hero-ticks">
              <li><Check size={15} /> Your own web address</li>
              <li><Check size={15} /> Works on phone and computer</li>
              <li><Check size={15} /> Your data kept apart from everyone else’s</li>
            </ul>
          </div>
          <div className="lp-shot" aria-hidden="true">
            <div className="lp-shot-bar"><i /><i /><i /><span>Dashboard</span></div>
            <div className="lp-shot-body">
              <div className="lp-shot-greet"><b>Good morning 👋</b><em>This month</em></div>
              <div className="lp-shot-kpis"><div><small>Enquiries</small><b /><span className="up">▲</span></div><div><small>Admissions</small><b /><span className="up">▲</span></div><div><small>Collected</small><b /><span className="up">▲</span></div></div>
              <div className="lp-shot-chart">{[34, 52, 41, 66, 58, 82, 70, 90].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</div>
            </div>
            <div className="lp-shot-float"><BadgeCheck size={18} /><div><b>Certificate verified</b><small>Genuine</small></div></div>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">Who it’s for</span><h2>Made for institutes that teach</h2></div>
          <div className="lp-aud">
            {FOR.map((a) => (
              <div key={a.title} className="lp-aud-card">
                <span className="lp-ico"><a.icon size={22} /></span>
                <h3>{a.title}</h3>
                <ul>{a.items.map((x) => <li key={x}><Check size={15} />{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec lp-soft">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">The journey</span><h2>Every student, start to finish</h2><p>Each step hands over to the next, so nothing is typed twice and nobody is forgotten.</p></div>
          <ol className="lp-journey">{JOURNEY.map((j, i) => <li key={j.title}><span className="lp-jn">{i + 1}</span><span className="lp-ico lp-ico-sm"><j.icon size={18} /></span><b>{j.title}</b><small>{j.text}</small></li>)}</ol>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">Features</span><h2>Built for how an institute really works</h2></div>
          <div className="lp-bento">{FEATURES.map((f) => <div key={f.title} className={`lp-feat${f.big ? ' big' : ''}`}><span className="lp-ico lp-ico-sm"><f.icon size={18} /></span><h3>{f.title}</h3><p>{f.text}</p></div>)}</div>
          <p style={{ marginTop: 24 }}><Link href="/features" className="lp-more">Everything it does <ArrowRight size={15} /></Link></p>
        </div>
      </section>

      <section className="lp-dark">
        <div className="lp-wrap">
          <div className="lp-head lp-head-light"><span className="lp-eyebrow">Safe by design</span><h2>Your students’ records stay yours</h2><p style={{ color: '#c2c7ee' }}>Every institute’s data is kept apart by the database itself, not just by the screens.</p></div>
          <div className="lp-sec4">{SECURITY.map((s) => <div key={s.title}><span className="lp-ico lp-ico-glass"><s.icon size={20} /></span><h3>{s.title}</h3><p>{s.text}</p></div>)}</div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-cta">
            <div><h2>Try it with your own institute</h2><p>Set up your branches, courses and fees in an afternoon. Free for 14 days, then pick a plan.</p></div>
            <div className="lp-cta-btns"><Link href="/signup" className="lp-btn lp-btn-lime">Start free trial <ArrowRight size={16} /></Link><Link href="/contact" className="lp-btn lp-btn-ghost">Talk to us</Link></div>
          </div>
        </div>
      </section>
    </SiteShell>
  )
}
