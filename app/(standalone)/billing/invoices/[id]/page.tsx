export const dynamic = 'force-dynamic'
import { sql } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { PrintButton } from '@/components/print-button'
import { requirePage } from '@/lib/panel/base'
import { withTenant } from '@/lib/db/withTenant'

const inr = (paise: number) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

type Inv = { number: string; issued_at: string; period_start: string; period_end: string; description: string; amount: number; discount: number; cgst: number; sgst: number; igst: number; total: number
  billed_to: { name: string; gstin: string | null; address: string | null; email: string | null }; seller: { name: string; gstin: string | null; address: string | null; state: string | null } }

// The platform's GST tax invoice for one payment, to print or save as PDF. Head office of the institute it is for only
// (the database shows an institute its own invoices and nothing else).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const b = await requirePage('Settings')
  if (!b.isSuper) notFound()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const [i] = await withTenant(b.actor, async (tx) => (await tx.execute<Inv>(sql`select * from platform_invoices where id = ${id}`)).rows)
  if (!i) notFound()
  const taxable = i.amount - i.discount
  return (
    <main style={{ background: '#e5e7eb', minHeight: '100vh', padding: '20px 12px', display: 'grid', justifyItems: 'center', gap: 16, fontFamily: 'system-ui, sans-serif', color: '#111827' }}>
      <style>{`@page { size: A4; margin: 14mm } @media print { main { background: #fff !important; padding: 0 !important } .no-print { display: none !important } .inv { box-shadow: none !important } }
        .inv { width: 210mm; max-width: 100%; background: #fff; box-shadow: 0 10px 40px #0003; padding: 14mm; box-sizing: border-box; font-size: 13px }
        .inv table { width: 100%; border-collapse: collapse } .inv td, .inv th { padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: left } .inv .r { text-align: right }`}</style>
      <div className="no-print"><PrintButton label="Print / save as PDF" /></div>
      <div className="inv">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div><strong style={{ fontSize: 18 }}>{i.seller.name}</strong>{i.seller.address && <div>{i.seller.address}</div>}<div>GSTIN: {i.seller.gstin ?? 'to be added'}</div></div>
          <div style={{ textAlign: 'right' }}><strong style={{ fontSize: 18 }}>TAX INVOICE</strong><div>No. {i.number}</div><div>Date: {day(i.issued_at)}</div></div>
        </div>
        <hr style={{ margin: '16px 0', border: 0, borderTop: '1px solid #e5e7eb' }} />
        <div><strong>Billed to</strong><div>{i.billed_to.name}</div>{i.billed_to.address && <div>{i.billed_to.address}</div>}{i.billed_to.gstin && <div>GSTIN: {i.billed_to.gstin}</div>}{i.billed_to.email && <div>{i.billed_to.email}</div>}</div>
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Description</th><th>Period</th><th className="r">Amount</th></tr></thead>
          <tbody>
            <tr><td>{i.description}</td><td>{day(i.period_start)} to {day(i.period_end)}</td><td className="r">{inr(i.amount)}</td></tr>
            {i.discount > 0 && <tr><td colSpan={2}>Less: discount and credit</td><td className="r">− {inr(i.discount)}</td></tr>}
            <tr><td colSpan={2}>Taxable value</td><td className="r">{inr(taxable)}</td></tr>
            {i.igst > 0 ? <tr><td colSpan={2}>IGST 18%</td><td className="r">{inr(i.igst)}</td></tr> : <>
              <tr><td colSpan={2}>CGST 9%</td><td className="r">{inr(i.cgst)}</td></tr>
              <tr><td colSpan={2}>SGST 9%</td><td className="r">{inr(i.sgst)}</td></tr>
            </>}
            <tr><td colSpan={2}><strong>Total</strong></td><td className="r"><strong>{inr(i.total)}</strong></td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 20, color: '#6b7280' }}>Paid in full. This is a computer-generated invoice.</p>
      </div>
    </main>
  )
}
