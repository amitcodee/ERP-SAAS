-- Every feature follows permissions, not role names, so head office can build any role on Roles & permissions.
-- New permission areas: teaching (My Classes / Project Help, syllabus approval), helpdesk, template, overdue,
-- branchmail, recycle, and certificate:delete (revoke). The roles that had these features by name get the matching
-- permissions here, so nobody loses anything; super admin has every permission already (kind 'super').

-- does the signed-in person hold this permission (through any of their roles, or the role the session runs as)?
CREATE OR REPLACE FUNCTION app_has_perm(perm text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM roles r
       WHERE (r.key = app_role() OR r.key IN (SELECT ur.role FROM user_roles ur WHERE ur.user_id = app_user()))
         AND (r.kind = 'super' OR perm = ANY (r.permissions))) $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_has_perm(text) TO techcadd_app;--> statement-breakpoint

-- "teaching staff" was anyone who marks attendance; now the teaching:create permission
CREATE OR REPLACE FUNCTION app_can_teach() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT app_has_perm('teaching:create') $$;--> statement-breakpoint
-- the branch's internal tickets were the Branch Manager role's; now whoever runs the help desk (helpdesk:update)
CREATE OR REPLACE FUNCTION app_is_branch_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT app_role() <> 'student' AND app_has_perm('helpdesk:update') $$;--> statement-breakpoint

-- the syllabus: written and approved by whoever holds teaching:approve (head office by default)
DROP POLICY IF EXISTS course_topics_write ON course_topics;--> statement-breakpoint
CREATE POLICY course_topics_write ON course_topics FOR ALL USING (app_is_super() OR app_has_perm('teaching:approve')) WITH CHECK (app_is_super() OR app_has_perm('teaching:approve'));--> statement-breakpoint
DROP POLICY IF EXISTS course_syllabus_files_write ON course_syllabus_files;--> statement-breakpoint
CREATE POLICY course_syllabus_files_write ON course_syllabus_files FOR ALL USING (app_is_super() OR app_has_perm('teaching:approve')) WITH CHECK (app_is_super() OR app_has_perm('teaching:approve'));--> statement-breakpoint
DROP POLICY IF EXISTS syllabus_changes_add ON syllabus_changes;--> statement-breakpoint
CREATE POLICY syllabus_changes_add ON syllabus_changes FOR INSERT WITH CHECK (app_role() <> 'student' AND (app_is_super() OR app_has_perm('teaching:approve') OR proposed_by = app_user()));--> statement-breakpoint
DROP POLICY IF EXISTS syllabus_changes_change ON syllabus_changes;--> statement-breakpoint
CREATE POLICY syllabus_changes_change ON syllabus_changes FOR UPDATE
  USING (app_is_super() OR app_has_perm('teaching:approve') OR (proposed_by = app_user() AND status = 'pending'))
  WITH CHECK (app_is_super() OR app_has_perm('teaching:approve') OR (proposed_by = app_user() AND status IN ('pending', 'withdrawn')));--> statement-breakpoint

-- keep what each role could do
-- trainers and academic managers: My Classes / Project Help and teaching
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['teaching:read', 'teaching:create']) AS x ORDER BY x)
WHERE key IN ('trainer', 'academic_manager');--> statement-breakpoint
-- anyone who marked attendance could teach (tests, topics, notes): keeps that
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY['teaching:create']) AS x ORDER BY x)
WHERE kind = 'staff' AND 'attendance:create' = ANY (permissions);--> statement-breakpoint
-- the branch manager: help desk, message templates, overdue escalations, branch e-mail, adding courses / categories
UPDATE roles SET updated_at = now(), permissions = ARRAY(SELECT DISTINCT x FROM unnest(permissions || ARRAY[
  'helpdesk:read', 'helpdesk:update', 'template:read', 'template:update', 'overdue:read', 'branchmail:update', 'catalog:read', 'catalog:create']) AS x ORDER BY x)
WHERE key = 'branch_manager';
