-- Who made each login: a branch may change (roles, password, active, delete) only the logins made in the branch.
-- Those made by head office, including the ones it made while setting the branch up, stay head office's.
-- Existing logins are marked from the activity log; any not found there count as head office's.
SELECT set_config('app.is_super', 'true', false);
--> statement-breakpoint
ALTER TABLE users ADD COLUMN branch_made boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE users u SET branch_made = true
FROM (
  SELECT DISTINCT ON (entity_id) entity_id, user_id FROM audit_logs
  WHERE entity = 'user' AND action IN ('create', 'create_student_login') AND user_id IS NOT NULL
  ORDER BY entity_id, at
) a
WHERE a.entity_id = u.id::text
  AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = a.user_id AND r.role = 'super_admin');
