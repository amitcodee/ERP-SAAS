import Link from 'next/link'
import { Inter } from 'next/font/google'
import { ArrowRight, GraduationCap } from 'lucide-react'
import { LANDING_CSS } from './landing-css'
import { SITE_THEME } from './site-theme'
import { PRODUCT } from '@/lib/product'
import { onboardingRules } from '@/modules/platform/rules'

const inter = Inter({ subsets: ['latin'], variable: '--font-site', display: 'swap' })

// The frame of the platform's public site (the apex domain): the offer line, top bar, the page, footer (SITE_THEME look). Links are the visitor's paths
// (/pricing); the proxy maps them onto /site/*.
export async function SiteShell({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear()
  const { trialDays } = await onboardingRules()
  return (
    <div className={`lp sx ${inter.variable}`}>
      <style>{LANDING_CSS + SITE_CSS + SITE_THEME}</style>
      <div className="sx-offer">Every feature free for {trialDays} days · no card needed <Link href="/signup">Start now</Link></div>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link href="/" className="lp-logo site-logo"><span className="lp-ico lp-ico-sm"><GraduationCap size={18} color="#fff" /></span><b>{PRODUCT.name}</b></Link>
          <nav aria-label="Site">
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Guides</Link>
            <Link href="/faq">FAQ</Link>
          </nav>
          <div className="sx-nav-cta">
            <Link href="/signup" className="lp-btn sx-btn-green">Start for free <ArrowRight size={15} /></Link>
            <Link href="/find" className="lp-btn sx-btn-line">Sign in <ArrowRight size={15} /></Link>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="lp-foot-brand">
            <span className="site-logo"><span className="lp-ico lp-ico-sm"><GraduationCap size={18} color="#fff" /></span><b>{PRODUCT.name}</b></span>
            <p>Admissions, fees, classes and certificates for coaching institutes, computer centres and training academies.</p>
          </div>
          <div><h4>Product</h4><Link href="/features">Features</Link><Link href="/pricing">Pricing</Link><Link href="/docs">Guides</Link><Link href="/status">Status</Link></div>
          <div><h4>Company</h4><Link href="/contact">Contact</Link><Link href="/faq">FAQ</Link><Link href="/find">Find my institute</Link></div>
          <div><h4>Legal</h4><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/refund">Refunds</Link></div>
        </div>
        <div className="lp-wrap lp-copy">© {year} {PRODUCT.legalName}. All rights reserved.</div>
      </footer>
    </div>
  )
}

/** A plain page of the site: heading, intro, body. */
export function SitePage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <SiteShell>
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-eyebrow">{eyebrow}</span><h1 className="site-h1">{title}</h1>{intro && <p>{intro}</p>}</div>
          {children}
        </div>
      </section>
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
