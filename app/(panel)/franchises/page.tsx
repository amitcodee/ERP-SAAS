export const dynamic = 'force-dynamic'
import { FranchisesPanel } from '@/components/franchises-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/lib/ist'
import { franchiseStatements, listRoyaltyPayments, ROYALTY_MODES } from '@/modules/franchise/service'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

// Franchises (modules/franchise/service.ts): head office sees every franchise centre with its terms and the month's
// royalty, records the partners' payments and makes a centre a franchise; a franchise's own staff see their statement.
export default async function Page({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor, isSuper, branches, ok } = await requirePage('Franchises')
  const sp = await searchParams
  const now = todayIST().slice(0, 7)
  const month = sp.month && MONTH.test(sp.month) && sp.month <= now ? sp.month : now
  const branchId = isSuper ? actor.branchId : actor.branchId // head office working inside one branch sees that one
  const d = await withTenant(actor, async (tx) => ({
    franchises: await franchiseStatements(tx, actor, { month, branchId }),
    payments: await listRoyaltyPayments(tx, actor, branchId),
  }))
  return (
    <FranchisesPanel
      month={month} thisMonth={now} today={todayIST()} franchises={d.franchises} payments={d.payments} modes={[...ROYALTY_MODES]}
      canEdit={ok('update', 'franchise')} canRecord={ok('create', 'franchise')} canDelete={ok('delete', 'franchise')}
      ownBranches={isSuper ? branches.filter((b) => !d.franchises.some((f) => f.branchId === b.id)).map((b) => ({ id: b.id, name: b.name })) : []}
    />
  )
}
