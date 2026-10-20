// Nightly money check (insti.md §10.4). Read-only: it never repairs anything, it only reports.
// Every rule here should be impossible to break through the app; a problem means a bug or a manual DB edit.
import { sql } from 'drizzle-orm'
import type { Tx } from '@/lib/db/withTenant'

export type Problem = { branch: string; check: string; detail: string }
export type ReconcileResult = { branches: number; payments: number; problems: Problem[] }

export async function reconcile(tx: Tx): Promise<ReconcileResult> {
  const rows = async <T>(q: ReturnType<typeof sql>) => (await tx.execute<T & Record<string, unknown>>(q)).rows
  const problems: Problem[] = []
  const add = (branch: string, check: string, detail: string) => problems.push({ branch, check, detail })

  // 1. Payments table and ledger agree, per branch.
  for (const r of await rows<{ code: string; paid: string; ledger: string }>(sql`
    select b.code,
      (select coalesce(sum(p.amount), 0) from payments p where p.branch_id = b.id)::text as paid,
      (select coalesce(-sum(l.amount), 0) from fee_ledger l where l.branch_id = b.id and l.entry_type = 'payment')::text as ledger
    from branches b`)) {
    if (r.paid !== r.ledger) add(r.code, 'payments = ledger', `payments ${r.paid} paise, ledger payment rows ${r.ledger} paise`)
  }

  // 2. Every payment has exactly one ledger row (same amount) and one receipt; no orphan ledger payment rows.
  for (const r of await rows<{ code: string; id: string; issue: string }>(sql`
    select b.code, p.id::text as id, 'payment has no matching ledger row' as issue
      from payments p join branches b on b.id = p.branch_id
      where (select count(*) from fee_ledger l where l.ref_id = p.id and l.entry_type = 'payment' and l.amount = -p.amount) <> 1
    union all
    select b.code, p.id::text, 'payment has no receipt'
      from payments p join branches b on b.id = p.branch_id
      where not exists (select 1 from receipts r where r.payment_id = p.id)
    union all
    select b.code, v.payment_id::text, 'reversed payment has no matching refund ledger row'
      from payment_reversals v join payments p on p.id = v.payment_id join branches b on b.id = v.branch_id
      where (select count(*) from fee_ledger l where l.ref_id = v.payment_id and l.entry_type = 'refund' and l.amount = p.amount) <> 1
    union all
    select b.code, l.id::text, 'ledger payment row has no payment'
      from fee_ledger l join branches b on b.id = l.branch_id
      where l.entry_type = 'payment' and not exists (select 1 from payments p where p.id = l.ref_id)`)) {
    add(r.code, r.issue, r.id)
  }

  // 3. Receipt numbers are gapless: per branch and financial year, count = highest number = sequence counter.
  for (const r of await rows<{ code: string; period: string; n: number; top: number; seq: number | null }>(sql`
    select b.code, x.period, x.n, x.top, s.last_value as seq
    from (
      select branch_id, substring(receipt_no from '(\\d{4}-\\d{2})') as period, count(*)::int as n,
             max(substring(receipt_no from '(\\d+)$')::int) as top
      from receipts group by 1, 2
    ) x
    join branches b on b.id = x.branch_id
    left join number_sequences s on s.branch_id = x.branch_id and s.kind = 'RCP' and s.period = x.period`)) {
    if (r.n !== r.top || r.seq !== r.top) add(r.code, 'receipt numbers gapless', `${r.period}: ${r.n} receipts, highest no. ${r.top}, counter ${r.seq ?? 'missing'}`)
  }

  // 4. The registration's total fee (after discounts) equals the ledger's charges less its discounts.
  for (const r of await rows<{ code: string; reg_no: string; fee: number; charged: string }>(sql`
    select b.code, g.reg_no, g.total_fee as fee,
      (select coalesce(sum(l.amount), 0) from fee_ledger l where l.registration_id = g.id and l.entry_type in ('charge', 'discount'))::text as charged
    from registrations g join branches b on b.id = g.branch_id
    where g.total_fee <> (select coalesce(sum(l.amount), 0) from fee_ledger l where l.registration_id = g.id and l.entry_type in ('charge', 'discount'))`)) {
    add(r.code, 'total fee = charges less discounts', `${r.reg_no}: total fee ${r.fee}, charges less discounts ${r.charged}`)
  }

  // 5. Nobody has paid more than they owe.
  for (const r of await rows<{ code: string; reg_no: string; balance: number }>(sql`
    select b.code, g.reg_no, v.balance from v_fee_balance v
    join registrations g on g.id = v.registration_id join branches b on b.id = g.branch_id where v.balance < 0`)) {
    add(r.code, 'no overpayment', `${r.reg_no}: balance ${r.balance}`)
  }

  const [c] = await rows<{ branches: number; payments: number }>(sql`select (select count(*)::int from branches) as branches, (select count(*)::int from payments) as payments`)
  return { branches: c.branches, payments: c.payments, problems }
}
