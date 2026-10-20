export const dynamic = 'force-dynamic'
import { Screen } from '@/components/screen'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { cachedCatalogs } from '@/modules/catalog/service'
import { listWebLeads } from '@/modules/web-leads/service'

// Web Leads: forms from the institute websites. Head office sees every website; a branch sees its own (RLS).
export default async function Page() {
  const { actor, ok, isSuper, branches } = await requirePage('Web Leads')
  const d = await withTenant(actor, async (tx) => ({ ...(await listWebLeads(tx, actor, { limit: 50 })), catalogs: await cachedCatalogs(tx, actor.orgId) }))
  return <Screen name="webLeads" props={{
    rows: d.rows, total: d.total, sites: d.sites, branches: branches.filter((b) => b.status === 'active').map((b) => ({ id: b.id, code: b.code, name: b.name })),
    canAssign: ok('assign', 'weblead'), canOpenLead: ok('read', 'enquiry'), canEditLead: ok('update', 'enquiry'), isHeadOffice: isSuper, catalogs: d.catalogs,
  }} />
}
