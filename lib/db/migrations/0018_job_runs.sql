CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "job_runs" USING btree ("job","started_at");--> statement-breakpoint
-- System-level table: only a super admin (or a background job, which runs as super) sees or writes it.
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_runs_super ON job_runs FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON job_runs TO techcadd_app;
