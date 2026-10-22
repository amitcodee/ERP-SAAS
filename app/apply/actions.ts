'use server'
// The public admission form (modules/web-leads/apply.ts): no sign-in, so it is limited per connection and per institute.
import { headers } from 'next/headers'
import { clientIpFrom } from '@/lib/client-ip'
import { userMessage } from '@/lib/errors'
import { underLimit } from '@/lib/redis'
import { requireRequestOrg } from '@/lib/tenant/request'
import { submitApplication, type ApplyInput, type ApplyResult } from '@/modules/web-leads/apply'

export async function submitApplicationAction(input: ApplyInput): Promise<{ ok: true; data: ApplyResult } | { ok: false; error: string }> {
  const h = await headers()
  const ip = clientIpFrom(h)
  // an IPv6 address counts by its /64, which one home or phone holds
  const who = ip && ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip ?? 'unknown'
  if (!(await underLimit(`apply:${who}`, 8, 3600))) return { ok: false, error: 'Too many forms from this connection: please try again later, or call the institute.' }
  const org = await requireRequestOrg()
  if (!['trial', 'active', 'past_due'].includes(org.status)) return { ok: false, error: 'Admissions are not open online right now. Please call the institute.' }
  if (!(await underLimit(`apply-all:${org.id}`, 600, 3600))) return { ok: false, error: 'Too many forms right now: please try again in a little while.' }
  try {
    return { ok: true, data: await submitApplication(org.id, input, h.get('host') ?? '') }
  } catch (e) {
    const issue = (e as { issues?: { message: string }[] }).issues?.[0] // a visitor needs the sentence, not the field's name
    if (issue) return { ok: false, error: issue.message }
    return { ok: false, error: userMessage(e, 'Something went wrong. Please try again.', 'apply.error') }
  }
}
