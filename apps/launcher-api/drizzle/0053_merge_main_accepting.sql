ALTER TABLE "merge_main_runs" DROP CONSTRAINT "merge_main_runs_status_check";--> statement-breakpoint
DROP INDEX "merge_main_runs_live_idx";--> statement-breakpoint
ALTER TABLE "merge_main_runs" ADD COLUMN "accept_sha" text;--> statement-breakpoint
ALTER TABLE "merge_main_runs" ADD COLUMN "accepting_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "merge_main_runs_live_idx" ON "merge_main_runs" USING btree ("pr_number") WHERE "merge_main_runs"."status" in ('dispatched', 'running', 'proposed', 'accepting');--> statement-breakpoint
ALTER TABLE "merge_main_runs" ADD CONSTRAINT "merge_main_runs_status_check" CHECK ("merge_main_runs"."status" in ('dispatched', 'running', 'proposed', 'accepting', 'accepted', 'discarded', 'stale', 'needs_person', 'no_proposal', 'failed', 'cancelled'));