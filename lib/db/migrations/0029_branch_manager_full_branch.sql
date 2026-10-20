-- Branch Manager = everything a super admin can do, inside their own branch (matches DEFAULT_ROLES in lib/auth/permissions.ts).
-- Adds the day-to-day permissions the role did not have; anything already ticked on the Roles & permissions screen is kept.
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:create', 'attendance:create', 'assessment:create', 'assessment:update']) AS x ORDER BY x)
WHERE key = 'branch_manager';
