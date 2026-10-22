import { AdmissionForm } from '@/components/admission-form'
import { requireRequestOrg } from '@/lib/tenant/request'
import { applyForm, UTM_KEYS, type Utm } from '@/modules/web-leads/apply'

export type ApplyParams = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined, max: number) => (Array.isArray(v) ? v[0] : v)?.slice(0, max) || undefined

/**
 * The admission form of the institute whose address this is (modules/web-leads/apply.ts). The address may carry the
 * ad / post it came from (?utm_source=...) and a centre (?branch=<code>); embedded, also the website page holding it
 * (?page=) and that page's referrer (?ref=), which /apply/embed.js passes on.
 */
export async function ApplyView({ params, embed }: { params: ApplyParams; embed: boolean }) {
  const org = await requireRequestOrg()
  const f = await applyForm(org.id)
  const utm: Utm = {}
  for (const k of UTM_KEYS) { const x = one(params[k], 200); if (x) utm[k] = x }
  return <AdmissionForm f={f} embed={embed} utm={utm} branchCode={one(params.branch, 20)} page={embed ? one(params.page, 1500) : undefined} referrer={embed ? one(params.ref, 500) ?? '' : undefined} />
}
