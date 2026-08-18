import { getCosts } from './index';
import { madridMonth, startOfMadridMonth } from './months';

/**
 * Keeps the monthly cost history honest when nobody is looking.
 *
 * The monthly table records the open month from whatever the live snapshot last
 * reported, and freezes it once the month ends. On page views alone that has a real
 * hole: if nobody opens Admin → Costs during the last days of a month, the month locks
 * missing those days. This recorder closes it by taking snapshots on a schedule, so
 * the figure is current regardless of traffic.
 *
 * Two timers, because the requirement has two halves:
 *
 * 1. **A periodic tick** (`TICK_MS`) keeps the open month roughly current all month, so
 *    the value standing at month end is never stale by more than one interval.
 * 2. **A month-boundary tick**, fired shortly after midnight Madrid on the 1st. This is
 *    what actually performs the lock — `recordAndLock` freezes a past month on the
 *    first snapshot taken after it ends, so firing right at the boundary means the
 *    locked figure is the one from minutes before month end rather than up to a full
 *    interval later. The periodic tick alone would eventually lock it too, just less
 *    precisely.
 *
 * Started ONCE from `hooks.server.ts#init`, alongside the migrations and the RunPod
 * idle watchdog. Everything is wrapped so a failure can never crash the server, and
 * the timers are `unref`'d so they never hold the process open by themselves.
 *
 * Safe to run in parallel with page views and with a second instance: `recordAndLock`
 * is an idempotent upsert keyed by (provider, year, month), and the lock is guarded by
 * `setWhere: isNull(lockedAt)` so a locked month is never revived.
 */

let started = false;

/**
 * Every 3 hours. The open month therefore trails reality by at most that, and it costs
 * ~8 rounds of provider calls a day — cheap against APIs we already poll on page view,
 * and the snapshot cache means a page view in between reuses the same result.
 */
const TICK_MS = 3 * 60 * 60 * 1000;

/**
 * How long after midnight to take the boundary snapshot. A few minutes of slack so the
 * clock is unambiguously inside the new month before we ask anything to lock.
 */
const BOUNDARY_SLACK_MS = 5 * 60 * 1000;

/**
 * `setTimeout` silently fires IMMEDIATELY for delays past ~24.8 days (the 32-bit
 * overflow), which for a monthly timer would mean a hot loop instead of a monthly
 * wake-up. Chunk anything longer.
 */
const MAX_TIMEOUT_MS = 20 * 24 * 60 * 60 * 1000;

export function startCostRecorder(): void {
	if (started) return;
	started = true;

	const timer = setInterval(() => void tick('periodic'), TICK_MS);
	if (typeof timer.unref === 'function') timer.unref();

	scheduleBoundary();

	// One snapshot at boot: a deploy that lands just after a month rollover should lock
	// the previous month straight away rather than waiting for the first tick.
	void tick('boot');
}

/** Take a snapshot, forcing past the cache so the recorded figure is genuinely fresh. */
async function tick(reason: string): Promise<void> {
	try {
		await getCosts(true);
	} catch (err) {
		// Fail-safe: this is a background bookkeeping job. It must never crash the
		// server, and a failed tick just means the next one does the work.
		console.warn(
			`[costs] scheduled snapshot (${reason}) failed:`,
			err instanceof Error ? err.message : err,
		);
	}
}

/** Arm a one-shot timer for just after the next Madrid month boundary, then re-arm. */
function scheduleBoundary(): void {
	const now = new Date();
	const { year, month } = madridMonth(now);
	const nextStart = startOfMadridMonth(
		month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 },
	);
	const delay = nextStart.getTime() + BOUNDARY_SLACK_MS - now.getTime();

	if (delay > MAX_TIMEOUT_MS) {
		// Too far out for one timer — wake early and recompute rather than overflow.
		const t = setTimeout(scheduleBoundary, MAX_TIMEOUT_MS);
		if (typeof t.unref === 'function') t.unref();
		return;
	}

	const t = setTimeout(
		() => {
			void tick('month-boundary').finally(scheduleBoundary);
		},
		// A negative delay (clock skew, or arming exactly on the boundary) would fire
		// immediately and re-arm in a tight loop; floor it at one minute.
		Math.max(delay, 60_000),
	);
	if (typeof t.unref === 'function') t.unref();
}
