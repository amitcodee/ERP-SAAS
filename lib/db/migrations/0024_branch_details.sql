ALTER TABLE "branches" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "pincode" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "cert_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_cert_code_uq" ON "branches" USING btree ("cert_code");--> statement-breakpoint
-- Existing branches keep printing their branch code on certificates; the 7 city branches get their state.
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
UPDATE branches SET cert_code = code WHERE cert_code IS NULL;
--> statement-breakpoint
UPDATE branches SET state = CASE WHEN city = 'Chandigarh' THEN 'Chandigarh' ELSE 'Punjab' END
WHERE state IS NULL AND code IN ('LDH', 'JAL', 'ASR', 'CHD', 'MOH', 'HSP', 'PGW');
