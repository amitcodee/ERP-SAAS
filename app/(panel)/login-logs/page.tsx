export const dynamic = 'force-dynamic'
import { LoginSecurityPanel } from '@/components/login-security'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { FREE_TRIES, LADDER, listLoginLog, loginSecurity, STEP } from '@/modules/auth/guard'

// Administration / Sign-in Security (head office): every sign-in attempt with IP, place and device; running locks;
// blocked and trusted IPs.
export default async function Page() {
  const { actor } = await requirePage('Sign-in Security')
  const [log, sec] = await withTenant(actor, async (tx) => [await listLoginLog(tx, actor, {}), await loginSecurity(tx, actor)] as const)
  return <LoginSecurityPanel initial={log} rules={sec.rules} locks={sec.locks} stats={sec.stats} ladder={{ free: FREE_TRIES, step: STEP, waits: [...LADDER] }} />
}
