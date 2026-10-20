-- A random call becomes an enquiry when the person visits the branch. Walk-ins are added directly as visited.
ALTER TABLE "enquiries" ADD COLUMN "visited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "visited_at" timestamp with time zone;--> statement-breakpoint
SELECT set_config('app.is_super', 'true', true);
--> statement-breakpoint
-- Every enquiry that came from a random call was made at the visit.
UPDATE enquiries e SET visited = true, visited_at = e.created_at WHERE EXISTS (SELECT 1 FROM calls c WHERE c.enquiry_id = e.id);
