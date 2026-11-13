CREATE TABLE "partner_share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"project_key" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"last_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone,
	"window_opens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_share_links" ADD CONSTRAINT "partner_share_links_project_key_projects_key_fk" FOREIGN KEY ("project_key") REFERENCES "public"."projects"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_share_links" ADD CONSTRAINT "partner_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_share_links" ADD CONSTRAINT "partner_share_links_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_share_links_token_hash_idx" ON "partner_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "partner_share_links_project_idx" ON "partner_share_links" USING btree ("project_key");