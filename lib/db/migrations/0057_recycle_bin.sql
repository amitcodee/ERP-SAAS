-- Recycle Bin: more things can be deleted and are kept hidden for 30 days (then removed by the daily "purge" job).
-- Registrations and website leads are hidden by the database (like calls and leads); courses, batches and staff are
-- hidden by the screens, since older records still show their names.
SELECT set_config('app.is_super', 'true', false);
--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE web_leads ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE batches ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);
--> statement-breakpoint
CREATE POLICY not_deleted ON registrations AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR coalesce(current_setting('app.show_deleted', true), '') = 'on');
--> statement-breakpoint
CREATE POLICY not_deleted ON web_leads AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR coalesce(current_setting('app.show_deleted', true), '') = 'on');
--> statement-breakpoint
-- deleting registrations: head office and branch heads (matches DEFAULT_ROLES in lib/auth/permissions.ts)
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['registration:delete']) AS x ORDER BY x)
WHERE key IN ('super_admin', 'branch_manager');
--> statement-breakpoint
-- History stays append-only for the panel. Only the Recycle Bin's permanent delete (the server's owner connection,
-- with app.purging on) may DELETE rows of an item being removed for good; UPDATE stays forbidden for everyone.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN
    IF TG_OP = 'DELETE' AND coalesce(current_setting('app.purging', true), '') = 'on' AND current_user <> 'techcadd_app' THEN RETURN OLD; END IF;
    RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
  END $$;
