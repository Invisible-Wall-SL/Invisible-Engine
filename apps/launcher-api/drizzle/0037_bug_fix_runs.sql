CREATE TABLE "bug_fix_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"bug_number" integer NOT NULL,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"outcome" text,
	"base_sha" text NOT NULL,
	"gh_run_id" bigint,
	"pr_number" integer,
	"branch" text,
	"summary" text,
	"reason" text,
	"second_bug" jsonb,
	"spend_usd" double precision,
	"started_by_id" text NOT NULL,
	"started_by" text NOT NULL,
	"request_id" text NOT NULL,
	"result_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "bug_fix_runs_status_check" CHECK ("bug_fix_runs"."status" in ('dispatched', 'running', 'pr_opened', 'no_fix', 'failed', 'cancelled')),
	CONSTRAINT "bug_fix_runs_outcome_check" CHECK ("bug_fix_runs"."outcome" is null or "bug_fix_runs"."outcome" in ('fixed', 'not_reproduced', 'needs_person', 'second_area'))
);
--> statement-breakpoint
ALTER TABLE "bug_report_events" DROP CONSTRAINT "bug_report_events_kind_check";--> statement-breakpoint
ALTER TABLE "bug_fix_runs" ADD CONSTRAINT "bug_fix_runs_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bug_fix_runs_request_id_idx" ON "bug_fix_runs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bug_fix_runs_gh_run_id_idx" ON "bug_fix_runs" USING btree ("gh_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bug_fix_runs_live_idx" ON "bug_fix_runs" USING btree ("bug_number") WHERE "bug_fix_runs"."status" in ('dispatched', 'running');--> statement-breakpoint
CREATE INDEX "bug_fix_runs_bug_idx" ON "bug_fix_runs" USING btree ("bug_number","created_at");--> statement-breakpoint
ALTER TABLE "bug_report_events" ADD CONSTRAINT "bug_report_events_kind_check" CHECK ("bug_report_events"."kind" in ('reported', 'edited', 'comment', 'priority', 'status', 'sent', 'unsent', 'screenshot_added', 'screenshot_removed', 'linked', 'unlinked', 'escalated', 'repair', 'fix_run'));