CREATE TABLE "cost_top_ups" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_top_ups" ADD CONSTRAINT "cost_top_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;