-- Bringing over the old system (techcadd.com: <branch>_registration and fee tables) without losing anything:
-- 1. registrations.legacy_data: the student's whole old row as it was (minus the plain-text password and photo
--    path), so every old field stays readable even where it has no place in the new system.
-- 2. legacy_payments: each payment made in the old system — date, amount, mode, its old receipt and book number —
--    as history. The money itself reaches the balance through one ledger 'adjustment' per payment (note names the
--    old receipt), so the new receipt series stays gapless and the money check stays clean. Never changed afterwards.

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS legacy_data jsonb;--> statement-breakpoint

CREATE TABLE legacy_payments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid NOT NULL REFERENCES registrations(id),
	paid_on date NOT NULL,
	amount bigint NOT NULL, -- paise
	mode text, -- as the old system wrote it: Cash, G-Pay, Paytm, Phone-Pay, chq, DDNo ...
	receipt_no text, -- the old receipt, e.g. TCD/17266
	book_no text,
	note text,
	old_id text, -- the old fee table's id: re-running the import never adds a payment twice
	raw jsonb, -- the old row as it was
	imported_by uuid REFERENCES users(id),
	imported_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT legacy_payments_amount_ck CHECK (amount > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX legacy_payments_old_uq ON legacy_payments (branch_id, old_id) WHERE old_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX legacy_payments_reg_idx ON legacy_payments (registration_id, paid_on);--> statement-breakpoint
ALTER TABLE legacy_payments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE legacy_payments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY legacy_payments_scope ON legacy_payments FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());--> statement-breakpoint
CREATE POLICY student_own ON legacy_payments AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));--> statement-breakpoint
CREATE POLICY own_only ON legacy_payments AS RESTRICTIVE FOR SELECT USING (NOT app_own_only() OR registration_id IN (SELECT app_own_students()));--> statement-breakpoint
GRANT SELECT, INSERT ON legacy_payments TO techcadd_app;
