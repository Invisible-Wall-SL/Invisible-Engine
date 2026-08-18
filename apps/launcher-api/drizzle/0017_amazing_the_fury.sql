CREATE TABLE "cost_months" (
	"provider" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"amount_usd_cents" integer DEFAULT 0 NOT NULL,
	"eur_cents" integer,
	"locked_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "cost_months_provider_year_month_pk" PRIMARY KEY("provider","year","month")
);
--> statement-breakpoint
ALTER TABLE "cost_months" ADD CONSTRAINT "cost_months_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;