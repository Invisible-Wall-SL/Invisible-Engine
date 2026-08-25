/**
 * The walk of a bulk re-publish: publish each target in turn, classify the outcome, honour a
 * cancel. Split out from `publishAllJob.ts` — which owns the single-job registry — purely so it
 * imports NOTHING from the SvelteKit graph (no `$env`, no DB, no R2) and can therefore be run
 * against fixtures offline. The publisher is injected for the same reason.
 */
export type PublishAllItemStatus = 'pending' | 'running' | 'ok' | 'skipped' | 'error';

export interface PublishAllItem {
	key: string;
	name: string;
	status: PublishAllItemStatus;
	/** Failure reason, or the reason a game was skipped (e.g. it has its own desktop build). */
	message?: string;
	/** Wall-clock ms the publish took (finished items only). */
	ms?: number;
}

export interface PublishAllJob {
	id: string;
	/** What the run was asked to cover — echoed back so the UI can label it. */
	scope: 'stale' | 'published';
	startedAt: number;
	finishedAt: number | null;
	/** Who started it (email), so a second admin sees whose run is in flight. */
	startedBy: string;
	cancelRequested: boolean;
	items: PublishAllItem[];
}

/**
 * A publish that was REFUSED rather than failed — the game has its own desktop build, so the
 * online Game Maker must not overwrite it (`PublishBlockedError` in `publishGame.ts`). In bulk
 * that is an expected outcome for a mixed project list, so it reads as "skipped, here's why"
 * and never fails the run. Matched by `name`, which the error class assigns explicitly, so the
 * classification survives a minified server build and this module stays import-free.
 */
function isBlocked(e: unknown): boolean {
	return e instanceof Error && e.name === 'PublishBlockedError';
}

/**
 * Publish every pending item in order, mutating the job in place (the status endpoint reads the
 * same object, so progress is visible as it goes). Sequential on purpose: a publish re-runs all
 * seven exporters and is the launcher's most memory-hungry path — a parallel bake has OOM'd the
 * service before, and fan-out would also make the CAS retries on the shared test-server manifest
 * fight each other. A cancel stops BETWEEN games; the one in flight always finishes, because a
 * publish is a multi-step R2 + manifest write and aborting mid-way half-registers a game.
 */
export async function runPublishAll(
	job: PublishAllJob,
	publish: (key: string) => Promise<unknown>,
	now: () => number = Date.now,
): Promise<PublishAllJob> {
	for (const item of job.items) {
		if (job.cancelRequested) break;
		item.status = 'running';
		const started = now();
		try {
			await publish(item.key);
			item.status = 'ok';
		} catch (e) {
			if (isBlocked(e)) {
				item.status = 'skipped';
				item.message = e instanceof Error ? e.message : String(e);
			} else {
				item.status = 'error';
				item.message = e instanceof Error ? e.message : String(e);
				console.error(`publish-all: "${item.key}" failed:`, e);
			}
		}
		item.ms = now() - started;
	}
	job.finishedAt = now();
	return job;
}
