ALTER TABLE "perf_reports" ADD COLUMN "transfer_mb" double precision;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "first_frame_ms" double precision;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "network" jsonb;