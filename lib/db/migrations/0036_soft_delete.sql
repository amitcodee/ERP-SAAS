-- Deleting a random call or a lead hides it everywhere but keeps the row (and its history) with who deleted it.
ALTER TABLE "calls" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hidden by the database itself, so every list, count and report leaves deleted rows out without knowing about them.
-- app.show_deleted is switched on only for the moment of deleting (the updated row must still be visible to its own update).
CREATE POLICY not_deleted ON calls AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR coalesce(current_setting('app.show_deleted', true), '') = 'on');
--> statement-breakpoint
CREATE POLICY not_deleted ON enquiries AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL OR coalesce(current_setting('app.show_deleted', true), '') = 'on');
--> statement-breakpoint
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
-- Head office and branch heads may delete (matches DEFAULT_ROLES in lib/auth/permissions.ts); other roles get it on the Roles screen.
UPDATE roles SET updated_at = now(), permissions = ARRAY(
  SELECT DISTINCT x FROM unnest(permissions || ARRAY['call:delete', 'enquiry:delete']) AS x ORDER BY x)
WHERE key IN ('super_admin', 'branch_manager');
