CREATE TABLE "registration_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registration_documents" ADD CONSTRAINT "registration_documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_documents" ADD CONSTRAINT "registration_documents_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_documents" ADD CONSTRAINT "registration_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_documents_reg_idx" ON "registration_documents" USING btree ("registration_id","uploaded_at");--> statement-breakpoint
ALTER TABLE registration_documents ADD CONSTRAINT registration_documents_size_ck CHECK (size_bytes > 0 AND size_bytes <= 5242880);
--> statement-breakpoint
ALTER TABLE registration_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY registration_documents_scope ON registration_documents FOR ALL USING (app_is_super() OR branch_id = app_branch()) WITH CHECK (app_is_super() OR branch_id = app_branch());
--> statement-breakpoint
CREATE POLICY student_own ON registration_documents AS RESTRICTIVE FOR ALL USING (app_role() <> 'student' OR registration_id IN (SELECT id FROM registrations));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON registration_documents TO techcadd_app;
