import { serveApi } from '@/modules/integrations/api'
import { userMessage } from '@/lib/errors'
import { requestOrg } from '@/lib/tenant/request'

export const dynamic = 'force-dynamic'

// Read-only data for business tools (Power BI, Excel, n8n...). Keys and the full guide: Settings → API access.
// Called on the institute's own address; a key only works there.
export async function GET(req: Request, ctx: RouteContext<'/api/v1/[dataset]'>) {
  const { dataset } = await ctx.params
  try {
    const org = await requestOrg()
    if (!org) return Response.json({ error: 'Not found' }, { status: 404 })
    const r = await serveApi(org.id, dataset, req)
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': r.type, 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: userMessage(e, 'Server error') }, { status: 500 })
  }
}
