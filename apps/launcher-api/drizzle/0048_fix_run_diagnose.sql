ALTER TABLE "bug_fix_runs" DROP CONSTRAINT "bug_fix_runs_status_check";--> statement-breakpoint
ALTER TABLE "bug_fix_runs" DROP CONSTRAINT "bug_fix_runs_outcome_check";--> statement-breakpoint
ALTER TABLE "bug_report_events" DROP CONSTRAINT "bug_report_events_kind_check";--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD COLUMN "mode" text DEFAULT 'build' NOT NULL;--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD COLUMN "diagnosis" jsonb;--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD COLUMN "chosen_option" jsonb;--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD COLUMN "parent_run_id" text;--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD CONSTRAINT "bug_fix_runs_parent_run_id_bug_fix_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."bug_fix_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD CONSTRAINT "bug_fix_runs_mode_check" CHECK ("bug_fix_runs"."mode" in ('diagnose', 'build'));--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD CONSTRAINT "bug_fix_runs_status_check" CHECK ("bug_fix_runs"."status" in ('dispatched', 'running', 'diagnosed', 'pr_opened', 'no_fix', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD CONSTRAINT "bug_fix_runs_outcome_check" CHECK ("bug_fix_runs"."outcome" is null or "bug_fix_runs"."outcome" in ('fixed', 'not_reproduced', 'needs_person', 'second_area', 'diagnosed'));--> statement-breakpoint
ALTER TABLE "bug_report_events" ADD CONSTRAINT "bug_report_events_kind_check" CHECK ("bug_report_events"."kind" in ('reported', 'edited', 'comment', 'priority', 'status', 'sent', 'unsent', 'screenshot_added', 'screenshot_removed', 'linked', 'unlinked', 'escalated', 'repair', 'fix_run', 'fix_decision'));