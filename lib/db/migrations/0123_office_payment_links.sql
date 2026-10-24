-- A payment link the office makes and sends (Fees → a student → Payment link): via 'office' (modules/fees/online.ts).
ALTER TABLE fee_payment_links DROP CONSTRAINT fee_payment_links_via_ck;
--> statement-breakpoint
ALTER TABLE fee_payment_links ADD CONSTRAINT fee_payment_links_via_ck CHECK (via IN ('student', 'parent', 'office'));
