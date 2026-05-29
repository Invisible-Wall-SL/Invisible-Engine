CREATE TABLE IF NOT EXISTS "clients" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_client_access" (
	"user_id" text NOT NULL,
	"client_key" text NOT NULL,
	CONSTRAINT "user_client_access_user_id_client_key_pk" PRIMARY KEY("user_id","client_key")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "client_key" text;--> statement-breakpoint
ALTER TABLE "user_client_access" ADD CONSTRAINT "user_client_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_access" ADD CONSTRAINT "user_client_access_client_key_clients_key_fk" FOREIGN KEY ("client_key") REFERENCES "public"."clients"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_key_clients_key_fk" FOREIGN KEY ("client_key") REFERENCES "public"."clients"("key") ON DELETE set null ON UPDATE no action;
