import { onboardingRules } from '@/modules/platform/rules'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { SitePage } from '@/components/site/shell'
import { LIMIT_LABELS, PLAN_MODULES, publicPlans } from '@/modules/plans/service'
import type { PlanLimits } from '@/lib/db/schema/tenancy'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pricing' }

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')

// The plans, from the plans table (the platform console edits them). Prices are before GST.
export default async function Pricing() {
  const { trialDays } = await onboardingRules()
  const plans = await publicPlans()
  return (
    <SitePage eyebrow="Pricing" title="Simple plans that grow with you" intro={`Every plan starts with a ${trialDays}-day free trial of everything. Prices are per institute, before 18% GST.`}>
      <div className="site-plans">
        {plans.map((p) => {
          const custom = p.priceMonthly === 0 && p.key !== 'free'
          return (
            <div key={p.key} className={`site-plan${p.key === 'growth' ? ' pop' : ''}`}>
              <h3>{p.name}</h3>
              <div className="price">{custom ? 'Talk to us' : p.priceMonthly === 0 ? 'Free' : <>{inr(p.priceMonthly)}<small> / month</small></>}</div>
              {!custom && p.priceYearly > 0 && <small>or {inr(p.priceYearly)} a year (2 months free)</small>}
              <p style={{ margin: 0, color: 'var(--text)' }}>{p.description}</p>
              <ul>
                {(Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[]).map((k) => <li key={k}><Check size={15} />{p.limits[k] == null ? 'Unlimited' : p.limits[k]!.toLocaleString('en-IN')} {LIMIT_LABELS[k]}</li>)}
                {p.modules.map((m) => <li key={m}><Check size={15} />{PLAN_MODULES[m] ?? m}</li>)}
              </ul>
              <Link href={custom ? '/contact' : `/signup?plan=${p.key}`} className={`lp-btn ${p.key === 'growth' ? 'lp-btn-dark' : 'lp-btn-lime'}`} style={{ marginTop: 8 }}>{custom ? 'Contact sales' : 'Start free trial'}</Link>
            </div>
          )
        })}
      </div>
      <p style={{ marginTop: 28, color: 'var(--text)' }}>Every plan includes enquiries and follow-ups, admissions, fees and receipts, batches and attendance, certificates, the student portal and reports. Pay monthly or yearly by UPI, card or net banking; change or cancel any time.</p>
    </SitePage>
  )
}
