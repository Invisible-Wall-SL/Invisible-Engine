CREATE TABLE "pipeline_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"title" text NOT NULL,
	"head_sha" text NOT NULL,
	"merge_sha" text,
	"merged_by_id" text NOT NULL,
	"merged_by" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revert_of" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_merges_pr_number_idx" ON "pipeline_merges" USING btree ("pr_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_merges_request_id_idx" ON "pipeline_merges" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "pipeline_merges_revert_of_idx" ON "pipeline_merges" USING btree ("revert_of");