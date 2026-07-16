CREATE TABLE "shared_animations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_client" text DEFAULT '' NOT NULL,
	"source_project" text DEFAULT '' NOT NULL,
	"source_rig" text,
	"refs" jsonb NOT NULL,
	"duration" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_rigs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_client" text DEFAULT '' NOT NULL,
	"source_project" text DEFAULT '' NOT NULL,
	"source_rig" text,
	"stats" jsonb NOT NULL
);
