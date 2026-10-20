-- Roles become data (edited on the Roles & permissions screen). Seeded from DEFAULT_ROLES in lib/auth/permissions.ts.
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'staff' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT roles_kind_ck CHECK (kind IN ('super', 'staff', 'student')),
	CONSTRAINT roles_key_ck CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
INSERT INTO roles (key, name, description, kind, locked, permissions, is_system) VALUES
  ('super_admin', 'Super Admin', 'Head office. Everything, in every branch.', 'super', true, ARRAY['branch:read', 'branch:create', 'branch:update', 'branch:delete', 'user:read', 'user:create', 'user:update', 'role:read', 'role:update', 'catalog:read', 'catalog:create', 'catalog:update', 'setting:read', 'setting:update', 'call:read', 'call:create', 'call:update', 'enquiry:read', 'enquiry:create', 'enquiry:update', 'enquiry:approve', 'lead:read', 'lead:assign', 'registration:read', 'registration:create', 'registration:update', 'registration:approve', 'fee:read', 'fee:create', 'fee:approve', 'receipt:read', 'batch:read', 'batch:create', 'batch:update', 'attendance:read', 'attendance:create', 'assessment:read', 'assessment:create', 'assessment:update', 'certificate:read', 'certificate:create', 'certificate:clear', 'certificate:approve', 'report:read', 'audit:read']::text[], true),
  ('branch_manager', 'Branch Manager', 'Branch head: runs the whole branch, its staff and approvals.', 'staff', false, ARRAY['user:read', 'user:create', 'user:update', 'catalog:read', 'setting:read', 'call:read', 'call:create', 'call:update', 'enquiry:read', 'enquiry:create', 'enquiry:update', 'enquiry:approve', 'lead:read', 'lead:assign', 'registration:read', 'registration:create', 'registration:update', 'registration:approve', 'fee:read', 'fee:approve', 'receipt:read', 'batch:read', 'batch:create', 'batch:update', 'attendance:read', 'assessment:read', 'certificate:read', 'certificate:create', 'certificate:clear', 'certificate:approve', 'report:read', 'audit:read']::text[], true),
  ('academic_manager', 'Academic Manager', 'Courses, batches, timetable, trainers, attendance, grades and certificates.', 'staff', false, ARRAY['catalog:read', 'catalog:create', 'catalog:update', 'registration:read', 'batch:read', 'batch:create', 'batch:update', 'attendance:read', 'attendance:create', 'assessment:read', 'assessment:create', 'assessment:update', 'certificate:read', 'certificate:create', 'certificate:approve', 'report:read']::text[], true),
  ('counselor', 'Counselor', 'Enquiries and admissions; issues the digital certificate once accounts has cleared the fees.', 'staff', false, ARRAY['catalog:read', 'call:read', 'call:create', 'call:update', 'enquiry:read', 'enquiry:create', 'enquiry:update', 'registration:read', 'registration:create', 'registration:update', 'batch:read', 'attendance:read', 'certificate:read', 'certificate:create', 'certificate:approve']::text[], true),
  ('telecaller', 'Telecaller', 'Calls the leads assigned to them (from any branch) and records the outcome.', 'staff', false, ARRAY['catalog:read', 'call:read', 'call:create', 'call:update', 'enquiry:read', 'enquiry:create', 'enquiry:update', 'lead:read']::text[], true),
  ('accountant', 'Accountant', 'Fees, payments and receipts; clears fees before a certificate can be issued.', 'staff', false, ARRAY['catalog:read', 'enquiry:read', 'registration:read', 'fee:read', 'fee:create', 'receipt:read', 'certificate:read', 'certificate:clear', 'report:read']::text[], true),
  ('trainer', 'Trainer', 'Their own batches: attendance, grades and capstone sign-off.', 'staff', false, ARRAY['catalog:read', 'registration:read', 'batch:read', 'attendance:read', 'attendance:create', 'assessment:read', 'assessment:create', 'assessment:update', 'certificate:read']::text[], true),
  ('support', 'Support Team', 'Read-only view of students, fees, receipts and certificates to answer questions.', 'staff', false, ARRAY['catalog:read', 'enquiry:read', 'registration:read', 'fee:read', 'receipt:read', 'batch:read', 'attendance:read', 'certificate:read']::text[], true),
  ('helpdesk', 'Student Help Desk', 'Helps enrolled students: their fees, receipts, attendance and certificate requests.', 'staff', false, ARRAY['catalog:read', 'registration:read', 'fee:read', 'receipt:read', 'batch:read', 'attendance:read', 'certificate:read', 'certificate:create']::text[], true),
  ('front_desk', 'Front Desk', 'Walk-ins: logs calls and enquiries.', 'staff', false, ARRAY['catalog:read', 'call:read', 'call:create', 'call:update', 'enquiry:read', 'enquiry:create', 'enquiry:update']::text[], true),
  ('student', 'Student', 'Student portal: own fees, receipts, classes and certificate.', 'student', true, ARRAY['fee:read', 'receipt:read', 'attendance:read', 'certificate:read', 'certificate:create']::text[], true);
--> statement-breakpoint
ALTER TABLE "user_roles" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE cascade;
--> statement-breakpoint
DROP TYPE "public"."role";
--> statement-breakpoint
-- Everyone signed in may read role definitions (names for the menus); only a super admin changes them.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_read ON roles FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY roles_write ON roles FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO techcadd_app;
