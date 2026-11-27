CREATE TABLE "merge_main_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"pr_number" integer NOT NULL,
	"branch" text NOT NULL,
	"head_sha" text NOT NULL,
	"main_sha" text NOT NULL,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"reason" text,
	"files" jsonb,
	"explanation" jsonb,
	"merge_sha" text,
	"spend_usd" double precision,
	"gh_run_id" bigint,
	"started_by_id" text NOT NULL,
	"started_by" text NOT NULL,
	"accepted_by_id" text,
	"accepted_by" text,
	"request_id" text NOT NULL,
	"result_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "merge_main_runs_status_check" CHECK ("merge_main_runs"."status" in ('dispatched', 'running', 'proposed', 'accepted', 'discarded', 'stale', 'needs_person', 'no_proposal', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "merge_main_runs_request_id_idx" ON "merge_main_runs" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_main_runs_gh_run_id_idx" ON "merge_main_runs" USING btree ("gh_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_main_runs_live_idx" ON "merge_main_runs" USING btree ("pr_number") WHERE "merge_main_runs"."status" in ('dispatched', 'running', 'proposed');--> statement-breakpoint
CREATE INDEX "merge_main_runs_pr_idx" ON "merge_main_runs" USING btree ("pr_number","created_at");