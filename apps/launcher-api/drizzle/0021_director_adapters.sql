CREATE TABLE "director_ops" (
	"op_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent" text NOT NULL,
	"op" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "director_ops_status_check" CHECK ("director_ops"."status" in ('pending', 'done'))
);
--> statement-breakpoint
CREATE TABLE "director_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"client_key" text,
	"template_project_key" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"template_config_etag" text,
	"project_config_etag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "director_template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "director_ops" ADD CONSTRAINT "director_ops_run_id_director_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."director_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_ops_run_idx" ON "director_ops" USING btree ("run_id");