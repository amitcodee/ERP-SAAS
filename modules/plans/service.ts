// Plans: what an institute pays for and what it gets (the plans table, edited in the platform console). Limits are
// null for "no limit"; modules are the paid parts beyond the core (events, the API, a custom domain, …).
import { sql } from 'drizzle-orm'
import type { PlanLimits } from '@/lib/db/schema/tenancy'
import { withPlatform, type Tx } from '@/lib/db/withTenant'

/** The parts of the product a plan can include beyond the core, with what they are called on the pricing page. */
export const PLAN_MODULES: Record<string, string> = {
  events: 'Seminars & workshops with certificates',
  api: 'Read API and webhooks (Power BI, Excel, n8n)',
  custom_domain: 'Your own domain (erp.yourinstitute.com)',
  white_label: 'Your branding everywhere, no platform name',
  sso: 'Google / Microsoft sign-in',
}
export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  branches: 'branches', staff: 'staff logins', activeStudents: 'active students', storageMb: 'MB of files', messagesPerMonth: 'messages a month',
}

export type Plan = { key: string; name: string; description: string | null; priceMonthly: number; priceYearly: number; limits: PlanLimits; modules: string[]; isPublic: boolean; sort: number; isActive: boolean }

const SELECT = sql`select key, name, description, price_monthly as "priceMonthly", price_yearly as "priceYearly", limits, modules, is_public as "isPublic", sort, is_active as "isActive" from plans`

/** The plans shown on the pricing page (and offered at sign-up), cheapest first. */
export const publicPlans = () => withPlatform(async (tx) => (await tx.execute<Plan>(sql`${SELECT} where is_public and is_active order by sort`)).rows)

/** One plan (any context: plans are readable by everyone). */
export async function planIn(tx: Tx, key: string): Promise<Plan | null> {
  return (await tx.execute<Plan>(sql`${SELECT} where key = ${key}`)).rows[0] ?? null
}
