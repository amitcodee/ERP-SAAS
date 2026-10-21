import { clientIpFrom } from '@/lib/client-ip'
import { withOrgSystem } from '@/lib/db/withTenant'
import { requestOrg } from '@/lib/tenant/request'
import { webLeadsAuthorized } from '@/lib/tenant/web-leads-secret'
import { underLimit } from '@/lib/redis'
import { ingestWebLead } from '@/modules/web-leads/service'
import { userMessage } from '@/lib/errors'

export const dynamic = 'force-dynamic'

// Website forms post their leads here, on the institute's own address, from the website's SERVER (the secret must
// never be in the browser). The secret is the org's own (lib/tenant/web-leads-secret.ts):
//   POST https://<institute>.<root>/api/webhooks/web-leads   Authorization: Bearer <org secret>   Content-Type: application/json
//   { "site": "https://acmeludhiana.com", "sourceUrl": "<page of the form>", "externalId": "<the site's own id>",
//     "name": "...", "phone": "...", "email": "...", "course": "...", "location": "...", "message": "...", "submittedAt": "..." }
// Several at once: send an array (at most 500). Sending the same lead again (same site + externalId) adds nothing.
const MAX = 500
const MAX_BYTES = 2_000_000 // 500 ordinary form leads fit easily

export async function POST(req: Request) {
  const org = await requestOrg()
  if (!org || !webLeadsAuthorized(org.id, req)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const ip = clientIpFrom(req.headers) ?? 'unknown'
  if (!(await underLimit(`weblead:${ip}`, 600, 60))) return Response.json({ error: 'too many requests' }, { status: 429 })
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return Response.json({ error: 'too large: send fewer leads at once' }, { status: 413 })
  const raw = await req.text()
  if (raw.length > MAX_BYTES) return Response.json({ error: 'too large: send fewer leads at once' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return Response.json({ error: 'send JSON' }, { status: 400 }) }
  const items = Array.isArray(body) ? body : [body]
  if (!items.length || items.length > MAX) return Response.json({ error: `send 1 to ${MAX} leads` }, { status: 400 })

  const results: { status: string; error?: string }[] = []
  for (const item of items) {
    // Each lead on its own: one bad lead does not stop the others.
    try {
      results.push(await withOrgSystem(org.id, (tx) => ingestWebLead(tx, item as never)))
    } catch (e) {
      results.push({ status: 'error', error: userMessage(e, 'failed', 'weblead.error') })
    }
  }
  const count = (s: string) => results.filter((r) => r.status === s).length
  return Response.json({ ok: !count('error'), received: items.length, placed: count('placed') + count('added_to_existing'), waiting: count('waiting'), duplicate: count('duplicate'), errors: count('error'), results: Array.isArray(body) ? results : undefined, result: Array.isArray(body) ? undefined : results[0] })
}
