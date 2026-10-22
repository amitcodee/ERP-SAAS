import { PlatformRules } from '@/components/platform-rules'
import { requirePlatform } from '@/lib/platform/current'
import { onboardingRules } from '@/modules/platform/rules'

// How new institutes start: the free trial's length, and whether they wait for approval (modules/platform/rules.ts).
export default async function Page() {
  await requirePlatform()
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform</p><h1>Settings</h1><p className="subheading">How a new institute starts after it signs up.</p></div></div>
      <PlatformRules rules={await onboardingRules()} />
    </section>
  )
}
