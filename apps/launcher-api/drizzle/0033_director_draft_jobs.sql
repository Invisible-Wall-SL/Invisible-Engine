CREATE TABLE "director_draft_jobs" (
	"job_ref" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent" text NOT NULL,
	"draft_id" text NOT NULL,
	"scenarios" jsonb,
	"status" text NOT NULL,
	"result" jsonb,
	"done_via" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	CONSTRAINT "director_draft_jobs_status_check" CHECK ("director_draft_jobs"."status" in ('queued', 'finished', 'failed', 'cancelled')),
	CONSTRAINT "director_draft_jobs_done_check" CHECK (("director_draft_jobs"."status" = 'queued') = ("director_draft_jobs"."done_at" is null))
);
--> statement-breakpoint
ALTER TABLE "director_draft_jobs" ADD CONSTRAINT "director_draft_jobs_run_id_director_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."director_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_draft_jobs_run_idx" ON "director_draft_jobs" USING btree ("run_id");