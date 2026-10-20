import { redirect } from 'next/navigation'

// Integrations now live in Settings (connection status, webhooks and API access).
export default function Page() {
  redirect('/settings?tab=integrations')
}
