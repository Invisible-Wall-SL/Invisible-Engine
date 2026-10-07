import { ENV } from '../env';
import type { DirectorAtlasJob } from '../db/schema';
import { requireProjectScope } from '../toolScope';
import { isDirectorAgent, type AdapterContext } from './adapter';
import { mintCallbackToken } from './atlasCallback';
import { atlasFetch, type AtlasCaller } from './atlasClient';
import { getAtlasJob, getRun, getRunOwner, queuedAtlasJobs, settleAtlasJob } from './store';

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

/**
 * A render's GPU time as atlas-tool reports it (`still_jobs.runpod_summary`), in the shape the
 * worker bills from (ADR-0006): `result.runpod = { gpu, seconds, jobs, unreported }`, the
 * seconds × the GPU's $/s in `pricing.json`, and the unreported jobs as an estimate. The price
 * never travels on the wire; only the time does.
 */
export interface RunpodUsage {
	/** The GPU the jobs ran on, as `pricing.json` names it; null when atlas-tool could not name
	 *  one (`RUNPOD_ENDPOINT_GPU` unset, or jobs on different cards), so nothing is priced by a
	 *  guess — and the worker blocks the run's GPU submits until the owner sets it. */
	gpu: string | null;
	/** Billed seconds, execution plus delay (RunPod bills the worker's uptime, cold start
	 *  included), summed over the jobs that reported a time. */
	seconds: number;
	executionSeconds?: number;
	delaySeconds?: number;
	/** Jobs that reported a time, and RunPod jobs that ended without one (billed as an estimate). */
	jobs?: number;
	unreported?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** `runpod` as the worker may read it, or null when it is not that shape. */
export function runpodUsageOf(raw: unknown): RunpodUsage | null {
	if (!isRecord(raw)) return null;
	const seconds = count(raw.seconds);
	if (seconds === null) return null;
	const gpu = typeof raw.gpu === 'string' && raw.gpu.trim() ? raw.gpu.trim() : null;
	const usage: RunpodUsage = { gpu, seconds };
	for (const key of ['executionSeconds', 'delaySeconds', 'jobs', 'unreported'] as const) {
		const n = count(raw[key]);
		if (n !== null) usage[key] = n;
	}
	return usage;
}

/** Why a finished render has nothing the worker can bill; its GPU time then never counts. */
function unbilledReason(status: TerminalStatus, runpod: RunpodUsage | null): string | undefined {
	if (status !== 'finished' || runpod?.gpu) return undefined;
	return runpod
		? `finished with ${runpod.seconds} s of GPU time but no GPU named (set RUNPOD_ENDPOINT_GPU on atlas-tool)`
		: 'finished without reporting its GPU time';
}

/**
 * The result as the run's `job_done` carries it: atlas-tool's message with `runpod` reduced to
 * `RunpodUsage`, or without it when it is not one.
 */
function billable(done: { status: TerminalStatus; result: unknown }): {
	result: unknown;
	unbilled?: string;
} {
	if (!isRecord(done.result)) return { result: done.result };
	const { runpod: raw, ...rest } = done.result;
	const runpod = runpodUsageOf(raw);
	return {
		result: runpod ? { ...rest, runpod } : rest,
		unbilled: unbilledReason(done.status, runpod),
	};
}

/** Settle `jobRef` of `runId` — the single path both signals take. */
export async function recordJobDone(done: {
	jobRef: string;
	runId: string;
	status: TerminalStatus;
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<JobDone> {
	const { result, unbilled } = billable(done);
	const job = await settleAtlasJob({ ...done, result });
	if (job) {
		if (unbilled) console.warn(`director atlas job ${done.jobRef}: ${unbilled}; nothing to bill`);
		return { recorded: true, job };
	}
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
	/** The GPU time so far (`RunpodUsage` once validated); absent until a job reports one. */
	runpod?: unknown;
	error?: string;
}

export async function readJobView(ctx: AtlasCaller, jobRef: string): Promise<JobView> {
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
 * The fallback: poll until the job settles by either signal, or the resume window passes, counted
 * from when the render was queued (`queuedAt`, else now). Stops as soon as the job is no longer
 * queued (the callback won). A read that fails is retried on the next tick; it never settles the
 * job by itself.
 */
export async function watchAtlasJob(
	job: { jobRef: string; runId: string; queuedAt?: Date },
	deps: WatchDeps,
): Promise<JobDone | null> {
	const start = job.queuedAt?.getTime() ?? deps.now();
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

/** Start the fallback for a render just queued. In-process: a launcher restart drops it, and
 *  `resumeAtlasJobWatches` arms it again at boot. */
export function startAtlasJobWatch(ctx: AdapterContext, jobRef: string): void {
	armWatch({ jobRef, runId: ctx.run.id }, ctx);
}

function armWatch(
	job: { jobRef: string; runId: string; queuedAt?: Date },
	caller: AtlasCaller | null,
) {
	void watchAtlasJob(job, {
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
		read: async (ref) => {
			if (!caller)
				throw new Error("the run, its owner or the owner's access to its project is gone");
			return readJobView(caller, ref);
		},
		now: Date.now,
	}).catch((e) => console.error(`director atlas job ${job.jobRef}: fallback watch failed:`, e));
}

/** Who a recorded render is read as: its run's owner in the run's project, or null when gone. */
async function callerOf(job: DirectorAtlasJob): Promise<AtlasCaller | null> {
	const run = await getRun(job.runId);
	const owner = run && (await getRunOwner(run.ownerUserId));
	if (!run || !owner || !isDirectorAgent(job.agent)) return null;
	const scope = await requireProjectScope(owner, run.projectKey).catch(() => null);
	return scope ? { run, owner, agent: job.agent, scope } : null;
}

/**
 * Arm the fallback again for every render still queued, at launcher boot. The watches live in the
 * process, so a restart drops them, and a render whose callback is lost would stay queued (holding
 * the region step and a stop) until atlas-tool restarts. Each keeps its window from when the
 * render was queued; one that can no longer be read as its owner is recorded failed when the
 * window passes, never left queued.
 */
export async function resumeAtlasJobWatches(arm = armWatch): Promise<number> {
	const queued = await queuedAtlasJobs();
	for (const job of queued) arm(job, await callerOf(job));
	return queued.length;
}
