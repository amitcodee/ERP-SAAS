-- Fees: "Change total fees / payment plan" (fee:update) is its own tick, apart from taking payments (fee:create).
-- Everyone who could change fees before (they held fee:create) keeps it; counselors get it (with fee:read), so
-- admissions can fix a student's total and plan without being able to record money. Matches DEFAULT_ROLES.
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:update']) AS x ORDER BY x)
WHERE 'fee:create' = ANY (permissions) OR kind = 'super';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['fee:read', 'fee:update']) AS x ORDER BY x),
  description = 'Enquiries and admissions; changes total fees and payment plans; requests certificates and internship letters.'
WHERE key = 'counselor';
