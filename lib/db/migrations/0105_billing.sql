-- Billing (PLAN.md 2.5): what each institute pays the platform. Platform tables: the platform writes them; an institute
-- reads its own (subscription, invoices, payments) for Settings → Plan & billing.

-- The institute's paid period. One row per institute; renewals move the period on.
CREATE TABLE subscriptions (
	org_id uuid PRIMARY KEY REFERENCES organisations(id),
	plan_key text NOT NULL REFERENCES plans(key) ON UPDATE CASCADE,
	interval text NOT NULL,
	status text DEFAULT 'active' NOT NULL,
	current_period_start timestamp with time zone NOT NULL,
	current_period_end timestamp with time zone NOT NULL,
	cancel_at_period_end boolean DEFAULT false NOT NULL,
	reminded_at timestamp with time zone,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	updated_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT subscriptions_interval_ck CHECK (interval IN ('month', 'year')),
	CONSTRAINT subscriptions_status_ck CHECK (status IN ('active', 'cancelled')),
	CONSTRAINT subscriptions_period_ck CHECK (current_period_end > current_period_start)
);
--> statement-breakpoint
-- Discount codes the platform hands out.
CREATE TABLE coupons (
	code text PRIMARY KEY,
	percent_off integer,
	amount_off integer,
	plans text[] DEFAULT '{}' NOT NULL,
	valid_until timestamp with time zone,
	max_redemptions integer,
	redeemed integer DEFAULT 0 NOT NULL,
	is_active boolean DEFAULT true NOT NULL,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT coupons_code_ck CHECK (code = upper(code) AND code ~ '^[A-Z0-9-]{3,30}$'),
	CONSTRAINT coupons_off_ck CHECK ((percent_off IS NULL) <> (amount_off IS NULL) AND coalesce(percent_off, 1) BETWEEN 1 AND 100 AND coalesce(amount_off, 1) > 0)
);
--> statement-breakpoint
-- One attempt to pay: made when the institute starts checkout, paid when the provider confirms (callback or webhook).
CREATE TABLE platform_payments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	org_id uuid NOT NULL REFERENCES organisations(id),
	plan_key text NOT NULL REFERENCES plans(key) ON UPDATE CASCADE,
	interval text NOT NULL,
	coupon text REFERENCES coupons(code),
	amount integer NOT NULL,
	discount integer DEFAULT 0 NOT NULL,
	gst integer NOT NULL,
	total integer NOT NULL,
	provider text NOT NULL,
	provider_ref text,
	provider_payment_id text,
	status text DEFAULT 'created' NOT NULL,
	invoice_id uuid,
	created_by uuid,
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	paid_at timestamp with time zone,
	CONSTRAINT platform_payments_status_ck CHECK (status IN ('created', 'paid', 'failed', 'expired')),
	CONSTRAINT platform_payments_money_ck CHECK (amount >= 0 AND discount >= 0 AND gst >= 0 AND total = amount - discount + gst)
);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_payments_provider_payment_uq ON platform_payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX platform_payments_org_idx ON platform_payments (org_id, created_at);
--> statement-breakpoint
-- The platform's GST tax invoices: one per paid payment, numbered without gaps per financial year (INV/2026-27/00001).
CREATE TABLE platform_invoices (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	org_id uuid NOT NULL REFERENCES organisations(id),
	number text NOT NULL,
	issued_at timestamp with time zone DEFAULT now() NOT NULL,
	period_start timestamp with time zone NOT NULL,
	period_end timestamp with time zone NOT NULL,
	description text NOT NULL,
	amount integer NOT NULL,
	discount integer DEFAULT 0 NOT NULL,
	cgst integer DEFAULT 0 NOT NULL,
	sgst integer DEFAULT 0 NOT NULL,
	igst integer DEFAULT 0 NOT NULL,
	total integer NOT NULL,
	billed_to jsonb NOT NULL,
	seller jsonb NOT NULL,
	payment_id uuid NOT NULL REFERENCES platform_payments(id),
	CONSTRAINT platform_invoices_money_ck CHECK (total = amount - discount + cgst + sgst + igst)
);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_invoices_number_uq ON platform_invoices (number);
--> statement-breakpoint
CREATE UNIQUE INDEX platform_invoices_payment_uq ON platform_invoices (payment_id);
--> statement-breakpoint
CREATE INDEX platform_invoices_org_idx ON platform_invoices (org_id, issued_at);
--> statement-breakpoint
ALTER TABLE platform_payments ADD CONSTRAINT platform_payments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES platform_invoices(id);
--> statement-breakpoint
-- The platform's own counters (invoice numbers per financial year): taken with a row lock, so numbers never gap.
CREATE TABLE platform_counters (
	key text PRIMARY KEY,
	value integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Each provider event handled once (webhooks are retried and may arrive twice).
CREATE TABLE billing_events (
	provider text NOT NULL,
	event_id text NOT NULL,
	type text NOT NULL,
	received_at timestamp with time zone DEFAULT now() NOT NULL,
	payload jsonb NOT NULL,
	CONSTRAINT billing_events_pk PRIMARY KEY (provider, event_id)
);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'coupons', 'platform_payments', 'platform_invoices', 'platform_counters', 'billing_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform())', t || '_platform', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO techcadd_app', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- an institute reads its own billing (head office's Settings → Plan & billing)
CREATE POLICY subscriptions_own ON subscriptions FOR SELECT USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY platform_payments_own ON platform_payments FOR SELECT USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY platform_invoices_own ON platform_invoices FOR SELECT USING (org_id = app_org());
--> statement-breakpoint
-- invoices are never changed once issued
CREATE OR REPLACE FUNCTION platform_invoices_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN RAISE EXCEPTION 'An issued invoice cannot be changed'; END $$;
--> statement-breakpoint
CREATE TRIGGER platform_invoices_immutable BEFORE UPDATE OR DELETE ON platform_invoices FOR EACH ROW EXECUTE FUNCTION platform_invoices_immutable();
