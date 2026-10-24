import { onboardingRules } from '@/modules/platform/rules'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { siteFaq } from '@/components/site/content'
import { PriceToggle, type PricePlan } from '@/components/site/price-toggle'
import { SitePage } from '@/components/site/shell'
import { LIMIT_LABELS, PLAN_MODULES, publicPlans } from '@/modules/plans/service'
import type { PlanLimits } from '@/lib/db/schema/tenancy'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pricing' }

/** What every plan has, said once under the plans. */
const EVERY_PLAN = ['Enquiries, follow-ups and lead lists', 'Admissions with registration numbers and ID cards', 'Fee plans, instalments and QR receipts', 'Batches, attendance, tests and report cards', 'Course certificates in your own design', 'Student portal and a private page for parents', 'Import from Excel or Google Sheets', 'Reports, exports and the dashboard', 'Your own web address and your colours']

// The plans, from the plans table (the platform console edits them). Prices are before GST.
export default async function Pricing() {
  const { trialDays, approval } = await onboardingRules()
  const plans = await publicPlans()
  const common = new Set(plans.reduce<string[]>((acc, x, i) => (i === 0 ? x.modules : acc.filter((m) => x.modules.includes(m))), []))
  const shown: PricePlan[] = plans.map((p) => ({
    key: p.key, name: p.name, description: p.description ?? '', monthly: p.priceMonthly, yearly: p.priceYearly, custom: p.priceMonthly === 0 && p.key !== 'free',
    lines: [
      ...(Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((k) => `${p.limits[k] == null ? 'Unlimited' : p.limits[k]!.toLocaleString('en-IN')} ${p.limits[k] === 1 && LIMIT_LABELS[k] === 'branches' ? 'branch' : LIMIT_LABELS[k]}`),
      // what sets the plans apart: what every plan has is said once, below
      ...p.modules.filter((m) => !common.has(m)).map((m) => PLAN_MODULES[m] ?? m),
    ],
  }))
  const popular = plans.some((p) => p.key === 'growth') ? 'growth' : plans[Math.min(1, plans.length - 1)]?.key ?? ''
  const questions = siteFaq(trialDays, approval).filter((f) => /trial|pay|fail|cancel/i.test(f.q))
  return (
    <SitePage eyebrow="Pricing" title="Simple plans that grow with you" intro={`Every plan starts with a ${trialDays}-day free trial of everything. Prices are per institute, before 18% GST.`}>
      <PriceToggle plans={shown} popular={popular} />

      <div className="sx-every">
        <h2>Every plan includes</h2>
        <ul>{EVERY_PLAN.map((x) => <li key={x}><Check size={16} /> {x}</li>)}</ul>
        <p>Pay monthly or yearly by UPI, card or net banking, with a GST invoice for every payment; change or cancel any time.</p>
      </div>

      <div className="sx-head" style={{ marginTop: 64, marginBottom: 24 }}><h2>Questions about paying</h2></div>
      <div className="lp-acc" style={{ maxWidth: 820, margin: '0 auto' }}>{questions.map((f) => <details key={f.q}><summary><span>{f.q}</span></summary><p>{f.a}</p></details>)}</div>

      <div className="sx-band" style={{ marginTop: 64 }}>
        <h2>Not sure which plan?</h2>
        <p>Start the free trial with everything switched on; pick the plan that fits when it ends.</p>
        <div className="sx-cta"><Link href="/signup" className="lp-btn sx-btn-white">Start free trial <ArrowRight size={16} /></Link><Link href="/contact" className="lp-btn lp-btn-ghost">Talk to us</Link></div>
      </div>
    </SitePage>
  )
}
