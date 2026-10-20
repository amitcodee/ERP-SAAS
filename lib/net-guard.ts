import { lookup } from 'dns/promises'
import { lookup as lookupCb, type LookupAddress } from 'dns'
import http from 'http'
import https from 'https'
import { isIP } from 'net'

// Addresses the panel's own outgoing connections (branch mail servers, webhooks, pictures fetched for certificate
// designs) must never reach: the server itself, the private network its containers sit on (database, Redis) and the
// cloud metadata address. Settings saved in the panel could otherwise be used to probe them.

const v4Internal = (ip: string) => {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0)
}
/** An IPv6 address as its eight 16-bit groups (an embedded dotted IPv4 tail included), or null when it is not one. */
function groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (tail) { const [a, b, c, d] = tail[1].split('.').map(Number); s = s.slice(0, -tail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}` }
  const [head, rest] = s.split('::')
  const h = head ? head.split(':') : [], r = rest !== undefined && rest ? rest.split(':') : []
  const fill = s.includes('::') ? 8 - h.length - r.length : 0
  const all = [...h, ...Array(Math.max(0, fill)).fill('0'), ...r]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}
const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`

/**
 * Loopback, private, link-local, carrier-grade NAT, unspecified and multicast addresses (IPv4 and IPv6), and every IPv6
 * form that carries an IPv4 address inside it (::ffff:7f00:1, ::127.0.0.1, 64:ff9b::/96, 6to4) judged by that IPv4.
 */
export function isInternalIp(raw: string): boolean {
  const ip = raw.trim().replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(ip) === 4) return v4Internal(ip)
  if (isIP(ip) !== 6) return true
  const g = groups(ip)
  if (!g) return true
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0)
  if (zeros(8) || (zeros(7) && g[7] === 1)) return true // :: and ::1
  if (zeros(5) && g[5] === 0xffff) return v4Internal(v4Of(g[6], g[7])) // IPv4-mapped
  if (zeros(6)) return true // IPv4-compatible (deprecated): never a real public host
  if (g[0] === 0x64 && g[1] === 0xff9b) return g.slice(2, 6).some((x) => x !== 0) || v4Internal(v4Of(g[6], g[7])) // NAT64
  if (g[0] === 0x2002) return v4Internal(v4Of(g[1], g[2])) // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true // Teredo
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00
}

/**
 * Throws unless every address `host` resolves to is a public one. Single-label names ("postgres", "redis") are the
 * names of containers on the server's own network, so they are refused without a lookup.
 */
export async function assertPublicHost(host: string): Promise<void> {
  const h = host.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!h || (!isIP(h) && !h.includes('.')) || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    throw new Error('Use the public address of the server (e.g. smtp.gmail.com); internal addresses are not allowed')
  }
  const addrs = isIP(h) ? [h] : await lookup(h, { all: true, verbatim: true }).then((r) => r.map((a) => a.address)).catch(() => {
    throw new Error(`The server ${h} could not be found: check the address`)
  })
  if (!addrs.length || addrs.some(isInternalIp)) throw new Error('Use the public address of the server; internal addresses are not allowed')
}

/**
 * GET a public http(s) URL with the address checked AT CONNECT TIME (the lookup the socket uses refuses internal
 * addresses, so a name that changes its answer between a check and the request cannot reach inside), no redirects
 * followed, a time limit and a cap on the bytes read. For pictures fetched from a link.
 */
export function publicGet(url: URL, maxBytes: number, timeoutMs = 15000): Promise<{ status: number; type: string; location: string | null; body: Buffer | null }> {
  return new Promise((resolve, reject) => {
    if (!/^https?:$/.test(url.protocol)) return reject(new Error('Only http:// and https:// links'))
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (!isIP(host) && (!host.includes('.') || /(^|\.)(localhost|internal|local)$/.test(host))) return reject(new Error('That address is not allowed'))
    if (isIP(host) && isInternalIp(host)) return reject(new Error('That address is not allowed'))
    const checkedLookup = (name: string, opts: object, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) =>
      lookupCb(name, { ...opts, all: true }, (err, addrs) => {
        if (err) return cb(err, '')
        const list = addrs as LookupAddress[]
        if (!list.length || list.some((a) => isInternalIp(a.address))) return cb(new Error('That address is not allowed'), '')
        // the caller asked for all or one: hand back what it expects
        ;(opts as { all?: boolean }).all ? cb(null, list) : cb(null, list[0].address, list[0].family)
      })
    const req = (url.protocol === 'https:' ? https : http).get(url, { lookup: checkedLookup as never, timeout: timeoutMs, headers: { 'User-Agent': 'techcadd-panel', Accept: 'image/*' } }, (res) => {
      const status = res.statusCode ?? 0
      const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (status >= 300 && status < 400) { res.resume(); return resolve({ status, type, location: res.headers.location ?? null, body: null }) }
      if (status >= 400) { res.resume(); return resolve({ status, type, location: null, body: null }) }
      const parts: Buffer[] = []
      let n = 0
      res.on('data', (c: Buffer) => { n += c.length; if (n > maxBytes) { req.destroy(new Error('too big')); return } parts.push(c) })
      res.on('end', () => resolve({ status, type, location: null, body: Buffer.concat(parts) }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}
