CREATE TABLE "perf_finding_bugs" (
	"project_key" text NOT NULL,
	"finding_id" text NOT NULL,
	"bug_number" integer NOT NULL,
	"reading_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"build_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perf_finding_bugs_project_key_finding_id_pk" PRIMARY KEY("project_key","finding_id")
);
--> statement-breakpoint
ALTER TABLE "perf_finding_bugs" ADD CONSTRAINT "perf_finding_bugs_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_finding_bugs" ADD CONSTRAINT "perf_finding_bugs_bug_number_bug_reports_number_fk" FOREIGN KEY ("bug_number") REFERENCES "public"."bug_reports"("number") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perf_finding_bugs_bug_idx" ON "perf_finding_bugs" USING btree ("bug_number");