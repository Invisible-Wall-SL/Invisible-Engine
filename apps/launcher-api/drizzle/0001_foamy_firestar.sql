CREATE TABLE "user_tool_access" (
	"user_id" text NOT NULL,
	"tool_key" text NOT NULL,
	"granted" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tool_access_user_id_tool_key_pk" PRIMARY KEY("user_id","tool_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_tool_access" ADD CONSTRAINT "user_tool_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;