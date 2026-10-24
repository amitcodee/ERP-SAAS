import { SitePage } from '@/components/site/shell'
import { onboardingRules } from '@/modules/platform/rules'
import { siteFaq } from '@/components/site/content'

export const metadata = { title: 'FAQ' }
export const dynamic = 'force-dynamic'

export default async function Faq() {
  const { trialDays, approval } = await onboardingRules()
  const FAQ = siteFaq(trialDays, approval)
  return (
    <SitePage eyebrow="FAQ" title="Questions institutes ask us">
      <div className="lp-acc" style={{ maxWidth: 820 }}>
        {FAQ.map((f) => <details key={f.q}><summary><span>{f.q}</span></summary><p>{f.a}</p></details>)}
      </div>
    </SitePage>
  )
}
