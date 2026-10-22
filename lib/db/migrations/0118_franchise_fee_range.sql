-- The total fee a franchise may charge for a course (modules/franchise/fees.ts): head office sets the lowest and the
-- highest (paise, each optional). Checked when a franchise registers a student, changes a total fee or gives a
-- discount; the institute's own centres are not bound by it.
ALTER TABLE courses ADD COLUMN franchise_min_fee integer;
--> statement-breakpoint
ALTER TABLE courses ADD COLUMN franchise_max_fee integer;
--> statement-breakpoint
ALTER TABLE courses ADD CONSTRAINT courses_franchise_fee_ck CHECK (
	(franchise_min_fee IS NULL OR franchise_min_fee >= 0) AND (franchise_max_fee IS NULL OR franchise_max_fee >= 0)
	AND (franchise_min_fee IS NULL OR franchise_max_fee IS NULL OR franchise_min_fee <= franchise_max_fee));
