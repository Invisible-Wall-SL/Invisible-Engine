-- Wake the Director worker (ADR-0003, Amendments): every row that needs the worker to act — the
-- owner's rows and finished GPU jobs — sends NOTIFY director_wake with the run id, from the same
-- transaction that inserts it, so a writer can never insert one and forget to notify. The worker's
-- own rows (activity, run_status, …) do not wake it. The kinds match WAKING_KINDS in
-- services/director-worker/src/lease.ts.
CREATE OR REPLACE FUNCTION director_events_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM pg_notify('director_wake', NEW.run_id);
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER director_events_wake
	AFTER INSERT ON director_events
	FOR EACH ROW
	WHEN (NEW.kind IN ('owner_message', 'owner_request', 'checkpoint_resolved', 'job_done'))
	EXECUTE FUNCTION director_events_wake();
