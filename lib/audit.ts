import { auditLogs } from './db/schema'
import type { Actor, Tx } from './db/withTenant'

export async function audit(
  tx: Tx,
  actor: Pick<Actor, 'userId' | 'branchId'> & { role?: unknown }, // the org is stamped by the database (org_id DEFAULT app_org())
  a: { action: string; entity: string; entityId?: string; before?: unknown; after?: unknown; ip?: string },
) {
  await tx.insert(auditLogs).values({
    userId: actor.userId,
    branchId: actor.branchId,
    action: a.action,
    entity: a.entity,
    entityId: a.entityId,
    before: a.before as never,
    after: a.after as never,
    ip: a.ip,
  })
}
