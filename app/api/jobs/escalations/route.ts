import { jobAuthorized } from '@/lib/jobs'
import { runJobForAllOrgs } from '@/lib/job-registry'

export const dynamic = 'force-dynamic'

// The overdue escalation mails. The panel runs it by itself at the time set in Settings → Scheduled jobs; an outside
// scheduler can call it too (it then runs for every open organisation):
//   wget -qO- --header="Authorization: Bearer $CRON_SECRET" --post-data='' http://127.0.0.1:3000/api/jobs/escalations
// Mails each branch manager and head office what has been escalated to them (see modules/overdues/digest.ts).
export async function POST(req: Request) {
  if (!jobAuthorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // every open organisation, one after another (each run is recorded in that org's job_runs)
  const r = await runJobForAllOrgs('escalations')
  return Response.json(r, { status: r.ok ? 200 : 500 })
}
