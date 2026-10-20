ALTER TABLE "branches" ADD COLUMN "city" text;--> statement-breakpoint
-- The institute's branches (one per city). Code = city short form (lib/branch-code.ts). Skips a city that already
-- has a branch (same code, or the city already in a branch's name), so it never duplicates and is safe to re-run.
-- Address and phone are filled in later from Settings.
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
INSERT INTO branches (code, name, city)
SELECT v.code, 'Techcadd ' || v.city, v.city
FROM (VALUES ('LDH', 'Ludhiana'), ('JAL', 'Jalandhar'), ('ASR', 'Amritsar'), ('CHD', 'Chandigarh'),
             ('MOH', 'Mohali'), ('HSP', 'Hoshiarpur'), ('PGW', 'Phagwara')) AS v(code, city)
WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.code = v.code OR lower(b.name) LIKE '%' || lower(v.city) || '%');
