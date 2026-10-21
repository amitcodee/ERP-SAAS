-- Students paying their fees online through the institute's own Razorpay account (modules/fees/online.ts): one row
-- per payment page opened. The payment itself is recorded by the same path a payment at the desk takes.
CREATE TABLE fee_payment_links (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	branch_id uuid NOT NULL REFERENCES branches(id),
	registration_id uuid NOT NULL REFERENCES registrations(id),
	amount integer NOT NULL,
	provider text NOT NULL,
	provider_link_id text,
	url text,
	status text DEFAULT 'pending' NOT NULL,
	provider_payment_id text,
	payment_id uuid,
	note text,
	created_by uuid REFERENCES users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	paid_at timestamp with time zone,
	CONSTRAINT fee_payment_links_status_ck CHECK (status IN ('pending', 'paid', 'review', 'expired')),
	CONSTRAINT fee_payment_links_amount_ck CHECK (amount > 0)
);
--> statement-breakpoint
CREATE INDEX fee_payment_links_reg_idx ON fee_payment_links (registration_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX fee_payment_links_provider_payment_uq ON fee_payment_links (org_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE fee_payment_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE fee_payment_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- staff see their branch's (head office every branch's); a student only their own registrations'
CREATE POLICY fee_payment_links_scope ON fee_payment_links FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY student_own ON fee_payment_links AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY org_guard ON fee_payment_links AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON fee_payment_links AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON fee_payment_links AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON fee_payment_links AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON fee_payment_links TO techcadd_app;
