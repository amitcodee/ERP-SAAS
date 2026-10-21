// An institute's identity for everything it shows and sends: its name, the name it prints (legal name), tagline,
// colour, logo and contacts (organisations.name / legal_name / branding, set in Set Up). The code carries no institute's look;
// an institute without a logo gets a neutral mark of its initials in its colour.
import { sql } from 'drizzle-orm'
import { cached } from './cache'
import { withOrgSystem, type Tx } from './db/withTenant'

export type Brand = {
  name: string // what people call it (organisations.name)
  legalName: string // what is printed on receipts, certificates and letters
  tagline: string
  color: string // #rrggbb
  logo: string | null // a data URL, or null: draw the mark
  accreditations: string | null // an image of affiliations / accreditations for certificates, or null
  contact: BrandContact // printed on the ID card; each may be empty
  initials: string
}

export type BrandContact = { address: string; phone: string; website: string; social: string }

export const DEFAULT_COLOR = '#10186a'
export const NO_CONTACT: BrandContact = { address: '', phone: '', website: '', social: '' }
const initialsOf = (name: string) => name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·'

/** The brand of the transaction's institute. */
export async function brandIn(tx: Tx): Promise<Brand> {
  const [o] = (await tx.execute<{ name: string; legal_name: string | null; branding: { tagline?: string; color?: string; logo?: string; accreditations?: string; contact?: Partial<BrandContact> } | null }>(sql`
    select name, legal_name, branding from organisations where id = app_org()`)).rows
  const b = o?.branding ?? {}
  const name = o?.name ?? 'Institute'
  return {
    name, legalName: o?.legal_name || name, tagline: b.tagline ?? '', color: /^#[0-9a-fA-F]{6}$/.test(b.color ?? '') ? b.color! : DEFAULT_COLOR,
    logo: b.logo?.startsWith('data:image/') ? b.logo : null, accreditations: b.accreditations?.startsWith('data:image/') ? b.accreditations : null, initials: initialsOf(name),
    contact: { ...NO_CONTACT, ...b.contact },
  }
}

/** The brand of an institute (kept a minute; a change of branding is a write, which empties the org's cache). */
export const orgBrand = (orgId: string) => cached(orgId, 'brand', () => withOrgSystem(orgId, brandIn))
