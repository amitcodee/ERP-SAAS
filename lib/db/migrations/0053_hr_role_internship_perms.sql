-- HR role and the Internship letters permission (matches DEFAULT_ROLES in lib/auth/permissions.ts).
-- Course and project certificates are issued by branch heads, accountants and head office; internship letters by
-- branch heads, HR and head office. Those who could request certificates or add interns before still can.
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['internship:read', 'internship:create', 'internship:approve']) AS x ORDER BY x)
WHERE key IN ('super_admin', 'branch_manager');
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['certificate:approve']) AS x ORDER BY x),
  description = 'Fees, payments and receipts; clears fees and issues course and project certificates.'
WHERE key = 'accountant';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(array_remove(permissions, 'certificate:approve') || ARRAY['internship:read', 'internship:create']) AS x ORDER BY x),
  description = CASE key WHEN 'counselor' THEN 'Enquiries and admissions; requests certificates and internship letters.' ELSE 'Courses, batches, trainers, attendance, grades; requests certificates.' END
WHERE key IN ('academic_manager', 'counselor');
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['internship:read', 'internship:create']) AS x ORDER BY x)
WHERE key = 'helpdesk';
--> statement-breakpoint
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['internship:read']) AS x ORDER BY x)
WHERE key IN ('trainer', 'support');
--> statement-breakpoint
INSERT INTO roles (key, name, description, kind, locked, permissions, is_system) VALUES
  ('hr', 'HR', 'Interns: adds them and issues internship selection letters and completion certificates.', 'staff', false,
   ARRAY['catalog:read', 'internship:approve', 'internship:create', 'internship:read', 'registration:read']::text[], true)
ON CONFLICT (key) DO NOTHING;
