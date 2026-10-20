// Which organisation a request is for, from its Host header. Pure (no database), so proxy.ts can use it too.
//   <slug>.<ROOT_DOMAIN>     an organisation's workspace
//   admin.<ROOT_DOMAIN>      the platform console
//   <ROOT_DOMAIN>, www.      the public site (marketing, sign-up, "find my institute")
//   anything else            maybe an org's verified custom domain (looked up in org_domains)
// In development `<slug>.localhost` works the same (Chrome and Firefox resolve *.localhost to this machine), and
// DEFAULT_ORG_SLUG makes the bare host (localhost) one org's workspace: local work and the end-to-end run.

/** The organisation a request is for: just what routing needs (resolved before anyone has signed in). */
export type OrgRef = { id: string; slug: string; name: string; status: string }

export type HostKind = { kind: 'org'; slug: string } | { kind: 'platform' } | { kind: 'apex' } | { kind: 'custom'; host: string }

/** Subdomains that can never be an organisation's slug. */
export const RESERVED_SLUGS = new Set(['www', 'admin', 'app', 'api', 'mail', 'smtp', 'status', 'docs', 'blog', 'help', 'support', 'billing', 'static', 'cdn', 'assets', 'dev', 'staging', 'test', 'demo', 'login', 'signup', 'platform'])

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])

export function hostName(host: string | null | undefined): string {
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
}

export function classifyHost(rawHost: string | null | undefined, root = process.env.ROOT_DOMAIN?.toLowerCase(), defaultSlug = process.env.DEFAULT_ORG_SLUG): HostKind {
  const host = hostName(rawHost)
  const sub = (base: string) => (host.endsWith(`.${base}`) ? host.slice(0, -base.length - 1) : null)
  const asOrg = (label: string | null): HostKind | null => {
    if (!label || label.includes('.')) return null
    if (label === 'admin') return { kind: 'platform' }
    if (label === 'www') return { kind: 'apex' }
    return RESERVED_SLUGS.has(label) ? { kind: 'apex' } : { kind: 'org', slug: label }
  }
  const bare = (): HostKind => (defaultSlug ? { kind: 'org', slug: defaultSlug } : { kind: 'apex' })
  if (root && host === root) return bare()
  const onRoot = root ? asOrg(sub(root)) : null
  if (onRoot) return onRoot
  if (LOCAL.has(host)) return bare()
  const onLocal = asOrg(sub('localhost'))
  if (onLocal) return onLocal
  return host ? { kind: 'custom', host } : bare()
}

/** A valid new slug, or why not. */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) return 'Use 1 to 40 lower-case letters, digits or hyphens (not at the start or end)'
  if (RESERVED_SLUGS.has(slug)) return 'That address is reserved: pick another'
  return null
}
