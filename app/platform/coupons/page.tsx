import { CouponForm, CouponToggle } from '@/components/platform-console'
import { requirePlatform } from '@/lib/platform/current'
import { listAllPlans, listCoupons } from '@/modules/platform/console'

// Codes institutes type at checkout: a percentage or an amount off, for some plans, until a date or a number of uses.
export default async function Page() {
  await requirePlatform()
  const [coupons, plans] = await Promise.all([listCoupons(), listAllPlans()])
  return (
    <section className="page-container">
      <div className="page-heading"><div><p className="eyebrow">Platform</p><h1>Codes</h1></div></div>
      <CouponForm plans={plans.filter((p) => p.price_monthly > 0).map((p) => p.key)} />
      <div className="panel table-scroll"><table>
        <thead><tr><th>Code</th><th>Off</th><th>Plans</th><th>Until</th><th>Used</th><th>Status</th><th /></tr></thead>
        <tbody>
          {coupons.map((c) => <tr key={c.code}><td><strong>{c.code}</strong></td><td>{c.percent_off ? `${c.percent_off}%` : `₹${(c.amount_off ?? 0) / 100}`}</td><td>{c.plans.join(', ') || 'all'}</td><td>{c.valid_until ? new Date(c.valid_until).toLocaleDateString('en-IN') : '—'}</td><td>{c.redeemed}{c.max_redemptions ? ` of ${c.max_redemptions}` : ''}</td><td>{c.is_active ? 'on' : 'off'}</td><td><CouponToggle code={c.code} active={c.is_active} /></td></tr>)}
          {!coupons.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#8b98aa' }}>No codes yet.</td></tr>}
        </tbody>
      </table></div>
    </section>
  )
}
