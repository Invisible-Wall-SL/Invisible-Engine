/**
 * In-memory "last activity" clock for the ComfyUI R&D pod's idle auto-stop.
 *
 * A single module-level timestamp, bumped whenever an entitled user touches the pod
 * (opens/starts it, or the tab heartbeat pings). The idle watchdog compares
 * `lastActivity()` against `now` to decide whether the pod has been idle long enough
 * to stop. This is intentionally process-local and resets on redeploy — that's
 * acceptable: a redeploy just grants a fresh idle window (see the watchdog).
 */

let lastActivityAt = Date.now();

/** Record that the pod was just used, resetting the idle countdown. */
export function markActivity(): void {
	lastActivityAt = Date.now();
}

/** Epoch millis of the most recent activity. */
export function lastActivity(): number {
	return lastActivityAt;
}
