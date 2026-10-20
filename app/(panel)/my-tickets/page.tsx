export const dynamic = 'force-dynamic'
import { HelpDesk } from '@/components/help-desk'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { INTERNAL_CATEGORIES, listTickets, PRIORITIES, TICKET_CATEGORIES } from '@/modules/support/service'

// My Tickets: the internal tickets this staff member raised and the tickets given to them; and raising a new one.
export default async function Page() {
  const { actor, isSuper } = await requirePage('My Tickets')
  const rows = await withTenant(actor, (tx) => listTickets(tx, actor, { scope: 'mine' }))
  return <HelpDesk rows={rows} mode="mine" meId={actor.userId} categories={Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.key, c.label]))}
    internalCategories={INTERNAL_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} priorities={PRIORITIES.map((p) => ({ ...p }))} showBranch={isSuper && !actor.branchId} />
}
