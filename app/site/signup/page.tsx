import { BadgeCheck, CreditCard, Globe } from 'lucide-react'
import { onboardingRules } from '@/modules/platform/rules'
import { APPS } from '@/components/site/content'
import { SiteAuth } from '@/components/site/shell'
import { SignupForm } from '@/components/site/signup-form'
import { addressSuffix } from '@/lib/product'
import { publicPlans } from '@/modules/plans/service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Start your free trial' }

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN')

// Sign-up: the steps, the heading, the form in one card, and under it every app the trial opens.
// ?plan= picks the plan, ?name= carries the institute's name typed on the home page.
export default async function Signup({ searchParams }: { searchParams: Promise<{ plan?: string; name?: string }> }) {
  const { trialDays, approval } = await onboardingRules()
  const { plan, name } = await searchParams
  const plans = (await publicPlans()).filter((p) => p.priceMonthly > 0)
  const suffix = addressSuffix()
  return (
    <SiteAuth below={
      <section className="au-incl">
        <h2>Every app is open in your trial</h2>
        <p>Use all of them for {trialDays} days; keep the ones your plan covers.</p>
        <div className="sx-apps">{APPS.map((a) => <div key={a.label} className="sx-app"><span><a.icon color={a.color} strokeWidth={1.8} /></span>{a.label}</div>)}</div>
      </section>
    }>
      <div className="au-steps" aria-label="Steps"><span className="on"><b>1</b> Your details</span><i /><span><b>2</b> E-mail code</span><i /><span><b>3</b> Set up</span></div>
      <h1>Start your <span className="hl">free trial</span></h1>
      <p className="lead">{approval ? `We check each new institute (usually within a working day); you can set up meanwhile, and your ${trialDays}-day trial starts once approved.` : `${trialDays} days with every feature. We e-mail you a code to confirm it is you, then you are in.`}</p>
      <ul className="au-perks"><li><CreditCard size={16} /> No card needed</li><li><Globe size={16} /> Your own web address</li><li><BadgeCheck size={16} /> Every feature for {trialDays} days</li></ul>
      <SignupForm
        plans={plans.map((p) => ({ key: p.key, name: p.name, price: `${inr(p.priceMonthly)} / month` }))}
        plan={plans.some((p) => p.key === plan) ? plan! : (plans[0]?.key ?? 'starter')}
        suffix={suffix} name={(name ?? '').slice(0, 120)} />
    </SiteAuth>
  )
}
