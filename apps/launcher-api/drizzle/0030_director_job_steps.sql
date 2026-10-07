ALTER TABLE "director_atlas_jobs" ADD COLUMN "steps" jsonb;--> statement-breakpoint
ALTER TABLE "director_atlas_jobs" ADD COLUMN "steps_settled_at" timestamp with time zone;