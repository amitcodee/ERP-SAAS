CREATE TYPE "public"."registration_kind" AS ENUM('new', 'upgrade');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('active', 'on_hold', 'discontinued', 'completed');--> statement-breakpoint
CREATE TABLE "registration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" uuid,
	"from_status" "registration_status",
	"to_status" "registration_status" NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reg_no" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"enquiry_id" uuid,
	"kind" "registration_kind" DEFAULT 'new' NOT NULL,
	"previous_registration_id" uuid,
	"department_id" uuid NOT NULL,
	"course_id" uuid,
	"class_mode_id" uuid,
	"enrollment_date" date NOT NULL,
	"total_fee" integer DEFAULT 0 NOT NULL,
	"status" "registration_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_reg_no_uq" UNIQUE("reg_no"),
	CONSTRAINT "registrations_enquiry_uq" UNIQUE("enquiry_id")
);
--> statement-breakpoint
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_events" ADD CONSTRAINT "registration_events_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_class_mode_id_lookups_id_fk" FOREIGN KEY ("class_mode_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_events_reg_idx" ON "registration_events" USING btree ("registration_id","at");--> statement-breakpoint
CREATE INDEX "registrations_branch_status_idx" ON "registrations" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "registrations_person_idx" ON "registrations" USING btree ("person_id");