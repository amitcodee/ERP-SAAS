export const dynamic = 'force-dynamic'
import { InternshipsPanel } from '@/components/internships-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { todayIST } from '@/modules/fees/plan'
import { lettersFromRegistrations, listCompanies, listInternships, listTemplates } from '@/modules/letters/service'

// Documents / Internship Requests: internship letters. Tab and search live in the address (?tab=&q=). Students ticked for
// internship letters at registration show under "From registrations" (the first tab while any are waiting). Like the
// Registration list, branches are scoped by RLS: a super admin sees every branch whatever the working branch.
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { actor, ok, isSuper, needsBranch } = await requirePage('Internship Requests')
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 80)
  const d = await withTenant(actor, async (tx) => {
    const fromReg = (await lettersFromRegistrations(tx, actor, { q, branchId: null }))
    const tab = sp.tab ?? (fromReg.length ? 'from' : 'offer')
    return { tab, fromReg, data: await listInternships(tx, actor, { tab, q, today: todayIST(), branchId: null }), templates: await listTemplates(tx), companies: await listCompanies(tx, { active: true }) }
  })
  return <InternshipsPanel page="requests" data={d.data} fromReg={d.fromReg} templates={d.templates} companies={d.companies} filters={{ tab: d.tab, q }} showBranch={isSuper} needsBranch={needsBranch} can={{ request: ok('create', 'internship'), issue: ok('approve', 'internship') }} />
}
