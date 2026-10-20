import { jobAuthorized } from '@/lib/jobs'
import { runJobForAllOrgs } from '@/lib/job-registry'

export const dynamic = 'force-dynamic'

// The fee reminders job. The panel runs it by itself at the time set in Settings → Scheduled jobs; an outside
// scheduler can call it too, and it then runs for every open organisation (safe to call repeatedly: the same
// reminder is never queued or sent twice):
//   wget -qO- --header="Authorization: Bearer $CRON_SECRET" --post-data='' http://127.0.0.1:3000/api/jobs/reminders
export async function POST(req: Request) {
  if (!jobAuthorized(req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // every open organisation, one after another (each run is recorded in that org's job_runs)
  const r = await runJobForAllOrgs('reminders')
  return Response.json(r, { status: r.ok ? 200 : 500 })
}
