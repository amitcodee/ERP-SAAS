-- One person can serve several branches (e.g. one accountant for three branches). users.branch_id stays the home
-- branch; user_branches lists the OTHER branches they also work in. They switch branch in the panel; every query
-- still runs inside exactly one branch (app_branch()).
CREATE TABLE "user_branches" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_branches_user_id_branch_id_pk" PRIMARY KEY("user_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_branches" ADD CONSTRAINT "user_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "user_branches_branch_idx" ON "user_branches" USING btree ("branch_id");
--> statement-breakpoint
ALTER TABLE user_branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_branches_read ON user_branches FOR SELECT USING (app_is_super() OR user_id = app_user() OR branch_id = app_branch());
--> statement-breakpoint
-- Only head office shares a person with another branch.
CREATE POLICY user_branches_write ON user_branches FOR ALL USING (app_is_super()) WITH CHECK (app_is_super());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_branches TO techcadd_app;
--> statement-breakpoint
-- A branch can SEE (never change) the people shared with it, so their names show on the work they do there.
CREATE POLICY users_shared_read ON users FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = users.id AND ub.branch_id = app_branch()));
--> statement-breakpoint
CREATE POLICY user_roles_shared_read ON user_roles FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = user_roles.user_id AND ub.branch_id = app_branch()));
