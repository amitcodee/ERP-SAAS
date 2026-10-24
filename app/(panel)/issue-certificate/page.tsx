export const dynamic = 'force-dynamic'
import { CertificateDesk } from '@/components/certificate-desk'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { certificateDesk, deskBatches } from '@/modules/certificates/documents'
import { mayRevokeCertificate, skipsAccounts } from '@/modules/certificates/service'
import { todayIST } from '@/modules/fees/plan'

// Documents / Issue Certificate. Filters in the address: ?q=&stage=&fee=
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; fee?: string; period?: string; batch?: string }> }) {
  const { actor, ok, isSuper } = await requirePage('Issue Certificate')
  const sp = await searchParams
  const filters = { q: (sp.q ?? '').slice(0, 80), stage: sp.stage ?? '', fee: sp.fee ?? '', period: sp.period === 'this' || sp.period === 'next' ? sp.period : '', batch: /^[0-9a-f-]{36}$/i.test(sp.batch ?? '') ? sp.batch! : '' }
  const [data, batches] = await withTenant(actor, async (tx) => [await certificateDesk(tx, actor, { list: 'issue', ...filters, today: todayIST(), branchId: actor.branchId }), await deskBatches(tx, actor.branchId)] as const)
  return (
    <CertificateDesk batches={batches} list="issue" data={data} filters={filters} showBranch={isSuper && !actor.branchId}
      can={{ request: ok('create', 'certificate'), clear: ok('clear', 'certificate'), issue: ok('approve', 'certificate'), skipAccounts: ok('approve', 'certificate') && skipsAccounts(actor), revoke: mayRevokeCertificate(actor), headOffice: isSuper }} />
  )
}
