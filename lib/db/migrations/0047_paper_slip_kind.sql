-- The picture of a paper slip is its own kind of document ("payment_slip"), apart from the proof of the payment
-- itself. Slips uploaded before this were stored as payment proofs: move them.
UPDATE registration_documents d SET kind = 'payment_slip' FROM payments p WHERE p.id = d.payment_id AND p.manual_slip_no IS NOT NULL AND d.kind = 'payment_proof';
