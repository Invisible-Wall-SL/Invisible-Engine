CREATE TABLE "director_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"usd" double precision NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "director_spend_kind_check" CHECK ("director_spend"."kind" in ('claude', 'runpod'))
);
--> statement-breakpoint
CREATE INDEX "director_spend_at_idx" ON "director_spend" USING btree ("at");--> statement-breakpoint
CREATE INDEX "director_spend_run_idx" ON "director_spend" USING btree ("run_id");