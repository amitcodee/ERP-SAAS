// How new institutes start (Console → Settings), kept in platform_config ('onboarding'):
//   trialDays  how long the free trial runs (it starts when the institute is approved, or at sign-up without approval)
//   approval   new institutes wait for the platform's approval: the owner can sign in, finish Set Up and pay, but the
//              institute does not run until approved (modules/platform/console.ts approveOrg)
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { withPlatform, type Tx } from '@/lib/db/withTenant'

export type OnboardingRules = { trialDays: number; approval: boolean }
export const RULES_DEFAULTS: OnboardingRules = { trialDays: 2, approval: true }

export const rulesInput = z.object({
  trialDays: z.number().int('Whole days').min(1, 'At least 1 day').max(90, 'At most 90 days'),
  approval: z.boolean(),
})

/** The rules, in an open platform transaction. */
export async function onboardingRulesIn(tx: Tx): Promise<OnboardingRules> {
  const [r] = (await tx.execute<{ config: Partial<OnboardingRules> }>(sql`select config from platform_config where key = 'onboarding'`)).rows
  const v = rulesInput.safeParse({ ...RULES_DEFAULTS, ...(r?.config ?? {}) })
  return v.success ? v.data : RULES_DEFAULTS
}
export const onboardingRules = () => withPlatform(onboardingRulesIn)

export async function saveOnboardingRules(raw: z.input<typeof rulesInput>) {
  const v = rulesInput.parse(raw)
  await withPlatform((tx) => tx.execute(sql`
    insert into platform_config (key, config, updated_at) values ('onboarding', ${JSON.stringify(v)}::jsonb, now())
    on conflict (key) do update set config = excluded.config, updated_at = now()`))
  return v
}
