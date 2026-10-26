import Link from 'next/link'
import { Caveat, Inter } from 'next/font/google'
import { ArrowRight, GraduationCap } from 'lucide-react'
import { LANDING_CSS } from './landing-css'
import { SITE_THEME } from './site-theme'
import { PRODUCT } from '@/lib/product'

const inter = Inter({ subsets: ['latin'], variable: '--font-site', display: 'swap' })
const hand = Caveat({ subsets: ['latin'], variable: '--font-hand', display: 'swap', weight: ['600', '700'] })

/** The site's mark: a cap on a yellow tile. */
export const Logo = ({ href = '/' }: { href?: string }) => <Link href={href} className="lp-logo site-logo"><span className="sx-logo-mark"><GraduationCap size={19} /></span><b>{PRODUCT.name}</b></Link>

/** A handwritten note with a curved arrow pointing up-left at what it is about. */
export const HandNote = ({ children }: { children: React.ReactNode }) => (
  <span className="sx-note">
    <svg width="46" height="40" viewBox="0 0 46 40" fill="none" aria-hidden="true"><path d="M42 36C28 36 12 28 8 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M2 12l6-8 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span className="hand">{children}</span>
  </span>
)

// The frame of the platform's public site (the apex domain): the top bar, the page, the footer (SITE_THEME look). Links
// are the visitor's paths (/pricing); the proxy maps them onto /site/*.
export function SiteShell({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()
  return (
    <div className={`lp sx ${inter.variable} ${hand.variable}`}>
      <style>{LANDING_CSS + SITE_CSS + SITE_THEME}</style>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Logo />
          <nav aria-label="Site">
            <Link href="/features">Apps</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Guides</Link>
            <Link href="/faq">Help</Link>
            <Link href="/contact">Contact</Link>
          </nav>
          <div className="sx-nav-cta">
            <Link href="/find" className="sx-signin">Sign in</Link>
            <Link href="/signup" className="lp-btn sx-btn-brand">Try it free</Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-foot-brand">
            <span className="site-logo"><span className="sx-logo-mark"><GraduationCap size={19} /></span><b>{PRODUCT.name}</b></span>
            <p>One place for admissions, fees, classes and certificates, for coaching institutes, computer centres and training academies.</p>
            <span className="hand">Less paperwork, more teaching.</span>
          </div>
          <div><h4>Product</h4><Link href="/features">Apps</Link><Link href="/pricing">Pricing</Link><Link href="/docs">Guides</Link><Link href="/status">Status</Link></div>
          <div><h4>Company</h4><Link href="/contact">Contact us</Link><Link href="/faq">Help</Link><Link href="/find">Find my institute</Link><Link href="/signup">Start a free trial</Link></div>
          <div><h4>Legal</h4><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund">Refunds</Link></div>
        </div>
        <div className="lp-wrap lp-copy">© {year} {PRODUCT.legalName}. All rights reserved.</div>
      </footer>
    </div>
  )
}

/**
 * The sign-up pages (sign-up, the e-mailed code, find my institute): a plain top bar with no menu, a light grey page,
 * the heading and the form in a white card in the middle; `below` sits under the card.
 */
export function SiteAuth({ children, below }: { children: React.ReactNode; below?: React.ReactNode }) {
  return (
    <div className={`lp sx au-page ${inter.variable} ${hand.variable}`}>
      <style>{LANDING_CSS + SITE_CSS + SITE_THEME + AUTH_CSS}</style>
      <header className="au-top"><div className="lp-wrap au-top-in"><Logo /><span><span className="au-have">Already have an institute? </span><Link href="/find">Sign in <ArrowRight size={14} /></Link></span></div></header>
      <main className="au-main">
        <div className="au-form">{children}</div>
        {below}
      </main>
      <footer className="au-foot">© {new Date().getFullYear()} {PRODUCT.legalName} · <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/contact">Help</Link></footer>
    </div>
  )
}

const AUTH_CSS = `
.sx.au-page { min-height: 100vh; display: flex; flex-direction: column; background: var(--paper); }
.au-top { background: #fff; border-bottom: 1px solid var(--line); }
.au-top-in { display: flex; justify-content: space-between; align-items: center; gap: 12px; height: 64px; color: var(--muted); font-size: 14.5px; }
.au-top a:not(.site-logo) { display: inline-flex; align-items: center; gap: 4px; color: var(--brand-text); font-weight: 600; text-decoration: none; }
.au-main { flex: 1; padding: clamp(28px, 6vh, 64px) 16px 56px; }
.au-form { width: 100%; max-width: 640px; margin: 0 auto; }
.au-form > h1 { text-align: center; font-size: clamp(32px, 4.4vw, 48px); line-height: 1.08; font-weight: 800; letter-spacing: -.04em; }
.au-form > p.lead { margin: 14px auto 28px; max-width: 520px; text-align: center; color: var(--text); font-size: 17px; }
.au-steps { display: flex; justify-content: center; gap: 10px; align-items: center; margin-bottom: 22px; color: var(--muted); font-size: 13.5px; font-weight: 600; }
.au-steps span { display: inline-flex; align-items: center; gap: 7px; } .au-steps span b { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #fff; border: 1.5px solid var(--line); color: var(--muted); font-size: 12px; }
.au-steps span.on { color: var(--ink); } .au-steps span.on b { background: var(--brand); border-color: var(--brand-d); color: var(--brand-ink); } .au-steps span.done b { background: var(--teal); border-color: var(--teal); color: #fff; }
.au-steps i { width: 32px; height: 1.5px; background: var(--line); }
.au-card { display: grid; gap: 20px; padding: clamp(22px, 4vw, 36px); border-radius: 14px; background: #fff; border: 1px solid var(--line); box-shadow: 0 1px 2px #0000000a, 0 24px 48px -36px #1f212844; }
.au-sec { display: grid; gap: 16px; } .au-sec + .au-sec { padding-top: 22px; border-top: 1px solid var(--line); }
.au-sec h3 { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--ink); }
.au-sec h3 i { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: var(--brand-soft); color: var(--brand-text); font-style: normal; font-size: 13px; font-weight: 700; }
.au-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.au-field { display: grid; gap: 6px; font-size: 14px; font-weight: 600; color: var(--ink); }
.au-field input, .au-field select { height: 46px; padding: 0 14px; border: 1px solid #d5d8de; border-radius: 8px; font: inherit; font-size: 15.5px; font-weight: 400; color: var(--ink); background: #fff; transition: border-color .15s, box-shadow .15s; width: 100%; }
.au-field input::placeholder { color: #a8adb7; }
.au-field input:focus { outline: 0; border-color: var(--brand-d); box-shadow: 0 0 0 3px #ffc21a40; }
.au-field small { color: var(--muted); font-weight: 400; font-size: 13px; }
.au-addrin { display: flex; align-items: stretch; border: 1px solid #d5d8de; border-radius: 8px; overflow: hidden; background: #fff; }
.au-addrin:focus-within { border-color: var(--brand-d); box-shadow: 0 0 0 3px #ffc21a40; }
.au-addrin input { border: 0 !important; box-shadow: none !important; flex: 1; min-width: 0; border-radius: 0 !important; } .au-addrin span { padding: 0 14px; color: var(--text); font-weight: 500; white-space: nowrap; background: var(--paper); display: grid; place-items: center; border-left: 1px solid #d5d8de; }
.au-url { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; background: var(--teal-soft); color: var(--teal-d); font-size: 14px; font-weight: 500; overflow: hidden; }
.au-url span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .au-url b { font-weight: 700; } .au-url svg { flex: none; }
.au-note { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; } .au-note.ok { color: var(--teal-d); } .au-note.no { color: #c2410c; }
.au-pw { position: relative; } .au-pw input { padding-right: 76px; }
.au-pw button { position: absolute; right: 6px; top: 50%; translate: 0 -50%; height: 34px; padding: 0 12px; border: 0; border-radius: 6px; background: var(--paper); color: var(--ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.au-meter { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; } .au-meter i { height: 4px; border-radius: 4px; background: var(--line); }
.au-meter.s1 i:nth-child(-n+1) { background: #e5533d; } .au-meter.s2 i:nth-child(-n+2) { background: var(--sun); } .au-meter.s3 i:nth-child(-n+3) { background: #4fb3b7; } .au-meter.s4 i { background: var(--teal); }
.au-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.au-plan { position: relative; display: grid; gap: 2px; padding: 14px 16px; border: 1px solid #d5d8de; border-radius: 10px; cursor: pointer; background: #fff; font-weight: 600; transition: border-color .15s; }
.au-plan:hover { border-color: var(--brand-d); }
.au-plan input { position: absolute; opacity: 0; pointer-events: none; }
.au-plan b { font-size: 15.5px; } .au-plan small { color: var(--muted); font-size: 13px; font-weight: 400; }
.au-plan:has(input:checked) { border-color: var(--brand-d); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--brand-d); }
.au-plan:has(input:checked)::after { content: '✓'; position: absolute; right: 10px; top: 10px; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; background: var(--brand); color: var(--brand-ink); font-size: 11px; font-weight: 800; }
.au-plan:has(input:focus-visible) { outline: 3px solid #e0a20088; outline-offset: 2px; }
.au-agree { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; color: var(--text); } .au-agree input { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--brand-text); flex: none; }
.au-agree a { color: var(--brand-text); font-weight: 600; }
.sx .au-submit { width: 100%; height: 52px; font-size: 16.5px; }
.au-fine { text-align: center; color: var(--muted); font-size: 14px; } .au-fine a { color: var(--brand-text); font-weight: 600; }
.au-error { margin: 0; padding: 10px 14px; border-radius: 8px; background: #fdecea; color: #b42318; font-weight: 600; font-size: 14px; }
.au-ok { margin: 0; padding: 10px 14px; border-radius: 8px; background: var(--teal-soft); color: var(--teal-d); font-weight: 600; font-size: 14px; }
.au-field input.au-code { letter-spacing: .5em; font-size: 26px; font-weight: 700; text-align: center; height: 62px; }
.au-incl { max-width: 900px; margin: 48px auto 0; text-align: center; }
.au-incl h2 { font-size: 20px; font-weight: 700; } .au-incl > p { margin: 6px 0 24px; color: var(--text); font-size: 15px; }
.au-incl .sx-apps { grid-template-columns: repeat(9, 1fr); gap: 20px 8px; max-width: none; }
@media (max-width: 860px) { .au-incl .sx-apps { grid-template-columns: repeat(6, 1fr); } }
@media (max-width: 600px) { .au-incl .sx-apps { grid-template-columns: repeat(3, 1fr); } }
.au-incl .sx-app { font-size: 13px; } .au-incl .sx-app span { width: 58px; height: 58px; border-radius: 14px; } .au-incl .sx-app span svg { width: 28px; height: 28px; }
.au-perks { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 26px; margin: 0 0 24px; padding: 0; list-style: none; color: var(--text); font-size: 14.5px; }
.au-perks li { display: inline-flex; align-items: center; gap: 7px; } .au-perks svg { color: var(--teal); }
.au-foot { padding: 20px 16px 28px; text-align: center; color: var(--muted); font-size: 13px; } .au-foot a { color: var(--text); }
@media (max-width: 520px) { .au-two { grid-template-columns: 1fr; } .au-have { display: none; } }
`

/** A plain page of the site: a grey head band (eyebrow, heading, intro), then the body. */
export function SitePage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SiteShell>
      <section className="sx-page-head">
        <div className="lp-wrap"><span className="sx-eyebrow">{eyebrow}</span><h1 className="site-h1">{title}</h1>{intro && <p>{intro}</p>}</div>
      </section>
      <section className="sx-page-body"><div className="lp-wrap">{children}</div></section>
    </SiteShell>
  )
}

const SITE_CSS = `
.site-logo { display: inline-flex; align-items: center; gap: 10px; color: var(--navy); text-decoration: none; font-size: 17px; }
.site-logo b { font-weight: 800; letter-spacing: -.02em; }
.site-h1 { font-size: clamp(30px, 4vw, 44px); line-height: 1.1; font-weight: 800; color: var(--ink); }
.site-prose { max-width: 760px; color: var(--text); }
.site-prose h2 { margin: 28px 0 8px; font-size: 20px; font-weight: 800; color: var(--navy); }
.site-prose p, .site-prose li { font-size: 15px; }
.site-note { padding: 12px 16px; border-radius: 12px; background: #fff7e6; border: 1px solid #f5c26b; color: #5c3b00; font-size: 13.5px; }
.site-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 18px; }
.site-plan { display: grid; align-content: start; gap: 10px; padding: 26px; border: 1px solid var(--line); border-radius: 22px; background: #fff; }
.site-plan.pop { border: 2px solid var(--indigo); box-shadow: 0 30px 60px -32px #10186a77; }
.site-plan h3 { font-size: 20px; font-weight: 800; color: var(--navy); }
.site-plan .price { font-size: 34px; font-weight: 800; color: var(--ink); letter-spacing: -.03em; }
.site-plan .price small { font-size: 14px; color: var(--muted); font-weight: 600; }
.site-plan ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 7px; color: var(--text); font-size: 14px; }
.site-plan li { display: flex; gap: 8px; } .site-plan li svg { flex: none; margin-top: 3px; color: #16a34a; }
.site-form { display: grid; gap: 14px; max-width: 520px; padding: 28px; border: 1px solid var(--line); border-radius: 22px; background: #fff; }
.site-form label { display: grid; gap: 6px; font-size: 13.5px; font-weight: 700; color: var(--navy); }
.site-form input, .site-form select, .site-form textarea { height: 44px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; font: inherit; font-weight: 500; color: var(--ink); background: #fff; }
.site-form textarea { height: auto; padding: 10px 14px; }
.site-form .addr { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.site-form .addr input { border: 0; flex: 1; min-width: 0; } .site-form .addr span { padding: 0 12px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.site-form small { color: var(--muted); font-weight: 500; }
.site-error { margin: 0; color: #b91c1c; font-weight: 700; font-size: 14px; }
.site-ok { margin: 0; color: #166534; font-weight: 700; font-size: 14px; }
.site-status { display: grid; gap: 10px; max-width: 640px; }
.site-status div { display: flex; justify-content: space-between; padding: 14px 18px; border: 1px solid var(--line); border-radius: 14px; background: #fff; font-weight: 700; }
`
