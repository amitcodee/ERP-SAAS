export const dynamic = 'force-dynamic'
import { MessageTemplatesPanel } from '@/components/message-templates-panel'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'
import { templatesForEditor } from '@/modules/templates/service'

// The words of the birthday e-mail and card, the help desk and trainer e-mails, and ready-made announcements.
// Head office with no branch picked edits the default for every branch; inside a branch, that branch's own version.
export default async function Page() {
  const { actor, isSuper, user } = await requirePage('Message Templates')
  const data = await withTenant(actor, (tx) => templatesForEditor(tx, actor))
  return <MessageTemplatesPanel data={data} branchName={user.branchName} isSuper={isSuper} />
}
