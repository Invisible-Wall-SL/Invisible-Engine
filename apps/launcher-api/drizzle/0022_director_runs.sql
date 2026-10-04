CREATE TABLE "director_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent" text NOT NULL,
	"kind" text NOT NULL,
	"tool" text,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "director_events_kind_check" CHECK ("director_events"."kind" in ('activity', 'owner_message', 'owner_request', 'checkpoint_open', 'checkpoint_resolved', 'region_status', 'job_queued', 'job_done', 'spend', 'run_status', 'error'))
);
--> statement-breakpoint
CREATE TABLE "director_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent" text NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "director_messages_role_check" CHECK ("director_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "director_regions" (
	"run_id" text NOT NULL,
	"region" text NOT NULL,
	"region_group" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"variants_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"art_director_pick_json" jsonb,
	"owner_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "director_regions_run_id_region_pk" PRIMARY KEY("run_id","region"),
	CONSTRAINT "director_regions_status_check" CHECK ("director_regions"."status" in ('queued', 'drafting', 'to_review', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "preset_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "starting_point_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "checkpoints_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "step" text DEFAULT 'breakdown' NOT NULL;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "waiting_on" text;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "budget_cap_usd" double precision;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "lease_holder" text;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "director_runs" ADD COLUMN "handled_event_id" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "director_events" ADD CONSTRAINT "director_events_run_id_director_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."director_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_messages" ADD CONSTRAINT "director_messages_run_id_director_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."director_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "director_regions" ADD CONSTRAINT "director_regions_run_id_director_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."director_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "director_events_run_idx" ON "director_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "director_messages_run_agent_seq_idx" ON "director_messages" USING btree ("run_id","agent","seq");--> statement-breakpoint
CREATE INDEX "director_runs_status_idx" ON "director_runs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_status_check" CHECK ("director_runs"."status" in ('draft', 'running', 'waiting', 'paused', 'stopping', 'stopped', 'failed', 'handed_off'));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_step_check" CHECK ("director_runs"."step" in ('breakdown', 'style_pack', 'regions', 'build', 'handoff'));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_waiting_on_check" CHECK (("director_runs"."status" = 'waiting') = ("director_runs"."waiting_on" is not null) and ("director_runs"."waiting_on" is null or "director_runs"."waiting_on" in ('breakdown', 'region_batch', 'before_publish')));--> statement-breakpoint
ALTER TABLE "director_runs" ADD CONSTRAINT "director_runs_lease_check" CHECK (("director_runs"."lease_holder" is null) = ("director_runs"."lease_until" is null));