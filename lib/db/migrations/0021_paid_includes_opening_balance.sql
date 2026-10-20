-- "Paid" now includes money paid before migration (imported as ADJUSTMENT rows, insti.md §11.5), so an imported
-- student shows what they actually paid. Balance is unchanged (it was always the sum of every row).
CREATE OR REPLACE VIEW v_fee_balance WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id,
  COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'charge'), 0)::int AS charged,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'discount'), 0)::int AS discounted,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type IN ('payment', 'adjustment')), 0)::int AS paid,
  COALESCE(SUM(l.amount), 0)::int AS balance
FROM registrations r LEFT JOIN fee_ledger l ON l.registration_id = r.id
GROUP BY r.id, r.branch_id;
