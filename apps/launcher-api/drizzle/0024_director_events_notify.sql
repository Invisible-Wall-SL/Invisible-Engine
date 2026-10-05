-- Invisible Director live stream (ADR-0003): every director_events insert announces itself on the
-- `director_events` channel as `<run_id>:<id>`, so the launcher's SSE route tails the table without
-- knowing who inserted (the worker, the atlas callback, a form action). The worker's own wake-up
-- channel (`director_wake`, PLAN 3.5) is separate: it fires only for the kinds a worker acts on.
CREATE OR REPLACE FUNCTION director_events_notify() RETURNS trigger AS $$
BEGIN
	PERFORM pg_notify('director_events', NEW.run_id || ':' || NEW.id);
	RETURN NULL;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS director_events_notify ON "director_events";
--> statement-breakpoint
CREATE TRIGGER director_events_notify AFTER INSERT ON "director_events"
	FOR EACH ROW EXECUTE FUNCTION director_events_notify();
