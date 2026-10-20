ALTER TABLE "branches" ADD COLUMN "status" text DEFAULT 'setup' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_status_ck CHECK (status IN ('setup', 'active'));
--> statement-breakpoint
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
-- Branches already in use stay usable. Only branches nobody works in yet (e.g. the 7 city branches created with just a
-- name) start in setup and must be completed: details, a counselor and an accountant, then activated.
UPDATE branches b SET status = 'active', activated_at = now()
WHERE EXISTS (SELECT 1 FROM users u WHERE u.branch_id = b.id AND u.deleted_at IS NULL);
--> statement-breakpoint
-- Anyone who has ever signed in counts as having received their login.
UPDATE users u SET last_login_at = (SELECT max(a.at) FROM audit_logs a WHERE a.user_id = u.id AND a.action = 'login');
