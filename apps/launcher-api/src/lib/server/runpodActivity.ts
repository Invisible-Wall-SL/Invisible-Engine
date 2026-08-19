/**
 * In-memory activity clock + session lease for the ComfyUI R&D pod's idle auto-stop.
 *
 * Two signals, both fleet-wide (only one pod is meant to run at a time):
 *
 * - **The clock** — bumped whenever an entitled user touches the pod (starts it, or the
 *   /comfyui tab heartbeats). The watchdog compares it against `now` to decide whether
 *   the fleet has been idle long enough to stop.
 * - **The lease** — granted when the artist opens ComfyUI itself. The heartbeat is
 *   gated on the launcher tab being *visible*, but opening ComfyUI moves the artist to
 *   a different tab, so the heartbeat goes silent exactly when the pod is being used
 *   most. Without a lease the only thing left holding the pod is a busy render queue —
 *   which says nothing while a network is being BUILT. The lease is that missing
 *   "someone is working" signal, time-bounded so a forgotten tab still frees the GPU.
 *
 * Both are intentionally process-local and reset on redeploy — acceptable, since a
 * redeploy just grants a fresh idle window (see the watchdog).
 */

/** How long an "Open ComfyUI" click holds the fleet, regardless of queue state. */
export const OPEN_LEASE_MS = 60 * 60_000;

let lastActivityAt = Date.now();
let leaseUntilAt = 0;

/** Record that the pod was just used, resetting the idle countdown. */
export function markActivity(): void {
	lastActivityAt = Date.now();
}

/** Epoch millis of the most recent activity. */
export function lastActivity(): number {
	return lastActivityAt;
}

/**
 * Hold the fleet for `OPEN_LEASE_MS`. Extends an existing lease rather than shortening
 * it, so re-opening ComfyUI mid-session can only ever buy more time.
 */
export function grantLease(): void {
	leaseUntilAt = Math.max(leaseUntilAt, Date.now() + OPEN_LEASE_MS);
	markActivity();
}

/** Drop any session lease (an explicit Stop — the artist is done). */
export function clearLease(): void {
	leaseUntilAt = 0;
}

/** Whether a session lease is still holding the fleet. */
export function leaseActive(): boolean {
	return Date.now() < leaseUntilAt;
}

/** Whole minutes left on the lease (0 when none is active) — surfaced in the UI. */
export function leaseMinutesLeft(): number {
	return Math.max(0, Math.ceil((leaseUntilAt - Date.now()) / 60_000));
}
