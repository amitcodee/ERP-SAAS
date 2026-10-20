import { requireRequestOrg } from '@/lib/tenant/request'
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'
import { checkResetToken } from '@/modules/auth/reset'
import { ResetForm } from './reset-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reset password | techcadd', referrer: 'no-referrer' as const }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams
  const valid = await checkResetToken((await requireRequestOrg()).id, token)
  return (
    <AuthShell tagline="Choose a new password for your account.">
      {valid ? (
        <ResetForm token={token} />
      ) : (
        <div className="login-form">
          <h1>Link Expired</h1>
          <p className="login-sub">This reset link is no longer valid. It may have expired or already been used.</p>
          <Link href="/login/forgot" className="login-submit">Request a New Link</Link>
          <Link href="/login" className="login-back">Back to Sign In</Link>
        </div>
      )}
    </AuthShell>
  )
}
