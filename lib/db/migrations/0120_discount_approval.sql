-- A discount above the institute's limit (business rule discount.head_office_pct) is not given at once: it waits as a
-- fee change request that only head office decides (modules/fees/service.ts).
ALTER TABLE fee_change_requests ADD COLUMN head_office boolean NOT NULL DEFAULT false;
