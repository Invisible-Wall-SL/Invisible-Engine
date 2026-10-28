CREATE TABLE "bug_report_relations" (
	"from_bug" integer NOT NULL,
	"to_bug" integer NOT NULL,
	"kind" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "bug_report_relations_from_bug_kind_pk" PRIMARY KEY("from_bug","kind"),
	CONSTRAINT "bug_report_relations_kind_check" CHECK ("bug_report_relations"."kind" in ('escalated_to'))
);
--> statement-breakpoint
ALTER TABLE "bug_report_events" DROP CONSTRAINT "bug_report_events_kind_check";--> statement-breakpoint
ALTER TABLE "director_runs" DROP CONSTRAINT "director_runs_step_check";--> statement-breakpoint
ALTER TABLE "director_runs" DROP CONSTRAINT "director_runs_waiting_on_check";--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "kind" text DEFAULT 'create' NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "bug_number" integer;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "repair_outcome" text;--> statement-breakpoint
ALTER TABLE "bug_report_relations" ADD CONSTRAINT "bug_report_relations_from_bug_bug_reports_number_fk" FOREIGN KEY ("from_bug") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_relations" ADD CONSTRAINT "bug_report_relations_to_bug_bug_reports_number_fk" FOREIGN KEY ("to_bug") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_report_relations_to_idx" ON "bug_report_relations" USING btree ("to_bug");--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "director_runs"
		WHERE "status" IN ('draft', 'running', 'waiting', 'paused', 'stopping')
		GROUP BY "project_key" HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'director_runs: a project has two live runs; stop one before this migration (ADR-0012)';
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "director_runs_live_project_idx" ON "director_runs" USING btree ("project_key") WHERE "director_runs"."status" in ('draft', 'running', 'waiting', 'paused', 'stopping');--> statement-breakpoint
ALTER TABLE "bug_report_events" ADD CONSTRAINT "bug_report_events_kind_check" CHECK ("bug_report_events"."kind" in ('reported', 'edited', 'comment', 'priority', 'status', 'sent', 'unsent', 'screenshot_added', 'screenshot_removed', 'linked', 'unlinked', 'escalated', 'repair'));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_kind_check" CHECK ("director_runs"."kind" in ('create', 'repair'));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_bug_number_check" CHECK ("director_runs"."kind" = 'repair' or "director_runs"."bug_number" is null);--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_repair_outcome_check" CHECK ("director_runs"."repair_outcome" is null or ("director_runs"."kind" = 'repair' and "director_runs"."repair_outcome" in ('fixed', 'escalated', 'needs_person', 'not_reproduced')));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_step_check" CHECK ("director_runs"."step" in ('breakdown', 'style_pack', 'regions', 'build', 'reproduce', 'fix', 'verify', 'handoff'));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_waiting_on_check" CHECK (("director_runs"."status" = 'waiting') = ("director_runs"."waiting_on" is not null) and ("director_runs"."waiting_on" is null or "director_runs"."waiting_on" in ('breakdown', 'art_plan', 'region_batch', 'before_publish', 'repair_review')));