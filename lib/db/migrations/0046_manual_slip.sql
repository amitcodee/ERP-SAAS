-- A payment for which a paper (manual) slip was already given to the student: its number is kept, its photo is
-- stored as proof, and the receipt made here is the e-slip of that paper slip.
ALTER TABLE "payments" ADD COLUMN "manual_slip_no" text;--> statement-breakpoint
CREATE INDEX "payments_manual_slip_idx" ON "payments" ("branch_id", lower("manual_slip_no")) WHERE manual_slip_no IS NOT NULL;
