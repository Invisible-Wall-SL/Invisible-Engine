import { ENV } from '../env';
import type { DirectorAtlasJob } from '../db/schema';
import type { AdapterContext } from './adapter';
import { mintCallbackToken } from './atlasCallback';
import { atlasFetch } from './atlasClient';
import { getAtlasJob, settleAtlasJob } from './store';

/**
 * When an Atlas Maker still render a Director run queued is DONE (ADR-0002 "GPU jobs"). Completion
 * is detected in code, never by the model: atlas-tool's signed callback is the primary signal, and
 * a `/progress?jobRef=` poll on a backoff is the fallback for a callback that never arrives. Either
 * one settles the job through `settleAtlasJob`, which records the run's `job_done` exactly once.
 */

export const JOB_REF = '^st_[0-9a-f]{16}$';
export const TERMINAL = ['finished', 'failed', 'cancelled'] as const;
export type TerminalStatus = (typeof TERMINAL)[number];
export const isTerminal = (s: unknown): s is TerminalStatus =>
	typeof s === 'string' && (TERMINAL as readonly string[]).includes(s);

/** atlas-tool resumes a render for 12 h (`STILL_RESUME_WINDOW_HOURS`); its token lives as long. */
export const CALLBACK_TOKEN_TTL_SECONDS = 12 * 3600;
export const CALLBACK_PATH = '/api/director/atlas/callback';

/** The one URL a run's callbacks go to. The token binds it, so the run id in it is signed too. */
export function callbackUrlFor(runId: string): string {
	return `${ENV.ORIGIN.replace(/\/$/, '')}${CALLBACK_PATH}?run=${encodeURIComponent(runId)}`;
}

/** `{callbackUrl, callbackToken}` for `/render`, or nothing while the secret is unset. */
export function callbackFor(runId: string, now = Date.now()) {
	const secret = ENV.ATLAS_CALLBACK_SECRET;
	if (!secret) return null;
	const callbackUrl = callbackUrlFor(runId);
	return {
		callbackUrl,
		callbackToken: mintCallbackToken(secret, callbackUrl, CALLBACK_TOKEN_TTL_SECONDS, now),
	};
}

export type JobDone =
	| { recorded: true; job: DirectorAtlasJob }
	| { recorded: false; reason: 'duplicate' | 'unknown_job' };

/** Settle `jobRef` of `runId` — the single path both signals take. */
export async function recordJobDone(done: {
	jobRef: string;
	runId: string;
	status: TerminalStatus;
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<JobDone> {
	const job = await settleAtlasJob(done);
	if (job) return { recorded: true, job };
	const existing = await getAtlasJob(done.jobRef);
	return existing && existing.runId === done.runId
		? { recorded: false, reason: 'duplicate' }
		: { recorded: false, reason: 'unknown_job' };
}

/** What `/progress?jobRef=` says about a render (`still_jobs.job_view`, token stripped). */
export interface JobView {
	jobRef: string;
	status: string;
	total?: number;
	names?: string[];
	variants?: { region: string; variant: string; slot: number }[];
	jobs?: { seq: number; region: string; status: string }[];
	error?: string;
}

export async function readJobView(ctx: AdapterContext, jobRef: string): Promise<JobView> {
	const answer = await atlasFetch(ctx, { method: 'GET', path: '/progress', query: { jobRef } });
	return answer.json<JobView>();
}

/** Seconds between fallback polls: late enough that the callback usually lands first. */
export const POLL_BACKOFF_SECONDS = [60, 120, 240, 480, 900] as const;
/** Past this the render cannot be resumed by atlas-tool, so it is recorded failed. */
export const POLL_GIVE_UP_SECONDS = CALLBACK_TOKEN_TTL_SECONDS;

export interface WatchDeps {
	sleep: (ms: number) => Promise<void>;
	read: (jobRef: string) => Promise<JobView>;
	now: () => number;
}

/**
 * The fallback: poll until the job settles by either signal, or the resume window passes. Stops as
 * soon as the job is no longer queued (the callback won). A read that fails is retried on the
 * next tick; it never settles the job by itself.
 */
export async function watchAtlasJob(
	job: { jobRef: string; runId: string },
	deps: WatchDeps,
): Promise<JobDone | null> {
	const start = deps.now();
	for (let i = 0; ; i++) {
		const wait = POLL_BACKOFF_SECONDS[Math.min(i, POLL_BACKOFF_SECONDS.length - 1)];
		await deps.sleep(wait * 1000);
		const giveUp = (deps.now() - start) / 1000 > POLL_GIVE_UP_SECONDS;
		// Any failure — atlas-tool, a bad body, the database — is retried on the next tick.
		try {
			if ((await getAtlasJob(job.jobRef))?.status !== 'queued') return null;
			const view = await deps.read(job.jobRef);
			if (isTerminal(view.status)) {
				return await recordJobDone({ ...job, status: view.status, result: view, via: 'poll' });
			}
		} catch (e) {
			if (!giveUp) continue;
			console.error(`director atlas job ${job.jobRef}: last read failed:`, e);
		}
		if (giveUp) {
			return recordJobDone({
				...job,
				status: 'failed',
				result: { error: 'No completion within the resume window.' },
				via: 'poll',
			});
		}
	}
}

/** Start the fallback for a render just queued. In-process: a launcher restart drops it, which
 *  costs only the fallback — atlas-tool redelivers an undelivered callback at its own boot. */
export function startAtlasJobWatch(ctx: AdapterContext, jobRef: string): void {
	void watchAtlasJob(
		{ jobRef, runId: ctx.run.id },
		{
			sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
			read: (ref) => readJobView(ctx, ref),
			now: Date.now,
		},
	).catch((e) => console.error(`director atlas job ${jobRef}: fallback watch failed:`, e));
}
