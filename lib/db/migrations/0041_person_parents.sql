-- Registration asks for the mother's name and the student's gender as well (father's name and the parent's mobile already exist).
ALTER TABLE "persons" ADD COLUMN "mother_name" text;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE persons ADD CONSTRAINT persons_gender_ck CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));
