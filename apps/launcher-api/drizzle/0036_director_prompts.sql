CREATE TABLE "director_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_key" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "director_prompts" ADD CONSTRAINT "director_prompts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_prompts" ADD CONSTRAINT "director_prompts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "director_prompts_client_name_idx" ON "director_prompts" USING btree ("client_key",lower("name"));