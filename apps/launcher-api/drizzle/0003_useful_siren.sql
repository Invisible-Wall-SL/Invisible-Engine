CREATE TABLE "role_tool_access" (
	"role" text NOT NULL,
	"tool_key" text NOT NULL,
	"granted" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_tool_access_role_tool_key_pk" PRIMARY KEY("role","tool_key")
);
