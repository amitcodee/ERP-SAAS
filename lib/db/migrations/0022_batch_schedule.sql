ALTER TABLE "batches" ADD COLUMN "days" integer[];--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "room" text;--> statement-breakpoint
ALTER TABLE batches ADD CONSTRAINT batches_schedule_ck CHECK (
  (days IS NULL AND start_time IS NULL AND end_time IS NULL)
  OR (cardinality(days) BETWEEN 1 AND 7 AND days <@ ARRAY[1,2,3,4,5,6,7] AND start_time IS NOT NULL AND end_time > start_time));
--> statement-breakpoint
-- Timetable for students: a student may now READ the batches they are enrolled in (and their own memberships),
-- nothing else, and still write nothing. Sessions, other batches and other members stay hidden.
DROP POLICY student_deny ON batch_members;
--> statement-breakpoint
DROP POLICY student_deny ON batches;
--> statement-breakpoint
CREATE POLICY student_own ON batch_members AS RESTRICTIVE FOR SELECT USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
CREATE POLICY student_own ON batches AS RESTRICTIVE FOR SELECT USING (app_role() <> 'student' OR id IN (SELECT batch_id FROM batch_members));
--> statement-breakpoint
CREATE POLICY student_no_insert ON batch_members AS RESTRICTIVE FOR INSERT WITH CHECK (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_no_update ON batch_members AS RESTRICTIVE FOR UPDATE USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_no_delete ON batch_members AS RESTRICTIVE FOR DELETE USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_no_insert ON batches AS RESTRICTIVE FOR INSERT WITH CHECK (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_no_update ON batches AS RESTRICTIVE FOR UPDATE USING (app_role() <> 'student');
--> statement-breakpoint
CREATE POLICY student_no_delete ON batches AS RESTRICTIVE FOR DELETE USING (app_role() <> 'student');
