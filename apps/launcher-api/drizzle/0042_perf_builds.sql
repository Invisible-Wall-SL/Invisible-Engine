CREATE TABLE "perf_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"client_key" text NOT NULL,
	"game_key" text NOT NULL,
	"build" text NOT NULL,
	"kind" text NOT NULL,
	"profile" text,
	"debug" boolean DEFAULT false NOT NULL,
	"optimize" boolean DEFAULT false NOT NULL,
	"built_at" text,
	"engine_sha" text,
	"game_sha" text,
	"launcher_version" text,
	"breakdown_version" integer NOT NULL,
	"files" integer NOT NULL,
	"shipped_bytes" bigint NOT NULL,
	"code_bytes" bigint NOT NULL,
	"gpu_bytes" bigint NOT NULL,
	"removed_bytes" bigint NOT NULL,
	"unreferenced_bytes" bigint NOT NULL,
	"duplicate_bytes" bigint NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues_error" integer DEFAULT 0 NOT NULL,
	"issues_warn" integer DEFAULT 0 NOT NULL,
	"issues_info" integer DEFAULT 0 NOT NULL,
	"r2_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_by" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"keep" boolean DEFAULT false NOT NULL,
	"purging_at" timestamp with time zone,
	CONSTRAINT "perf_builds_kind_check" CHECK ("perf_builds"."kind" in ('publish', 'delivery'))
);
--> statement-breakpoint
ALTER TABLE "perf_builds" ADD CONSTRAINT "perf_builds_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perf_builds" ADD CONSTRAINT "perf_builds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perf_builds_project_idx" ON "perf_builds" USING btree ("project_key","registered_at");--> statement-breakpoint
CREATE INDEX "perf_builds_line_idx" ON "perf_builds" USING btree ("project_key","game_key","kind","registered_at");--> statement-breakpoint
CREATE INDEX "perf_builds_purge_idx" ON "perf_builds" USING btree ("keep","registered_at");