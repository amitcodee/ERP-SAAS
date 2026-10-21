export const dynamic = 'force-dynamic'
import { sql } from 'drizzle-orm'
import { SetupWizard } from '@/components/setup-wizard'
import { CATALOGUES } from '@/lib/catalogues'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { defaultGstPct, onboardingState } from '@/modules/onboarding/service'
import { NO_CONTACT, type BrandContact } from '@/lib/brand'

// Set Up: the first steps of a new institute, each one ticked off as it is really done (work done on the other
// screens counts too). Head office only.
export default async function Page() {
  const b = await requirePage('Set Up')
  const d = await withTenant(b.actor, async (tx) => {
    const [o] = (await tx.execute<{ name: string; legal_name: string | null; branding: { tagline?: string; color?: string; logo?: string; accreditations?: string; contact?: Partial<BrandContact> } }>(sql`select name, legal_name, branding from organisations where id = app_org()`)).rows
    const modes = (await tx.execute<{ value: string }>(sql`select value from lookups where kind = 'payment_mode' and is_active order by sort_order, value`)).rows.map((r) => r.value)
    return { state: await onboardingState(tx), org: o, gst: await defaultGstPct(tx), modes }
  })
  return (
    <SetupWizard
      state={d.state} gst={d.gst} modes={d.modes}
      branding={{ legalName: d.org.legal_name ?? d.org.name, tagline: d.org.branding?.tagline ?? '', color: d.org.branding?.color ?? '#10186a', hasLogo: !!d.org.branding?.logo, hasAccreditations: !!d.org.branding?.accreditations, contact: { ...NO_CONTACT, ...d.org.branding?.contact } }}
      catalogues={CATALOGUES.map((c) => ({ key: c.key, label: c.label, about: c.about, courses: c.departments.reduce((n, x) => n + x.courses.length, 0) }))}
    />
  )
}
