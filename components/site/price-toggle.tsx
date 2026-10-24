'use client'
// Pricing: the plans with a Monthly / Yearly switch (yearly is shown as its monthly equivalent, with the year's price).
import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'

export type PricePlan = { key: string; name: string; description: string; monthly: number; yearly: number; custom: boolean; lines: string[] }

const inr = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN')

export function PriceToggle({ plans, popular }: { plans: PricePlan[]; popular: string }) {
  const [yearly, setYearly] = useState(false)
  const anyYearly = plans.some((p) => p.yearly > 0)
  return (
    <>
      {anyYearly && (
        <div className="sx-switch" role="radiogroup" aria-label="Billing">
          <button type="button" role="radio" aria-checked={!yearly} className={!yearly ? 'on' : ''} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" role="radio" aria-checked={yearly} className={yearly ? 'on' : ''} onClick={() => setYearly(true)}>Yearly <em>2 months free</em></button>
        </div>
      )}
      <div className="site-plans">
        {plans.map((p) => {
          const year = yearly && p.yearly > 0
          return (
            <div key={p.key} className={`site-plan${p.key === popular ? ' pop' : ''}`}>
              {p.key === popular && <span className="sx-popular">Most popular</span>}
              <h3>{p.name}</h3>
              <div className="price">{p.custom ? 'Talk to us' : p.monthly === 0 ? 'Free' : <>{inr(year ? p.yearly / 12 : p.monthly)}<small> / month</small></>}</div>
              <small style={{ color: 'var(--muted)', minHeight: 20 }}>{p.custom || p.monthly === 0 ? ' ' : year ? `${inr(p.yearly)} billed yearly` : p.yearly > 0 ? `or ${inr(p.yearly)} a year` : 'billed monthly'}</small>
              <p style={{ margin: 0, color: 'var(--text)' }}>{p.description}</p>
              <Link href={p.custom ? '/contact' : `/signup?plan=${p.key}`} className={`lp-btn ${p.key === popular ? 'sx-btn-green' : 'sx-btn-line'}`}>{p.custom ? 'Contact sales' : 'Start free trial'}</Link>
              <ul>{p.lines.map((l) => <li key={l}><Check size={15} />{l}</li>)}</ul>
            </div>
          )
        })}
      </div>
    </>
  )
}
