export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { RegistrationNew } from '@/components/registration-new'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { enquiryForRegistration, upcomingRegNo } from '@/modules/registrations/service'
import { listTemplates } from '@/modules/letters/service'

// New registration as a page of its own, outside the panel frame (no side menu), so the tablet can be handed to the
// student to fill in. A signed-in staff member with "Admit / register" is still required.
// /registrations/new?enquiry=<id> starts from that lead or visited enquiry.
export default async function Page({ searchParams }: { searchParams: Promise<{ enquiry?: string }> }) {
  const { actor, ok, user } = await requirePage('Registration')
  if (!ok('create', 'registration')) redirect('/registrations')
  const { enquiry } = await searchParams
  const d = await withTenant(actor, async (tx) => ({ catalogs: await cachedCatalogs(tx, actor.orgId), enquiry: enquiry ? await enquiryForRegistration(tx, actor, enquiry) : null, regNo: await upcomingRegNo(tx, actor), templates: await listTemplates(tx) }))
  return <RegistrationNew templates={d.templates} catalogs={d.catalogs} enquiry={d.enquiry} regNo={d.regNo} branchName={user.hasBranch ? user.branchName : null} />
}
