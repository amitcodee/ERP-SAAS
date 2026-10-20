-- A balance moved to another branch on a transfer: neither paid nor discounted here, so it gets its own kind. It
-- still counts in the balance (sum of the ledger); v_fee_balance leaves it out of "paid" and "discounted" as it is.
ALTER TYPE ledger_entry_type ADD VALUE IF NOT EXISTS 'transfer';
