CREATE TABLE "director_blueprint_timings" (
	"pipeline" text NOT NULL,
	"gen_px" integer NOT NULL,
	"jobs" integer DEFAULT 0 NOT NULL,
	"mean_exec_seconds" double precision DEFAULT 0 NOT NULL,
	"mean_delay_seconds" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "director_blueprint_timings_pipeline_gen_px_pk" PRIMARY KEY("pipeline","gen_px")
);
--> statement-breakpoint
CREATE TABLE "director_template_recipes" (
	"template_project_key" text NOT NULL,
	"region_group" text NOT NULL,
	"version" integer NOT NULL,
	"chain_json" jsonb NOT NULL,
	"run_id" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "director_template_recipes_template_project_key_region_group_version_pk" PRIMARY KEY("template_project_key","region_group","version")
);
--> statement-breakpoint
ALTER TABLE "director_runs" DROP CONSTRAINT "director_runs_waiting_on_check";--> statement-breakpoint
ALTER TABLE "director_regions" ADD COLUMN "recipe_json" jsonb;--> statement-breakpoint
ALTER TABLE "director_regions" ADD COLUMN "recipe_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_waiting_on_check" CHECK (("director_runs"."status" = 'waiting') = ("director_runs"."waiting_on" is not null) and ("director_runs"."waiting_on" is null or "director_runs"."waiting_on" in ('breakdown', 'art_plan', 'region_batch', 'before_publish')));