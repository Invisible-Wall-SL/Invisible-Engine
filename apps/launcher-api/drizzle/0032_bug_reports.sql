CREATE TABLE "bug_report_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bug_number" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "bug_report_events_kind_check" CHECK ("bug_report_events"."kind" in ('reported', 'edited', 'comment', 'priority', 'status', 'sent', 'unsent', 'screenshot_added', 'screenshot_removed', 'linked'))
);
--> statement-breakpoint
CREATE TABLE "bug_report_links" (
	"bug_number" integer NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_report_links_bug_number_pr_number_pk" PRIMARY KEY("bug_number","pr_number"),
	CONSTRAINT "bug_report_links_state_check" CHECK ("bug_report_links"."state" in ('open', 'merged', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "bug_report_screenshots" (
	"id" text PRIMARY KEY NOT NULL,
	"bug_number" integer NOT NULL,
	"file" text NOT NULL,
	"media_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"number" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'pipeline' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"area" text NOT NULL,
	"project_key" text,
	"page_url" text,
	"reporter_id" text NOT NULL,
	"reporter" text NOT NULL,
	"priority" text,
	"status" text DEFAULT 'open' NOT NULL,
	"status_by" text,
	"status_at" timestamp with time zone,
	"status_auto" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_reports_kind_check" CHECK ("bug_reports"."kind" in ('pipeline', 'game')),
	CONSTRAINT "bug_reports_game_project_check" CHECK ("bug_reports"."kind" <> 'game' or "bug_reports"."project_key" is not null),
	CONSTRAINT "bug_reports_status_check" CHECK ("bug_reports"."status" in ('open', 'working', 'resolved', 'wontFix')),
	CONSTRAINT "bug_reports_priority_check" CHECK ("bug_reports"."priority" is null or "bug_reports"."priority" in ('critical', 'high', 'medium', 'low'))
);
--> statement-breakpoint
ALTER TABLE "bug_report_events" ADD CONSTRAINT "bug_report_events_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_links" ADD CONSTRAINT "bug_report_links_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_screenshots" ADD CONSTRAINT "bug_report_screenshots_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_report_events_bug_idx" ON "bug_report_events" USING btree ("bug_number","id");--> statement-breakpoint
CREATE INDEX "bug_report_screenshots_bug_idx" ON "bug_report_screenshots" USING btree ("bug_number");--> statement-breakpoint
CREATE INDEX "bug_reports_kind_project_idx" ON "bug_reports" USING btree ("kind","project_key");--> statement-breakpoint
CREATE INDEX "bug_reports_sent_at_idx" ON "bug_reports" USING btree ("sent_at");