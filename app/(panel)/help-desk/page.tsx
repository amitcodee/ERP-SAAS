export const dynamic = 'force-dynamic'
import { HelpDesk } from '@/components/help-desk'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { INTERNAL_CATEGORIES, listTickets, PRIORITIES, TICKET_CATEGORIES } from '@/modules/support/service'

// Help Desk: every ticket of the branch (every branch for head office) — students' questions and staff's internal tickets.
export default async function Page() {
  const { actor, isSuper } = await requirePage('Help Desk')
  const rows = await withTenant(actor, (tx) => listTickets(tx, actor, { scope: 'desk' }))
  return <HelpDesk rows={rows} mode="desk" meId={actor.userId} categories={Object.fromEntries(TICKET_CATEGORIES.map((c) => [c.key, c.label]))}
    internalCategories={INTERNAL_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} priorities={PRIORITIES.map((p) => ({ ...p }))} showBranch={isSuper && !actor.branchId} />
}
