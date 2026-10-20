-- Three rules the app kept but the database did not:
-- 1. Internal tickets (staff to the branch manager or head office): only the raiser, the assignee, head office and
--    the branch manager (not tickets meant for head office). Their messages follow the ticket. Student tickets: as before.
-- 2. The syllabus: the live topics and file are written by head office only (approving a change writes them);
--    a change is written only by its author, and decided (or turned down) by head office.
-- 3. Notes "shared with trainers": teaching staff only, not every staff login.

CREATE OR REPLACE FUNCTION app_is_branch_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT app_role() = 'branch_manager' OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = app_user() AND role = 'branch_manager') $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_branch_manager() TO techcadd_app;--> statement-breakpoint

-- 1. internal tickets
CREATE POLICY internal_scope ON support_tickets AS RESTRICTIVE FOR ALL
  USING (kind <> 'internal' OR app_is_super() OR created_by = app_user() OR assigned_to = app_user() OR (NOT to_head_office AND app_is_branch_manager()))
  WITH CHECK (kind <> 'internal' OR app_is_super() OR created_by = app_user() OR assigned_to = app_user() OR (NOT to_head_office AND app_is_branch_manager()));--> statement-breakpoint
CREATE POLICY ticket_visible ON support_messages AS RESTRICTIVE FOR ALL USING (ticket_id IN (SELECT id FROM support_tickets)) WITH CHECK (ticket_id IN (SELECT id FROM support_tickets));--> statement-breakpoint

-- 2. the syllabus
DROP POLICY IF EXISTS course_topics_write ON course_topics;--> statement-breakpoint
CREATE POLICY course_topics_write ON course_topics FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
DROP POLICY IF EXISTS course_syllabus_files_write ON course_syllabus_files;--> statement-breakpoint
CREATE POLICY course_syllabus_files_write ON course_syllabus_files FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
DROP POLICY IF EXISTS syllabus_changes_staff ON syllabus_changes;--> statement-breakpoint
CREATE POLICY syllabus_changes_read ON syllabus_changes FOR SELECT USING (app_role() <> 'student');--> statement-breakpoint
CREATE POLICY syllabus_changes_add ON syllabus_changes FOR INSERT WITH CHECK (app_role() <> 'student' AND (app_is_super() OR proposed_by = app_user()));--> statement-breakpoint
CREATE POLICY syllabus_changes_change ON syllabus_changes FOR UPDATE
  USING (app_is_super() OR (proposed_by = app_user() AND status = 'pending'))
  WITH CHECK (app_is_super() OR (proposed_by = app_user() AND status IN ('pending', 'withdrawn')));--> statement-breakpoint

-- 3. notes shared with trainers
DROP POLICY IF EXISTS notes_scope ON notes;--> statement-breakpoint
CREATE POLICY notes_scope ON notes FOR ALL
  USING (app_is_super() OR branch_id = app_branch() OR created_by = app_user() OR batch_id IN (SELECT app_trainer_batches()) OR (share_trainers AND app_can_teach()))
  WITH CHECK (app_is_super() OR created_by = app_user());
