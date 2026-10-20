export const dynamic = 'force-dynamic'
import { ProjectHelp } from '@/components/project-help'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { HELP_KINDS, listHelp } from '@/modules/teaching/service'

// Project Help: students' requests from every branch, for trainers to offer help on.
export default async function Page() {
  const { actor } = await requirePage('Project Help')
  const rows = await withTenant(actor, (tx) => listHelp(tx, actor))
  return <ProjectHelp rows={rows} kinds={Object.fromEntries(HELP_KINDS.map((k) => [k.key, k.label]))} />
}
