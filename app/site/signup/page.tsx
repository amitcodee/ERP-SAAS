import { onboardingRules } from '@/modules/platform/rules'
import { SitePage } from '@/components/site/shell'
import { SignupForm } from '@/components/site/signup-form'
import { addressSuffix, PRODUCT } from '@/lib/product'
import { publicPlans } from '@/modules/plans/service'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Start your free trial' }

export default async function Signup({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { trialDays, approval } = await onboardingRules()
  const { plan } = await searchParams
  const plans = (await publicPlans()).filter((p) => p.priceMonthly > 0)
  return (
    <SitePage eyebrow={`Free for ${trialDays} days`} title="Set up your institute" intro={approval ? `Every feature, no card needed. We e-mail you a code to confirm it is you; then you can set up while we approve your institute, and your ${trialDays}-day trial starts.` : 'Every feature, no card needed. We e-mail you a code to confirm it is you; then you are in.'}>
      <SignupForm plans={plans.map((p) => ({ key: p.key, name: p.name }))} plan={plans.some((p) => p.key === plan) ? plan! : 'starter'} suffix={addressSuffix()} />
    </SitePage>
  )
}
