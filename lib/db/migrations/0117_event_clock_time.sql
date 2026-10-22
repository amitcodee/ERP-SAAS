-- An enquiry's history is ordered by when each step happened. now() is the transaction's start, so two steps saved in
-- one transaction (a new enquiry and its first follow-up) tied and could show in either order; clock_timestamp() is
-- the moment of each insert.
ALTER TABLE enquiry_events ALTER COLUMN at SET DEFAULT clock_timestamp();
