-- Each branch may number its registrations its own way (head office sets it in Branches), e.g. TCD/4002/{n}, so the
-- numbers carried on from the old records go on unbroken. Empty: the default REG-{yyyy}-{code}-{nnnn}.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS reg_format text;--> statement-breakpoint
ALTER TABLE branches ADD CONSTRAINT branches_reg_format_ck CHECK (reg_format IS NULL OR (length(reg_format) <= 40 AND reg_format ~ '\{n(nnn)?\}'));
