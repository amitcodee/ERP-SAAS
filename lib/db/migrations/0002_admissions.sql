CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'contacted', 'follow_up', 'demo', 'joined', 'not_joined', 'dead');--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"person_id" uuid,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"proposed_fee" integer,
	"department_id" uuid,
	"course_id" uuid,
	"status" text,
	"remarks" text,
	"follow_up_date" date,
	"enquiry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_no" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"source_id" uuid,
	"department_id" uuid,
	"course_id" uuid,
	"class_mode_id" uuid,
	"proposed_fee" integer,
	"actual_fee" integer,
	"demo_by" uuid,
	"assigned_to" uuid,
	"expected_join_date" date,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"not_joined_reason_id" uuid,
	"next_follow_up" date,
	"final_remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enquiries_no_uq" UNIQUE("enquiry_no")
);
--> statement-breakpoint
CREATE TABLE "enquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_user" uuid,
	"from_status" "enquiry_status",
	"to_status" "enquiry_status" NOT NULL,
	"follow_up_date" date,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "person_occupations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"school_or_college" text,
	"qualification" text,
	"semester" text,
	"job_role" text,
	"company" text,
	"skills" text,
	"country" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"father_name" text,
	"dob" date,
	"phone" text NOT NULL,
	"phone_norm" text NOT NULL,
	"alt_phone" text,
	"guardian_phone" text,
	"email" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "persons_branch_phone_uq" UNIQUE("branch_id","phone_norm")
);
--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_source_id_lookups_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_class_mode_id_lookups_id_fk" FOREIGN KEY ("class_mode_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_demo_by_users_id_fk" FOREIGN KEY ("demo_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_not_joined_reason_id_lookups_id_fk" FOREIGN KEY ("not_joined_reason_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_by_user_users_id_fk" FOREIGN KEY ("by_user") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_occupations" ADD CONSTRAINT "person_occupations_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_occupations" ADD CONSTRAINT "person_occupations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_occupations" ADD CONSTRAINT "person_occupations_type_id_lookups_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."lookups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_branch_at_idx" ON "calls" USING btree ("branch_id","called_at");--> statement-breakpoint
CREATE INDEX "enquiries_branch_status_idx" ON "enquiries" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "enquiries_person_idx" ON "enquiries" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "enquiry_events_enq_idx" ON "enquiry_events" USING btree ("enquiry_id","at");--> statement-breakpoint
CREATE INDEX "person_occ_person_idx" ON "person_occupations" USING btree ("person_id","valid_from");