export const dynamic = 'force-dynamic'
import { CertificateDesk } from '@/components/certificate-desk'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { certificateDesk } from '@/modules/certificates/documents'
import { mayRevokeCertificate, skipsAccounts } from '@/modules/certificates/service'
import { todayIST } from '@/modules/fees/plan'

// Documents / Certificate Requests. Filters in the address: ?q=&stage=&fee=
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; fee?: string; period?: string }> }) {
  const { actor, ok, isSuper } = await requirePage('Certificate Requests')
  const sp = await searchParams
  const filters = { q: (sp.q ?? '').slice(0, 80), stage: sp.stage ?? '', fee: sp.fee ?? '', period: sp.period === 'this' || sp.period === 'next' ? sp.period : '' }
  const data = await withTenant(actor, (tx) => certificateDesk(tx, actor, { list: 'requests', ...filters, today: todayIST(), branchId: actor.branchId }))
  return (
    <CertificateDesk list="requests" data={data} filters={filters} showBranch={isSuper && !actor.branchId}
      can={{ request: ok('create', 'certificate'), clear: ok('clear', 'certificate'), issue: ok('approve', 'certificate'), skipAccounts: ok('approve', 'certificate') && skipsAccounts(actor), revoke: mayRevokeCertificate(actor) }} />
  )
}
