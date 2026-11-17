CREATE TABLE "perf_budgets" (
	"project_key" text NOT NULL,
	"device_class" text NOT NULL,
	"metric" text NOT NULL,
	"phase" text DEFAULT '' NOT NULL,
	"warn" double precision,
	"fail" double precision,
	"rev" integer NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perf_budgets_project_key_device_class_metric_phase_pk" PRIMARY KEY("project_key","device_class","metric","phase"),
	CONSTRAINT "perf_budgets_device_class_check" CHECK ("perf_budgets"."device_class" in ('phone', 'tablet', 'desktop', 'all')),
	CONSTRAINT "perf_budgets_line_check" CHECK ("perf_budgets"."warn" is not null or "perf_budgets"."fail" is not null)
);
--> statement-breakpoint
ALTER TABLE "perf_budgets" ADD CONSTRAINT "perf_budgets_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_budgets" ADD CONSTRAINT "perf_budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;