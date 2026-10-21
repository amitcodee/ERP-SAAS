import { inr } from '@/lib/money'
import { verifyReceipt } from '@/modules/fees/service'
import { requireRequestOrg } from '@/lib/tenant/request'
import { orgBrand } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Receipt verification' }

// Public. Confirms a receipt is genuine without revealing who paid.
export default async function VerifyReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const org = await requireRequestOrg()
  const v = await verifyReceipt(org.id, decodeURIComponent(token))
  const brand = await orgBrand(org.id)
  return (
    <main style={{ minHeight: '100vh', background: '#f5f7fa', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '12vh auto', padding: 28, background: '#fff', borderRadius: 14, boxShadow: '0 24px 70px #17203320' }}>
        <p style={{ fontSize: 11, letterSpacing: '.08em', color: '#64748b', margin: 0 }}>{brand.name} · RECEIPT VERIFICATION</p>
        {!v.valid ? (
          <>
            <h1 style={{ color: '#b91c1c', fontSize: 22 }}>Not genuine</h1>
            <p style={{ color: '#475569' }}>This code does not match any receipt issued by {brand.name}.</p>
          </>
        ) : (
          <>
            {v.cancelled
              ? <><h1 style={{ color: '#b45309', fontSize: 22 }}>Genuine receipt, but cancelled</h1><p style={{ color: '#475569' }}>{brand.name} issued this receipt, but the payment was later reversed (a wrong entry or a refund). It no longer counts as a payment.</p></>
              : <h1 style={{ color: '#15803d', fontSize: 22 }}>Genuine receipt</h1>}
            <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 12px', fontSize: 14, color: '#1e293b' }}>
              <dt style={{ color: '#64748b' }}>Receipt no.</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v.receiptNo}</dd>
              <dt style={{ color: '#64748b' }}>Amount</dt><dd style={{ margin: 0 }}>{inr(v.amount)}</dd>
              <dt style={{ color: '#64748b' }}>Date</dt><dd style={{ margin: 0 }}>{new Date(v.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
              <dt style={{ color: '#64748b' }}>Mode</dt><dd style={{ margin: 0 }}>{v.mode}</dd>
              <dt style={{ color: '#64748b' }}>Branch</dt><dd style={{ margin: 0 }}>{v.branch}</dd>
            </dl>
          </>
        )}
      </div>
    </main>
  )
}
