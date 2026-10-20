-- Lead details, filled in when a lead is added and updated after each call:
-- interested or not (and how much), whether the call was made, what was said, where the person is, and which
-- branch they want to join.
ALTER TABLE "enquiries" ADD COLUMN "interested" boolean;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "interest_pct" integer;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "call_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "call_remark" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "interested_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_interested_branch_id_branches_id_fk" FOREIGN KEY ("interested_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A percentage only makes sense for an interested lead.
ALTER TABLE enquiries ADD CONSTRAINT enquiries_interest_ck CHECK (interest_pct IS NULL OR (interested IS TRUE AND interest_pct BETWEEN 0 AND 100));
--> statement-breakpoint
-- Staff only see their own branch (RLS), but "which branch is the lead interested in" needs every branch's name.
-- This returns just the names, nothing else of the other branches.
CREATE OR REPLACE FUNCTION branch_options() RETURNS TABLE (id uuid, code text, name text, city text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS
  $$ SELECT b.id, b.code, b.name, b.city FROM branches b WHERE b.is_active ORDER BY b.name $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION branch_options() TO techcadd_app;
