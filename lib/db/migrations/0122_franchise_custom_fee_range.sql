-- The total fee a franchise may charge for a customised course (its own title, no course from the list), per
-- department (modules/franchise/fees.ts): head office sets the lowest and the highest, like a course's range (0118).
ALTER TABLE departments ADD COLUMN franchise_min_fee integer;
--> statement-breakpoint
ALTER TABLE departments ADD COLUMN franchise_max_fee integer;
--> statement-breakpoint
ALTER TABLE departments ADD CONSTRAINT departments_franchise_fee_ck CHECK (
	(franchise_min_fee IS NULL OR franchise_min_fee >= 0) AND (franchise_max_fee IS NULL OR franchise_max_fee >= 0)
	AND (franchise_min_fee IS NULL OR franchise_max_fee IS NULL OR franchise_min_fee <= franchise_max_fee));
