-- An enquiry records two fees: the course's actual (full) fee and the discounted / proposed fee offered.
-- (actual_fee stays the fee agreed at registration.)
ALTER TABLE "enquiries" ADD COLUMN "course_fee" integer;
