CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admin_audit_at_idx" ON "admin_audit" USING btree ("at");
--> statement-breakpoint
-- Append-only: once written, a row is never changed or removed — not by a bug, a delegated admin or
-- the DB browser. Dropping the triggers takes the database owner.
CREATE OR REPLACE FUNCTION admin_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'admin_audit is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER admin_audit_no_update_delete
	BEFORE UPDATE OR DELETE ON admin_audit
	FOR EACH ROW
	EXECUTE FUNCTION admin_audit_append_only();
--> statement-breakpoint
CREATE TRIGGER admin_audit_no_truncate
	BEFORE TRUNCATE ON admin_audit
	FOR EACH STATEMENT
	EXECUTE FUNCTION admin_audit_append_only();
