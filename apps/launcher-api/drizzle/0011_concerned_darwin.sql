ALTER TABLE "games" ADD COLUMN "version" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "built_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "debug" boolean DEFAULT false NOT NULL;