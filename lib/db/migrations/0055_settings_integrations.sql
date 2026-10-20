-- Settings set from the panel (head office only): e-mail server, WhatsApp, SMS, reminders and daily job times.
-- Passwords and tokens are kept encrypted (lib/secret-box.ts) in `secrets`; `config` holds the rest.
CREATE TABLE app_config (
	key text PRIMARY KEY,
	config jsonb NOT NULL DEFAULT '{}'::jsonb,
	secrets text,
	updated_by uuid REFERENCES users(id),
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Read-only API keys for business tools (Power BI, Excel, n8n...). Only a hash of the key is kept.
CREATE TABLE api_keys (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name text NOT NULL,
	prefix text NOT NULL, -- the first characters, to recognise a key
	key_hash text NOT NULL UNIQUE, -- sha256 of the whole key
	scopes text[] NOT NULL,
	branch_id uuid REFERENCES branches(id), -- null = every branch
	created_by uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz,
	last_used_at timestamptz,
	last_used_ip text,
	use_count integer NOT NULL DEFAULT 0,
	revoked_at timestamptz
);
--> statement-breakpoint
-- Outgoing webhooks (n8n, Zapier, Make...): events are queued in the same transaction as the change, then delivered.
CREATE TABLE webhooks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name text NOT NULL,
	url text NOT NULL,
	secret text NOT NULL, -- encrypted signing secret
	events text[] NOT NULL,
	is_active boolean NOT NULL DEFAULT true,
	created_by uuid REFERENCES users(id),
	created_at timestamptz NOT NULL DEFAULT now(),
	last_status integer,
	last_delivery_at timestamptz,
	last_error text
);
--> statement-breakpoint
CREATE TABLE webhook_deliveries (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
	event text NOT NULL,
	payload jsonb NOT NULL,
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
	attempts integer NOT NULL DEFAULT 0,
	next_attempt_at timestamptz NOT NULL DEFAULT now(),
	response_status integer,
	response_body text,
	error text,
	created_at timestamptz NOT NULL DEFAULT now(),
	sent_at timestamptz
);
--> statement-breakpoint
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries (webhook_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_config FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_config_head_office ON app_config FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY api_keys_head_office ON api_keys FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY webhooks_head_office ON webhooks FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
CREATE POLICY webhook_deliveries_head_office ON webhook_deliveries FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app_config, api_keys, webhooks, webhook_deliveries TO techcadd_app;
--> statement-breakpoint
-- Called inside any branch's transaction: queues the event for every active webhook that wants it.
CREATE OR REPLACE FUNCTION emit_event(p_event text, p_payload jsonb) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS
  $$ INSERT INTO webhook_deliveries (webhook_id, event, payload)
     SELECT w.id, p_event, p_payload FROM webhooks w WHERE w.is_active AND (p_event = ANY (w.events) OR '*' = ANY (w.events)) $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION emit_event(text, jsonb) TO techcadd_app;
