-- Course categories (the departments every course belongs to) get a remark, a category head and their signature, and
-- an approval step: head office adds approved categories; a branch admin asks for one, and head office approves it.
-- Also the authorised signatory's signature for the certificates. Signatures are stored in the database, like the
-- registration documents, so a redeploy cannot lose them and the daily backup covers them.
ALTER TABLE "departments" ADD COLUMN "remark" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "head_name" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "head_signature" bytea;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "head_signature_mime" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "requested_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "requested_branch_id" uuid REFERENCES "branches"("id");--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "decided_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE departments ADD CONSTRAINT departments_status_ck CHECK (status IN ('approved', 'pending', 'rejected') AND (head_signature IS NULL OR head_signature_mime IN ('image/png', 'image/jpeg')));--> statement-breakpoint
-- a branch may ask for a category (pending, for its own branch) and change it while it waits; head office does the rest
CREATE POLICY departments_branch_request ON departments FOR INSERT WITH CHECK (NOT app_is_super() AND status = 'pending' AND requested_branch_id = app_branch());--> statement-breakpoint
CREATE POLICY departments_branch_edit ON departments FOR UPDATE USING (NOT app_is_super() AND status = 'pending' AND requested_branch_id = app_branch()) WITH CHECK (status = 'pending' AND requested_branch_id = app_branch());--> statement-breakpoint
CREATE TABLE "signature_images" (
	"key" text PRIMARY KEY NOT NULL,
	"signer_name" text,
	"signer_title" text,
	"mime" text NOT NULL,
	"data" bytea NOT NULL,
	"updated_by" uuid REFERENCES "users"("id"),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE signature_images ADD CONSTRAINT signature_images_ck CHECK (key IN ('authorised') AND mime IN ('image/png', 'image/jpeg'));--> statement-breakpoint
ALTER TABLE signature_images ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE signature_images FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY signature_images_read ON signature_images FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY signature_images_write ON signature_images FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON signature_images TO techcadd_app;
