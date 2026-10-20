export const dynamic = 'force-dynamic'
import { TrainerPanel } from '@/components/trainer-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { listBatches } from '@/modules/academics/service'

// My Classes: a trainer's batches (their own; every batch of the branch for whoever manages batches).
export default async function Page() {
  const { actor, user } = await requirePage('My Classes')
  const batches = await withTenant(actor, (tx) => listBatches(tx, actor))
  return <TrainerPanel name={user.name} batches={batches.map((b) => ({ id: b.id, name: b.name, course: b.course, department: b.department, members: b.members, timing: b.timing, otherBranch: b.otherBranch }))} />
}
