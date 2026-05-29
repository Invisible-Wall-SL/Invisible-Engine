CREATE TABLE IF NOT EXISTS "games" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
