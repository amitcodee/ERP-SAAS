export const dynamic = 'force-dynamic'
import { LeaderboardsPanel } from '@/components/leaderboards-panel'
import { requirePage } from '@/lib/panel/base'
import { todayIST } from '@/lib/ist'
import { leaderboards } from '@/modules/reports/leaderboards'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i

// Leaderboards over a period (this month unless another is picked; ?from=&to=&batch= in the address).
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; batch?: string }> }) {
  const { actor, ok, isSuper, user } = await requirePage('Leaderboards')
  const sp = await searchParams
  const today = todayIST()
  const from = sp.from && ISO.test(sp.from) && sp.from <= today ? sp.from : today.slice(0, 8) + '01'
  const to = sp.to && ISO.test(sp.to) && sp.to >= from && sp.to <= today ? sp.to : today
  const batch = sp.batch && UUID.test(sp.batch) ? sp.batch : null
  const show = { admissions: ok('read', 'report') || ok('read', 'enquiry') || ok('read', 'lead'), teaching: ok('read', 'report') || ok('read', 'teaching') || ok('read', 'batch') }
  const data = await leaderboards(actor, { from, to }, show, batch)
  return <LeaderboardsPanel data={data} from={from} to={to} today={today} batch={batch} me={actor.userId} scope={isSuper ? user.branchName : ''} showBranch={isSuper && !actor.branchId} />
}
