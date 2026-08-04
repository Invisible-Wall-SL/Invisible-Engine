CREATE TABLE "doc_leases" (
	"tool_id" text NOT NULL,
	"client_key" text NOT NULL,
	"project_key" text NOT NULL,
	"doc_key" text NOT NULL,
	"holder_user_id" text NOT NULL,
	"holder_session_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "doc_leases_tool_id_client_key_project_key_doc_key_pk" PRIMARY KEY("tool_id","client_key","project_key","doc_key")
);
--> statement-breakpoint
ALTER TABLE "doc_leases" ADD CONSTRAINT "doc_leases_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;