-- Correcting a payment. Payments, receipts and the ledger can never be edited or deleted, so a wrong payment is
-- REVERSED: one reversal row (why, who, when; once per payment, never edited) and one REFUND ledger row that puts the
-- amount back on the balance. The receipt stays, shown as CANCELLED. Two kinds: a wrong entry (the money never came,
-- or it was entered twice) and a refund (money given back to the student).
-- Collections, graphs and the calendar count only payments that stand (v_live_payments).
CREATE TABLE payment_reversals (
	payment_id uuid PRIMARY KEY REFERENCES payments(id),
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid NOT NULL REFERENCES registrations(id),
	kind text NOT NULL,
	reason text NOT NULL,
	refund_mode text,
	refund_ref text,
	reversed_by uuid REFERENCES users(id),
	reversed_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT payment_reversals_kind_ck CHECK (kind IN ('wrong_entry', 'refund'))
);--> statement-breakpoint
CREATE INDEX payment_reversals_reg_idx ON payment_reversals (registration_id);--> statement-breakpoint
CREATE TRIGGER payment_reversals_immutable BEFORE UPDATE OR DELETE ON payment_reversals FOR EACH ROW EXECUTE FUNCTION forbid_mutation();--> statement-breakpoint
ALTER TABLE payment_reversals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE payment_reversals FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY payment_reversals_scope ON payment_reversals FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_own ON payment_reversals AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations)) WITH CHECK (app_role() <> 'student');--> statement-breakpoint
GRANT SELECT, INSERT ON payment_reversals TO techcadd_app;--> statement-breakpoint
-- "Paid" is what was paid and still stands: a reversed payment's REFUND row takes it off again.
CREATE OR REPLACE VIEW v_fee_balance WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id,
  COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'charge'), 0)::int AS charged,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'discount'), 0)::int AS discounted,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type IN ('payment', 'adjustment', 'refund')), 0)::int AS paid,
  COALESCE(SUM(l.amount), 0)::int AS balance
FROM registrations r LEFT JOIN fee_ledger l ON l.registration_id = r.id
GROUP BY r.id, r.branch_id;--> statement-breakpoint
CREATE VIEW v_live_payments WITH (security_invoker = true) AS
SELECT p.* FROM payments p WHERE NOT EXISTS (SELECT 1 FROM payment_reversals v WHERE v.payment_id = p.id);--> statement-breakpoint
GRANT SELECT ON v_live_payments TO techcadd_app;--> statement-breakpoint
-- money is never zero or negative (new rows; NOT VALID leaves any old row alone)
ALTER TABLE payments ADD CONSTRAINT payments_amount_pos CHECK (amount > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE installments ADD CONSTRAINT installments_amount_pos CHECK (amount > 0) NOT VALID;--> statement-breakpoint
ALTER TABLE fee_ledger ADD CONSTRAINT fee_ledger_amount_nonzero CHECK (amount <> 0) NOT VALID;
