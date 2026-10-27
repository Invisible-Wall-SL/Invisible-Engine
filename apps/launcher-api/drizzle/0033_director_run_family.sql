ALTER TABLE "director_runs" ADD COLUMN "family" text DEFAULT 'slot' NOT NULL;--> statement-breakpoint
UPDATE "director_runs" SET "family" = CASE coalesce(
	(SELECT "game_type" FROM "projects" WHERE "projects"."key" = "director_runs"."project_key"),
	(SELECT "game_type" FROM "projects" WHERE "projects"."key" = "director_runs"."template_project_key")
)
	WHEN 'match3' THEN 'match3'
	WHEN 'arcade' THEN 'arcade'
	ELSE 'slot'
END;--> statement-breakpoint
ALTER TABLE "director_runs" ALTER COLUMN "family" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_family_check" CHECK ("director_runs"."family" in ('slot', 'match3', 'arcade'));
