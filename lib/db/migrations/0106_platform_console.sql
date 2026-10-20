-- The platform console, the rest of it (PLAN.md 2.6): notices the platform shows to institutes, and the health of
-- every institute's daily jobs (counts only).
CREATE TABLE platform_announcements (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	title text NOT NULL,
	body text NOT NULL,
	tone text DEFAULT 'info' NOT NULL,
	plans text[] DEFAULT '{}' NOT NULL,
	starts_at timestamp with time zone DEFAULT now() NOT NULL,
	ends_at timestamp with time zone,
	created_by uuid REFERENCES platform_users(id),
	created_at timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT platform_announcements_tone_ck CHECK (tone IN ('info', 'warning')),
	CONSTRAINT platform_announcements_period_ck CHECK (ends_at IS NULL OR ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX platform_announcements_live_idx ON platform_announcements (starts_at, ends_at);
--> statement-breakpoint
ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_announcements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_announcements_platform ON platform_announcements FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
--> statement-breakpoint
-- an institute reads the notices meant for it while they run (all plans, or its own)
CREATE POLICY platform_announcements_read ON platform_announcements FOR SELECT USING (
  app_org() IS NOT NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
  AND (plans = '{}' OR (SELECT o.plan_key FROM organisations o WHERE o.id = app_org()) = ANY (plans)));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON platform_announcements TO techcadd_app; -- ended by setting ends_at, never deleted
--> statement-breakpoint
-- Each institute's daily jobs over the last week: how many ran and failed, and the last failure. Platform only.
CREATE OR REPLACE FUNCTION platform_job_health()
  RETURNS TABLE (org_id uuid, job text, runs integer, failed integer, last_error text, last_failed timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF NOT app_is_platform() THEN RAISE EXCEPTION 'platform_job_health: platform only'; END IF;
  RETURN QUERY SELECT j.org_id, j.job, count(*)::int, count(*) FILTER (WHERE j.ok = false)::int,
    (array_agg(j.error ORDER BY j.started_at DESC) FILTER (WHERE j.ok = false))[1],
    max(j.started_at) FILTER (WHERE j.ok = false)
  FROM job_runs j WHERE j.started_at > now() - interval '7 days' GROUP BY j.org_id, j.job;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_job_health() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_job_health() TO techcadd_app;
