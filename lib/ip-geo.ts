// Where an IP is (city, region, country, network), for the sign-in log. Looked up once per IP from ipwho.is (free,
// no key) after the response is sent, and kept for 30 days. IP_GEO_LOOKUP=off switches the lookup off.
import { sql } from 'drizzle-orm'
import { isPrivateIp } from '@/lib/client-ip'
import { withPlatform } from '@/lib/db/withTenant'
import { log } from '@/lib/log'

export async function fillIpGeo(ip: string | null | undefined) {
  if (!ip || process.env.IP_GEO_LOOKUP === 'off') return
  try {
    const fresh = await withPlatform(async (tx) => (await tx.execute(sql`select 1 from ip_geo where ip = ${ip} and looked_up_at > now() - interval '30 days'`)).rows.length > 0)
    if (fresh) return
    let geo: { country: string | null; region: string | null; city: string | null; isp: string | null }
    if (isPrivateIp(ip)) geo = { country: null, region: null, city: 'Local network', isp: null }
    else {
      const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,region,city,connection`, { signal: AbortSignal.timeout(4000) })
      const j = (await res.json().catch(() => null)) as { success?: boolean; country?: string; region?: string; city?: string; connection?: { isp?: string; org?: string } } | null
      if (!j?.success) return
      geo = { country: j.country ?? null, region: j.region ?? null, city: j.city ?? null, isp: j.connection?.isp ?? j.connection?.org ?? null }
    }
    await withPlatform((tx) => tx.execute(sql`
      insert into ip_geo (ip, country, region, city, isp, looked_up_at) values (${ip}, ${geo.country}, ${geo.region}, ${geo.city}, ${geo.isp}, now())
      on conflict (ip) do update set country = excluded.country, region = excluded.region, city = excluded.city, isp = excluded.isp, looked_up_at = now()`))
  } catch (e) {
    log.warn('ip_geo_failed', { ip, error: e instanceof Error ? e.message : String(e) })
  }
}
