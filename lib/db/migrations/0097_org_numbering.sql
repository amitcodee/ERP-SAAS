-- Counters that run across a whole organisation (not per branch): support tickets, help requests, event
-- certificates. They were global sequences, so every institute would have shared one series. Now each org counts
-- its own, by kind and period ('ALL', a year, or a financial year; lib/numbering.ts decides from the format).
-- Branch counters (enquiry, registration, receipt, certificate) stay in number_sequences.
CREATE TABLE org_sequences (
	org_id uuid NOT NULL DEFAULT app_org() REFERENCES organisations(id),
	kind text NOT NULL,
	period text NOT NULL,
	last_value integer DEFAULT 0 NOT NULL,
	CONSTRAINT org_sequences_pk PRIMARY KEY (org_id, kind, period)
);
--> statement-breakpoint
ALTER TABLE org_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_sequences_scope ON org_sequences FOR ALL USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY org_guard ON org_sequences AS RESTRICTIVE FOR ALL USING (org_id = app_org()) WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY org_ro_insert ON org_sequences AS RESTRICTIVE FOR INSERT WITH CHECK (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_update ON org_sequences AS RESTRICTIVE FOR UPDATE USING (NOT app_read_only());
--> statement-breakpoint
CREATE POLICY org_ro_delete ON org_sequences AS RESTRICTIVE FOR DELETE USING (NOT app_read_only());
--> statement-breakpoint
REVOKE ALL ON org_sequences FROM techcadd_app;
--> statement-breakpoint

-- The next value of one of the org's counters. The app has no rights on the table: a student opening a ticket mints
-- a number through this function only, and only in the transaction's own org.
CREATE OR REPLACE FUNCTION app_org_seq(p_kind text, p_period text) RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
DECLARE v integer;
BEGIN
  IF app_org() IS NULL THEN RAISE EXCEPTION 'app_org_seq: no organisation in this transaction'; END IF;
  IF app_read_only() THEN RAISE EXCEPTION 'This institute is read-only'; END IF;
  INSERT INTO org_sequences AS s (org_id, kind, period, last_value) VALUES (app_org(), p_kind, p_period, 1)
    ON CONFLICT (org_id, kind, period) DO UPDATE SET last_value = s.last_value + 1
    RETURNING s.last_value INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org_seq(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_seq(text, text) TO techcadd_app;
--> statement-breakpoint

-- Carry on the old series in the Sample Institute (the only org that has numbers so far).
INSERT INTO org_sequences (org_id, kind, period, last_value)
  SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'TKT', 'ALL', last_value FROM support_ticket_seq WHERE is_called
  UNION ALL SELECT '00000000-0000-4000-8000-000000000001', 'HLP', 'ALL', last_value FROM help_request_seq WHERE is_called
  UNION ALL SELECT '00000000-0000-4000-8000-000000000001', 'EVC', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY'), last_value FROM event_cert_seq WHERE is_called;
--> statement-breakpoint
ALTER TABLE support_tickets ALTER COLUMN ticket_no SET DEFAULT ('TKT-' || lpad(app_org_seq('TKT', 'ALL')::text, 5, '0'));
--> statement-breakpoint
ALTER TABLE help_requests ALTER COLUMN request_no SET DEFAULT ('HLP-' || lpad(app_org_seq('HLP', 'ALL')::text, 5, '0'));
--> statement-breakpoint
DROP SEQUENCE support_ticket_seq;
--> statement-breakpoint
DROP SEQUENCE help_request_seq;
--> statement-breakpoint
DROP SEQUENCE event_cert_seq;
