-- Fees: branch RLS, append-only ledger/payments/receipts, and the single balance + dues views.
ALTER TABLE fee_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fee_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE installments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fee_ledger_scope ON fee_ledger FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY installments_scope ON installments FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY payments_scope ON payments FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY receipts_scope ON receipts FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON installments TO techcadd_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON fee_ledger TO techcadd_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON fee_ledger FROM techcadd_app;
--> statement-breakpoint
CREATE TRIGGER fee_ledger_immutable BEFORE UPDATE OR DELETE ON fee_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT ON payments TO techcadd_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON payments FROM techcadd_app;
--> statement-breakpoint
CREATE TRIGGER payments_immutable BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
GRANT SELECT, INSERT ON receipts TO techcadd_app;
--> statement-breakpoint
GRANT UPDATE (pdf_object_key) ON receipts TO techcadd_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION receipts_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'receipts cannot be deleted'; END IF;
  IF NEW.receipt_no <> OLD.receipt_no OR NEW.payment_id <> OLD.payment_id OR NEW.branch_id <> OLD.branch_id THEN RAISE EXCEPTION 'receipts are immutable'; END IF;
  RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION receipts_guard();
--> statement-breakpoint
CREATE VIEW v_fee_balance WITH (security_invoker = true) AS
SELECT r.id AS registration_id, r.branch_id,
  COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type = 'charge'), 0)::int AS charged,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'discount'), 0)::int AS discounted,
  COALESCE(-SUM(l.amount) FILTER (WHERE l.entry_type = 'payment'), 0)::int AS paid,
  COALESCE(SUM(l.amount), 0)::int AS balance
FROM registrations r LEFT JOIN fee_ledger l ON l.registration_id = r.id
GROUP BY r.id, r.branch_id;
--> statement-breakpoint
CREATE VIEW v_dues AS
SELECT i.id AS installment_id, i.branch_id, i.registration_id, i.due_date, i.amount,
  GREATEST(CURRENT_DATE - i.due_date, 0) AS days_overdue,
  CASE WHEN i.due_date >= CURRENT_DATE THEN 'upcoming'
       WHEN CURRENT_DATE - i.due_date <= 15 THEN '0-15'
       WHEN CURRENT_DATE - i.due_date <= 30 THEN '16-30'
       ELSE '30+' END AS bucket
FROM installments i WHERE i.status = 'scheduled';
--> statement-breakpoint
ALTER VIEW v_dues SET (security_invoker = true);
--> statement-breakpoint
GRANT SELECT ON v_fee_balance, v_dues TO techcadd_app;
