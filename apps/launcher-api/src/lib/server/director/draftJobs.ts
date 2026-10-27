import { ENV } from '../env';
import type { DirectorDraftJob } from '../db/schema';
import { projectGameType } from '../projects';
import { getObjectText, listAllKeys, presignGet, presignPut } from '../r2';
import { requireProjectScope } from '../toolScope';
import { SHARED_RUNTIME_ID } from '../testServerManifest';
import { mintCallbackToken, DRAFT_TOKEN_SCOPE } from './atlasCallback';
import { SIGNATURE_HEADER, signDraftRequest } from './draftSigning';
import { screenshotSlots } from './draftScripts';
import { isTerminal, type TerminalStatus } from './atlasJobs';
import {
	NO_PLAYER_RESULT,
	draftPrefix,
	getDraftPlayer,
	type DraftPlayJob,
	type DraftPlayer,
	type DraftProgress,
} from './drafts';
import {
	draftJobsToCancel,
	getDraftJob,
	getRun,
	getRunOwner,
	queuedDraftJobs,
	settleDraftJob,
} from './store';

/**
 * Settling a QA play (ADR-0010 §3). The draft player's signed callback is the primary signal and
 * a `/progress?jobRef=` watch on a 60/120/240 s backoff is the fallback; both settle through
 * `settleDraftJob`, which records the run's `job_done` exactly once. The HTTP client to the player
 * lives here too, behind the `DraftPlayer` seam (`drafts.ts`) so every path runs with no network.
 */

export const CALLBACK_PATH = '/api/director/drafts/callback';
/** The play window (30 min after queueing) plus slack: the token outlives the watch. */
export const CALLBACK_TOKEN_TTL_SECONDS = 2 * 3600;
/** Presigned URLs handed to the player. */
const PRESIGN_TTL_SECONDS = 3600;
/** What the player gets of a draft folder: never the reports and shots of earlier plays. */
const isDraftFile = (path: string) =>
	path === 'runtime.json' || path === 'draft.json' || path.startsWith('deploy/');
/** Screenshots the player may upload per play. */
export const MAX_SHOTS = 40;

/** The one URL a run's play callbacks go to. The token binds it, so the run id is signed too. */
export function draftCallbackUrl(runId: string): string {
	return `${ENV.ORIGIN.replace(/\/$/, '')}${CALLBACK_PATH}?run=${encodeURIComponent(runId)}`;
}

export type DraftDone =
	| { recorded: true; job: DirectorDraftJob }
	| { recorded: false; reason: 'duplicate' | 'unknown_job' };

/** Settle `jobRef` of `runId` — the single path every signal takes. */
export async function recordDraftDone(done: {
	jobRef: string;
	runId: string;
	status: TerminalStatus;
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<DraftDone> {
	const job = await settleDraftJob(done);
	if (job) return { recorded: true, job };
	const existing = await getDraftJob(done.jobRef);
	return existing && existing.runId === done.runId
		? { recorded: false, reason: 'duplicate' }
		: { recorded: false, reason: 'unknown_job' };
}

/**
 * The HTTP client to `services/draft-player` (its `server.mjs` is the contract). Every request is
 * signed with the shared secret over its method, path+query and raw body (`draftSigning.ts`). The
 * player holds no R2 or database credential: the body carries presigned https URLs, which are
 * never logged, and neither is the secret.
 */
export function createHttpDraftPlayer(
	opts: { url: string; secret: string; fetch?: typeof fetch },
	files: (prefix: string) => Promise<string[]> = listAllKeys,
): DraftPlayer {
	const doFetch = opts.fetch ?? fetch;
	const send = (method: 'GET' | 'POST', target: string, body = '') =>
		doFetch(`${opts.url}${target}`, {
			method,
			headers: {
				...(body ? { 'content-type': 'application/json' } : {}),
				[SIGNATURE_HEADER]: signDraftRequest(opts.secret, method, target, body),
			},
			...(body ? { body } : {}),
		});

	const presignAll = async (prefix: string, keep: (path: string) => boolean = () => true) =>
		Promise.all(
			(await files(prefix))
				.filter((key) => keep(key.slice(prefix.length)))
				.map(async (key) => ({
					path: key.slice(prefix.length),
					url: await presignGet(key, PRESIGN_TTL_SECONDS),
				})),
		);

	return {
		async submit(job) {
			const prefix = draftPrefix(job.clientKey, job.projectKey, job.draftId);
			const meta = JSON.parse((await getObjectText(`${prefix}draft.json`)) ?? 'null') as {
				runtime: { version: string; commit: string };
				contract: unknown;
			} | null;
			if (!meta) throw new Error(`draft ${job.draftId} has no draft.json`);
			const runtimePrefix = `test_server/_runtime/${SHARED_RUNTIME_ID}@${meta.runtime.version}/`;
			const callbackUrl = draftCallbackUrl(job.runId);
			const playPrefix = `${prefix}plays/${job.jobRef}/`;
			const slots = screenshotSlots(job.gameType, job.scenarios).slice(0, MAX_SHOTS);
			const body = JSON.stringify({
				jobRef: job.jobRef,
				kind: job.gameType,
				contract: meta.contract,
				...(job.scenarios ? { scenarios: job.scenarios } : {}),
				draft: { files: await presignAll(prefix, isDraftFile) },
				runtime: {
					version: meta.runtime.version,
					commit: meta.runtime.commit,
					files: await presignAll(runtimePrefix),
				},
				put: {
					report: await presignPut(
						`${playPrefix}report.json`,
						'application/json',
						PRESIGN_TTL_SECONDS,
					),
					shots: await Promise.all(
						slots.map(async ({ scenario, screen }) => {
							const key = `${playPrefix}${scenario}-${screen}.png`;
							return {
								scenario,
								screen,
								key,
								url: await presignPut(key, 'image/png', PRESIGN_TTL_SECONDS),
							};
						}),
					),
				},
				callback: {
					url: callbackUrl,
					token: mintCallbackToken(
						opts.secret,
						callbackUrl,
						CALLBACK_TOKEN_TTL_SECONDS,
						Date.now(),
						DRAFT_TOKEN_SCOPE,
					),
				},
			});
			const res = await send('POST', '/play', body);
			if (res.status !== 202) {
				throw new Error(`the draft player answered ${res.status} to /play`);
			}
		},
		async progress(jobRef) {
			const res = await send('GET', `/progress?jobRef=${encodeURIComponent(jobRef)}`);
			if (!res.ok) throw new Error(`the draft player answered ${res.status} to /progress`);
			return (await res.json()) as DraftProgress;
		},
		async cancel(jobRef) {
			await send('POST', '/cancel', JSON.stringify({ jobRef }));
		},
	};
}

/** What a callback or `/progress` says of a finished or failed play, as the run's `job_done` result. */
export function playResultOf(view: { status: string; report?: unknown; error?: unknown }): unknown {
	if (view.status === 'finished') return view.report ?? {};
	return {
		reason: 'play_failed',
		message: `The draft player could not play the draft${view.error ? `: ${String(view.error)}` : '.'}`,
		error: view.error ?? null,
	};
}

/** The deployed player: the fixture's seam first, else the one `DRAFT_PLAYER_URL` names, else none. */
export function activeDraftPlayer(): DraftPlayer | null {
	const seam = getDraftPlayer();
	if (seam) return seam;
	const { DRAFT_PLAYER_URL: url, DRAFT_PLAYER_SECRET: secret } = ENV;
	return url && secret ? createHttpDraftPlayer({ url, secret }) : null;
}

/** Seconds between fallback reads: late enough that the callback usually lands first. */
export const DRAFT_POLL_BACKOFF_SECONDS = [60, 120, 240] as const;
/** Past this a play is recorded failed (`timeout`). */
export const DRAFT_GIVE_UP_SECONDS = 30 * 60;

export interface DraftWatchDeps {
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	progress: (jobRef: string) => Promise<DraftProgress>;
	/** Submit the play again, for a player that restarted and no longer knows it. */
	resubmit: (jobRef: string) => Promise<void>;
	/** Stop the play on the player, when the watch gives up on it. Best-effort. */
	cancel?: (jobRef: string) => Promise<void>;
}

/** Tell the player a play is no longer wanted. An error is logged, never thrown. */
async function cancelOnPlayer(
	cancel: ((jobRef: string) => Promise<void>) | undefined,
	jobRef: string,
): Promise<void> {
	if (!cancel) return;
	try {
		await cancel(jobRef);
	} catch (e) {
		console.error(`director draft job ${jobRef}: the player's /cancel failed:`, e);
	}
}

/**
 * The fallback: read the player until the job settles by either signal. A player that does not
 * know the job (it restarted) is asked once more; unknown again, the play is recorded failed
 * (`player_lost`). Gives up 30 min after `queuedAt` (`timeout`). A read that fails is retried on
 * the next tick and never settles the job by itself.
 */
export async function watchDraftJob(
	job: { jobRef: string; runId: string; queuedAt?: Date },
	deps: DraftWatchDeps,
): Promise<DraftDone | null> {
	const start = job.queuedAt?.getTime() ?? deps.now();
	let resubmitted = false;
	// A play the watch gives up on must not keep running on the player.
	const fail = async (reason: string, message: string) => {
		const done = await recordDraftDone({
			...job,
			status: 'failed',
			result: { reason, message },
			via: 'poll',
		});
		await cancelOnPlayer(deps.cancel, job.jobRef);
		return done;
	};
	for (let i = 0; ; i++) {
		const wait = DRAFT_POLL_BACKOFF_SECONDS[Math.min(i, DRAFT_POLL_BACKOFF_SECONDS.length - 1)];
		await deps.sleep(wait * 1000);
		const giveUp = (deps.now() - start) / 1000 > DRAFT_GIVE_UP_SECONDS;
		try {
			if ((await getDraftJob(job.jobRef))?.status !== 'queued') return null;
			const view = await deps.progress(job.jobRef);
			if (isTerminal(view.status)) {
				return await recordDraftDone({
					...job,
					status: view.status,
					result: playResultOf(view),
					via: 'poll',
				});
			}
			if (view.status === 'unknown') {
				if (resubmitted) {
					return await fail(
						'player_lost',
						'The draft player lost the play and could not replay it.',
					);
				}
				resubmitted = true;
				await deps.resubmit(job.jobRef);
			}
		} catch (e) {
			if (!giveUp) continue;
			console.error(`director draft job ${job.jobRef}: last read failed:`, e);
		}
		if (giveUp) return fail('timeout', 'The draft was not played within 30 minutes.');
	}
}

/** The play a recorded job asks for, as its run's owner may see it; null when the run is gone. */
async function playJobOf(job: DirectorDraftJob): Promise<DraftPlayJob | null> {
	const run = await getRun(job.runId);
	const owner = run && (await getRunOwner(run.ownerUserId));
	if (!run || !owner) return null;
	const scope = await requireProjectScope(owner, run.projectKey).catch(() => null);
	if (!scope) return null;
	return {
		jobRef: job.jobRef,
		runId: job.runId,
		clientKey: scope.clientKey,
		projectKey: scope.projectKey,
		gameType: await projectGameType(scope.projectKey),
		draftId: job.draftId,
		scenarios: job.scenarios,
	};
}

/** Start the fallback for a play just queued. In-process: `resumeDraftJobWatches` re-arms at boot. */
export function armDraftWatch(
	job: { jobRef: string; runId: string; queuedAt?: Date },
	player: DraftPlayer,
	row: DirectorDraftJob | null,
): void {
	if (!player.progress) return;
	const progress = player.progress.bind(player);
	void watchDraftJob(job, {
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
		now: Date.now,
		progress,
		resubmit: async (jobRef) => {
			const play = row ? await playJobOf(row) : null;
			if (!play) throw new Error(`draft job ${jobRef}: its run or project is gone`);
			await player.submit(play);
		},
		cancel: player.cancel?.bind(player),
	}).catch((e) => console.error(`director draft job ${job.jobRef}: fallback watch failed:`, e));
}

/**
 * The owner stopped the run: settle its queued plays `cancelled` through the same exactly-once
 * path and tell the player to drop them, best-effort. The worker's own stop flips the same rows
 * (`cancelQueuedDrafts`), both conditional on `queued`, so whichever comes first wins and the
 * other is a no-op; the player is told either way. Returns how many plays it asked the player to
 * cancel.
 */
export async function cancelRunDraftPlays(
	runId: string,
	player: DraftPlayer | null = activeDraftPlayer(),
): Promise<number> {
	const jobs = await draftJobsToCancel(runId);
	for (const job of jobs) {
		if (job.status === 'queued') {
			await settleDraftJob({
				jobRef: job.jobRef,
				runId,
				status: 'cancelled',
				result: { reason: 'run_stopped', message: 'The owner stopped the run.' },
				via: 'inline',
			}).catch((e) => console.error(`director draft job ${job.jobRef}: not cancelled:`, e));
		}
		await cancelOnPlayer(player?.cancel?.bind(player), job.jobRef);
	}
	return jobs.length;
}

/** Between the boot re-arms, so a restart does not read every queued play at once. */
export const DRAFT_REARM_STAGGER_MS = 2000;

/**
 * Arm the fallback again for every play still queued, at launcher boot: the watches live in the
 * process. Each keeps its 30 min window from when it was queued. One row that cannot be armed
 * leaves the others armed; with no player deployed a queued row is settled `no_player`.
 */
export async function resumeDraftJobWatches(
	arm: typeof armDraftWatch = armDraftWatch,
	stagger: (i: number) => Promise<void> = (i) =>
		new Promise((resolve) => setTimeout(resolve, i * DRAFT_REARM_STAGGER_MS).unref()),
): Promise<number> {
	const queued = await queuedDraftJobs();
	let armed = 0;
	for (const [i, job] of queued.entries()) {
		try {
			await stagger(i);
			const player = activeDraftPlayer();
			if (!player) {
				await settleDraftJob({
					jobRef: job.jobRef,
					runId: job.runId,
					status: 'failed',
					result: NO_PLAYER_RESULT,
					via: 'poll',
				});
				continue;
			}
			arm(job, player, job);
			armed++;
		} catch (e) {
			console.error(`director draft job ${job.jobRef}: not re-armed:`, e);
		}
	}
	return armed;
}
