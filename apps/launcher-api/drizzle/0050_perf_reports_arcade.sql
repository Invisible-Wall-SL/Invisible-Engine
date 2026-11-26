ALTER TABLE "perf_reports" ADD COLUMN "game_kind" text;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "arcade_phases" jsonb;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "capped30" boolean DEFAULT false NOT NULL;