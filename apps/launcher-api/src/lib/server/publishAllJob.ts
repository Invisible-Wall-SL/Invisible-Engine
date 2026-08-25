/**
 * Bulk re-publish for the Invisible Game Maker: republish MANY games in one action instead of
 * opening every project and pressing Re-publish. The case it exists for is an engine release —
 * the shared `_runtime/lines` bundle ships on every merge, and every published game then needs
 * its publish flow re-run (re-export → cache invalidate → manifest stamp → test-server refresh)
 * before it is reconciled onto the new engine.
 *
 * Shape: ONE in-memory job at a time, run in the BACKGROUND (the walk itself lives in
 * `publishAllRunner.ts`).
 *
 *   - background, not a long request: a publish re-runs all seven exporters (~17-19s per project
 *     measured), so a 20-game run outlives any sensible request timeout and would force the author
 *     to keep the tab open. The job survives navigation; the page polls and re-attaches.
 *   - one at a time: two overlapping runs would only queue the same work twice.
 *
 * NOTE it deliberately does NOT pin the session's active project the way the single-project
 * endpoint does. That pin exists because publishing one game is an explicit statement about WHICH
 * game you mean; a bulk run is a statement about all of them, so moving the selection to whichever
 * game happened to be last would be a footgun, not a convenience.
 *
 * The job lives in process memory: a launcher restart mid-run loses the progress view, and the
 * games already republished stay republished (each publish is atomic on its own). Re-running the
 * action after a restart is the recovery — it is idempotent.
 */
import { publishGame } from './publishGame';
import { runPublishAll, type PublishAllJob } from './publishAllRunner';

export type { PublishAllItem, PublishAllItemStatus, PublishAllJob } from './publishAllRunner';

/** The current or most-recently-finished job. Kept after finishing so the UI can read results. */
let current: PublishAllJob | null = null;

export function currentPublishAllJob(): PublishAllJob | null {
	return current;
}

export function publishAllRunning(): boolean {
	return current !== null && current.finishedAt === null;
}

/** Ask the in-flight job to stop after the game it is publishing. Returns false if none. */
export function requestPublishAllCancel(id?: string): boolean {
	if (!current || current.finishedAt !== null) return false;
	if (id && id !== current.id) return false;
	current.cancelRequested = true;
	return true;
}

/** Thrown when a bulk run is asked for while one is already in flight. */
export class PublishAllBusyError extends Error {
	constructor() {
		super('A bulk republish is already running.');
		this.name = 'PublishAllBusyError';
	}
}

/**
 * Start the run and return immediately with the job in its initial (all-pending) state.
 * `targets` is the resolved, access-checked list — this module never decides WHICH games to
 * publish, only that they are walked one at a time.
 */
export function startPublishAllJob(options: {
	targets: { key: string; name: string }[];
	scope: 'stale' | 'published';
	launcherOrigin: string;
	startedBy: string;
}): PublishAllJob {
	if (publishAllRunning()) throw new PublishAllBusyError();

	const job: PublishAllJob = {
		id: crypto.randomUUID(),
		scope: options.scope,
		startedAt: Date.now(),
		finishedAt: null,
		startedBy: options.startedBy,
		cancelRequested: false,
		items: options.targets.map((t) => ({ key: t.key, name: t.name, status: 'pending' })),
	};
	current = job;
	void runPublishAll(job, (key) => publishGame(key, options.launcherOrigin));
	return job;
}
