import { PlanEditor } from '@/components/platform-console'
import { requirePlatform } from '@/lib/platform/current'
import { listAllPlans } from '@/modules/platform/console'
import { PLAN_MODULES } from '@/modules/plans/service'

// Plans: prices (before GST), limits and modules. A change applies to the next payment; paid periods stay.
export default async function Page() {
  await requirePlatform()
  const plans = await listAllPlans()
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform</p><h1>Plans</h1><p className="subheading">What institutes pay and get. Prices in rupees before GST.</p></div></div>
      {plans.map((p) => <PlanEditor key={p.key} plan={p} modules={PLAN_MODULES} />)}
      <h2>New plan</h2>
      <PlanEditor plan={null} modules={PLAN_MODULES} />
    </section>
  )
}
