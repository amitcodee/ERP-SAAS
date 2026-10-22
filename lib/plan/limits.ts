// What an institute's plan allows (PLAN.md 2.4): limits on branches, staff logins, active students, stored files and
// messages a month, and the paid modules (events, the API, …). Checked by the services before they add something,
// so a screen, an import or a script cannot go past them. During the trial every module is open; the limits of the
// chosen plan apply from the start.
import { sql } from 'drizzle-orm'
import type { PlanLimits } from '../db/schema/tenancy'
import type { Tx } from '../db/withTenant'

export type LimitKey = keyof PlanLimits
export type OrgPlan = { key: string; name: string; status: string; limits: PlanLimits; modules: string[] }
export type Usage = Record<LimitKey, number>

const NOUN: Record<LimitKey, [string, string]> = {
  branches: ['branch', 'branches'], staff: ['staff login', 'staff logins'], activeStudents: ['active student', 'active students'],
  storageMb: ['MB of files', 'MB of files'], messagesPerMonth: ['message this month', 'messages this month'],
}

/** A plan's limit was reached: the message says which, and where to upgrade. */
export class PlanLimitError extends Error {
  constructor(message: string) { super(`${message} Upgrade under Settings → Plan & billing.`); this.name = 'PlanLimitError' }
}

/** The plan of the transaction's institute. */
export async function orgPlan(tx: Tx): Promise<OrgPlan> {
  const [p] = (await tx.execute<OrgPlan>(sql`
    select p.key, p.name, o.status, p.limits, p.modules from organisations o join plans p on p.key = o.plan_key where o.id = app_org()`)).rows
  if (!p) throw new Error('No plan for this institute')
  return p
}

/** What the institute uses now, against each limit (the whole institute, whoever asks). */
export async function orgUsage(tx: Tx): Promise<Usage> {
  const [u] = (await tx.execute<{ branches: number; staff: number; active_students: number; storage_mb: string; messages_month: number }>(sql`select * from org_usage()`)).rows
  return { branches: u.branches, staff: u.staff, activeStudents: u.active_students, storageMb: Number(u.storage_mb), messagesPerMonth: u.messages_month }
}

/** Refuses to add `adding` more of `key` when that would go past the plan's limit (null: no limit). */
export async function assertWithinLimit(tx: Tx, key: LimitKey, adding = 1) {
  const plan = await orgPlan(tx)
  const limit = plan.limits[key]
  if (limit == null) return
  const used = (await orgUsage(tx))[key]
  if (used + adding > limit) {
    const [one, many] = NOUN[key]
    throw new PlanLimitError(`Your ${plan.name} plan allows ${limit.toLocaleString('en-IN')} ${limit === 1 ? one : many}; ${used.toLocaleString('en-IN')} in use already.`)
  }
}

/** Whether the institute's plan includes a module (everything is open during the trial, and while it is set up for approval). */
export function planHasModule(plan: OrgPlan, module: string): boolean {
  return plan.status === 'trial' || plan.status === 'pending' || plan.modules.includes(module)
}
export const hasModule = async (tx: Tx, module: string) => planHasModule(await orgPlan(tx), module)

export async function assertModule(tx: Tx, module: string, what: string) {
  const plan = await orgPlan(tx)
  if (!planHasModule(plan, module)) throw new PlanLimitError(`${what} is not part of your ${plan.name} plan.`)
}
