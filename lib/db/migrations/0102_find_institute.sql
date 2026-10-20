-- "Find my institute" (the public site): which open institutes have an active login with this e-mail. The platform
-- cannot read users itself; this returns only the institutes' ids, and only to the platform context.
CREATE OR REPLACE FUNCTION platform_orgs_for_email(p_email text) RETURNS TABLE (org_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'pg_temp' AS $$
BEGIN
  IF NOT app_is_platform() THEN RAISE EXCEPTION 'platform_orgs_for_email: platform only'; END IF;
  RETURN QUERY SELECT DISTINCT u.org_id FROM users u JOIN organisations o ON o.id = u.org_id
    WHERE lower(u.email) = lower(p_email) AND u.is_active AND u.deleted_at IS NULL AND o.status NOT IN ('suspended', 'cancelled');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_orgs_for_email(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_orgs_for_email(text) TO techcadd_app;
