ALTER TABLE "perf_reports" DROP CONSTRAINT "perf_reports_source_check";--> statement-breakpoint
ALTER TABLE "perf_reports" ADD COLUMN "counts" jsonb;--> statement-breakpoint
ALTER TABLE "perf_reports" ADD CONSTRAINT "perf_reports_source_check" CHECK ("perf_reports"."source" in ('capture', 'paste', 'lab'));