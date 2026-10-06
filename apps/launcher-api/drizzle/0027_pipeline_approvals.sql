CREATE TABLE "pipeline_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"diff_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"approver_id" text NOT NULL,
	"approver" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_approvals_diff_approver_idx" ON "pipeline_approvals" USING btree ("diff_id","approver_id");--> statement-breakpoint
CREATE INDEX "pipeline_approvals_head_sha_idx" ON "pipeline_approvals" USING btree ("head_sha");