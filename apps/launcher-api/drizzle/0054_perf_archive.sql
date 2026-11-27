ALTER TABLE "perf_builds" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "perf_finding_bugs" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "send_key" text;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "send_frames" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "perf_reports_send_key_idx" ON "perf_reports" USING btree ("project_key","send_key") WHERE "perf_reports"."send_key" is not null;