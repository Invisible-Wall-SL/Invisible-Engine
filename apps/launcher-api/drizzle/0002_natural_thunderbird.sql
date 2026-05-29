CREATE TABLE "projects" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_project_access" (
	"user_id" text NOT NULL,
	"project_key" text NOT NULL,
	CONSTRAINT "user_project_access_user_id_project_key_pk" PRIMARY KEY("user_id","project_key")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_project_key" text;--> statement-breakpoint
ALTER TABLE "user_project_access" ADD CONSTRAINT "user_project_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_project_access" ADD CONSTRAINT "user_project_access_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_project_key_projects_key_fk" FOREIGN KEY ("active_project_key") REFERENCES "public"."projects"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "projects" ("key", "name") VALUES ('cloud', 'Cloud') ON CONFLICT ("key") DO NOTHING;
