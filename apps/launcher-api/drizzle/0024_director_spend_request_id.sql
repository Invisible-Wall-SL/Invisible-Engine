ALTER TABLE "director_spend" ADD COLUMN "request_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "director_spend_request_id_idx" ON "director_spend" USING btree ("request_id");