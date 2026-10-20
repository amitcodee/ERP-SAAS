// The visitor's IP. Behind the reverse proxy (Coolify / Traefik) the real address is the one the proxy APPENDS to
// X-Forwarded-For: the first entry is whatever the browser sent and can be made up, so it must never be trusted for
// limits or blocks. TRUSTED_PROXY_HOPS = how many proxies sit in front (1: Traefik; 2: Cloudflare + Traefik).
const hops = () => Math.max(1, Math.min(5, Number(process.env.TRUSTED_PROXY_HOPS) || 1))

/** "::ffff:1.2.3.4" → "1.2.3.4", "1.2.3.4:5678" → "1.2.3.4", "[::1]:80" → "::1". */
export function normalizeIp(raw: string | null | undefined): string | null {
  let ip = raw?.trim()
  if (!ip) return null
  if (ip.startsWith('[')) ip = ip.slice(1, ip.indexOf(']') > 0 ? ip.indexOf(']') : undefined)
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'))
  if (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7)
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip.toLowerCase() : null
}

export function clientIpFrom(h: Headers): string | null {
  const chain = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (chain.length) return normalizeIp(chain[Math.max(0, chain.length - hops())])
  return normalizeIp(h.get('x-real-ip'))
}

/** Loopback and private networks: never auto-blocked, no location lookup. */
export function isPrivateIp(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip) || ip === '::1' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)
}
