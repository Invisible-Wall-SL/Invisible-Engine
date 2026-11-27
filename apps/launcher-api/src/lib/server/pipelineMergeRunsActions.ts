import {
	MERGE_ACCEPT_LEASE_MS,
	MERGE_RUN_REASONS,
	MERGE_RUN_WORKFLOW,
	isMergeRunTitle,
	type MergeRunStatus,
} from '$lib/mergeMainRuns';
import { actionsRefusal } from '$lib/bugFixRuns';
import {
	cancelActionsRun,
	fixRunBot,
	messageOf,
	readActionsRun,
	type GhWorkflowRun,
} from './bugFixRunsActions';
import { ENV } from './env';
import { captureServerError } from './errorTracking';
import { GithubAppError, githubApp, type GithubApp } from './githubApp';
import { isPlainBranchName, refReadPath } from './githubPaths';
import {
	bindMergeRun,
	lapsedAccepts,
	markMergeRunRunning,
	releaseAccept,
	settleMergeRun,
	workingMergeRuns,
	type MergeMainRun,
} from './pipelineMergeRunsStore';

/**
 * The GitHub Actions side of Resolve conflict (ADR-0015 §2, §8): whether `merge-main.yml` is an
 * active workflow on `main` (until it is, the page shows no Resolve button), dispatching it through
 * the launcher's GitHub App, and the backstop that settles a run whose job died without posting. The
 * backstop runs in the fix runs' once-a-minute link sync (`bugReports.ts`); it has no loop of its
 * own (ground rule 8). A GitHub error on one read leaves that run for the next pass.
 */

const repo = (): string => ENV.GITHUB_ENGINE_REPO;

// ── Whether the workflow exists ───────────────────────────────────────────────

const READY_MS = 60_000;
const UNKNOWN_MS = 10_000;
let cached: { ready: boolean; until: number } | null = null;

/** Forget the answer (a fixture's, or after the workflow lands). */
export function forgetMergeWorkflow(): void {
	cached = null;
}

/**
 * Whether GitHub knows `merge-main.yml` as an active workflow on the default branch, which is what a
 * dispatch needs. Read from GitHub (Actions read) and kept for a minute, as `bugFixWorkflow.ts` keeps
 * `bug-fix.yml`; an unreachable GitHub or an unset App reads as "not yet" and is kept for 10 seconds.
 */
export async function mergeWorkflowReady(
	app: GithubApp = githubApp,
	nowMs = Date.now(),
): Promise<boolean> {
	if (cached && nowMs < cached.until) return cached.ready;
	let ready = false;
	let known = false;
	if (!app.missing()) {
		try {
			const res = await app.fetch(`/repos/${repo()}/actions/workflows/${MERGE_RUN_WORKFLOW}`);
			known = res.ok || res.status === 404;
			if (res.ok) {
				const body = (await res.json().catch(() => null)) as { state?: unknown } | null;
				ready = body?.state === 'active';
			}
		} catch {
			known = false;
		}
	}
	cached = { ready, until: nowMs + (known ? READY_MS : UNKNOWN_MS) };
	return ready;
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export type Dispatched =
	| { kind: 'sent'; ghRunId: number | null }
	| { kind: 'refused'; reason: string }
	| { kind: 'unknown' };

/**
 * Dispatch the workflow on `main` with ADR-0015 §10's inputs: the run's id, the pull request,
 * the head and `main`'s SHA, and the budget. All are public. GitHub answers 200 with the new run's id when asked
 * for it (`return_run_details`), else 204; a 422 naming that field is asked once more without it.
 * Only a definitive 4xx refuses the run; a timeout, a network error or a 5xx may still have started
 * one, so the run stays `dispatched` for the backstop to find or give up on.
 */
export async function dispatchMergeRun(
	app: GithubApp,
	run: MergeMainRun,
	budgetUsd: string,
): Promise<Dispatched> {
	const send = (details: boolean) =>
		app.fetch(`/repos/${repo()}/actions/workflows/${MERGE_RUN_WORKFLOW}/dispatches`, {
			method: 'POST',
			body: JSON.stringify({
				ref: 'main',
				inputs: {
					merge_run: run.id,
					pr: String(run.prNumber),
					head_sha: run.headSha,
					main_sha: run.mainSha,
					budget_usd: budgetUsd,
				},
				...(details ? { return_run_details: true } : {}),
			}),
		});
	let res: Response;
	try {
		res = await send(true);
		if (res.status === 422) {
			const message = await messageOf(res);
			if (!message.includes('return_run_details')) {
				return { kind: 'refused', reason: actionsRefusal(422, message, 'dispatching the run') };
			}
			res = await send(false);
		}
	} catch {
		return { kind: 'unknown' };
	}
	if (res.status === 404) return { kind: 'refused', reason: MERGE_RUN_REASONS.noWorkflow };
	if (res.status >= 400 && res.status < 500 && res.status !== 429) {
		return {
			kind: 'refused',
			reason: actionsRefusal(res.status, await messageOf(res), 'dispatching the run'),
		};
	}
	if (!res.ok) return { kind: 'unknown' };
	if (res.status === 204) return { kind: 'sent', ghRunId: null };
	const body = (await res.json().catch(() => null)) as { workflow_run_id?: unknown } | null;
	const ghRunId = body?.workflow_run_id;
	return {
		kind: 'sent',
		ghRunId: typeof ghRunId === 'number' && Number.isSafeInteger(ghRunId) ? ghRunId : null,
	};
}

/** The workflow's recent dispatched runs; none when `main` has no such workflow yet (404). */
async function listedRuns(app: GithubApp): Promise<GhWorkflowRun[]> {
	const res = await app.fetch(
		`/repos/${repo()}/actions/workflows/${MERGE_RUN_WORKFLOW}/runs?event=workflow_dispatch&per_page=50`,
	);
	if (res.status === 404) return [];
	if (!res.ok) {
		throw new GithubAppError(`GitHub ${res.status}: ${await messageOf(res)}`, res.status);
	}
	return ((await res.json()) as { workflow_runs?: GhWorkflowRun[] }).workflow_runs ?? [];
}

/** Discard's last look for a run settled unbound: its Actions run by title and bot, cancelled if live. */
export async function cancelListedMergeRun(app: GithubApp, id: string): Promise<void> {
	const [listed, bot] = await Promise.all([listedRuns(app), fixRunBot(app)]);
	const found = listed.find(
		(w) =>
			isMergeRunTitle(w.display_title, id) && w.actor?.login === bot && w.status !== 'completed',
	);
	if (found) await cancelActionsRun(app, found.id);
}

// ── The backstop ──────────────────────────────────────────────────────────────

/** A dispatched run GitHub never shows a run for is given up after this long. */
export const MERGE_DID_NOT_START_MS = 15 * 60_000;
/** Any run whose job has not posted is given up after this long. */
export const MERGE_TIMED_OUT_MS = 90 * 60_000;
/**
 * An Accept pushes only with at least this much of its lease left. One GitHub call can take about a
 * minute at worst (mint a token 15 s, call 15 s, a 401 re-mints 15 s, call again 15 s), so the
 * claim cannot lapse while the push is in flight: it started with >= 90 s left and ends within 60 s,
 * and a lapsed claim is only looked at after the whole lease (5 minutes).
 */
export const MERGE_ACCEPT_MIN_LEFT_MS = 90_000;
/** An Actions run may be stamped a little before the launcher stored its merge run. */
const BIND_SLACK_MS = 60_000;
/** Bound runs read per pass, oldest first: the rest wait a minute. */
const BOUND_READS = 10;

type Ending = { status: Exclude<MergeRunStatus, 'dispatched' | 'running'>; reason: string };
const WORKING: MergeRunStatus[] = ['dispatched', 'running'];

/**
 * Whether the branch's tip holds the merge commit an Accept recorded: it is that commit, or a person
 * pushed on top of it (ADR-0015 §5 expects that), so the commit is an ancestor of the tip
 * (`compare/<commit>...<tip>` is `ahead`). Never judged by parents or a message anyone can copy.
 */
export async function holdsMerge(app: GithubApp, acceptSha: string, tip: string): Promise<boolean> {
	if (tip === acceptSha) return true;
	const res = await app.fetch(`/repos/${repo()}/compare/${acceptSha}...${tip}`);
	if (res.status === 404 || res.status === 422) return false;
	if (!res.ok)
		throw new GithubAppError(`GitHub ${res.status}: ${await messageOf(res)}`, res.status);
	const status = ((await res.json()) as { status?: string }).status;
	return status === 'ahead' || status === 'identical';
}

/**
 * An Accept that took the claim and never settled it (the launcher died, or the answer to the push
 * was lost), past {@link MERGE_ACCEPT_LEASE_MS} by the database's clock: when the branch's tip holds
 * the commit that Accept recorded before pushing ({@link holdsMerge}), the run is `accepted` by
 * whoever built it; otherwise nothing was pushed and the proposal is given back. One run's failure
 * is reported and does not stop the others.
 */
async function clearLapsedAccepts(app: GithubApp): Promise<void> {
	for (const run of await lapsedAccepts(MERGE_ACCEPT_LEASE_MS)) {
		try {
			const claim = run.acceptClaim ?? '';
			let landed: string | null = null;
			// A commit was recorded but the tip cannot be read for this name: the claim is kept.
			if (run.acceptSha && !isPlainBranchName(run.branch)) continue;
			if (run.acceptSha) {
				const ref = await app.fetch(refReadPath(repo(), run.branch));
				if (ref.ok) {
					const tip = ((await ref.json()) as { object?: { sha?: string } }).object?.sha;
					if (tip && (await holdsMerge(app, run.acceptSha, tip))) landed = run.acceptSha;
				} else if (ref.status !== 404) {
					continue;
				}
			}
			if (landed !== null) {
				await settleMergeRun(
					run.id,
					['accepting'],
					{
						status: 'accepted',
						mergeSha: landed,
						...(run.acceptedById && run.acceptedBy
							? { acceptedBy: { id: run.acceptedById, name: run.acceptedBy } }
							: {}),
					},
					{ claim },
				);
			} else {
				await releaseAccept(run.id, claim, run.acceptSha);
			}
		} catch (err) {
			captureServerError(err, { source: 'merge-run accept backstop', mergeRun: run.id });
		}
	}
}

/**
 * Settle what a dead job leaves working, once per link sync:
 *  - a run past {@link MERGE_TIMED_OUT_MS} → `failed`, and its Actions run cancelled;
 *  - an unbound run is looked for once among the workflow's runs (its `run-name` and the App's bot)
 *    and bound; none found after {@link MERGE_DID_NOT_START_MS} → `failed`;
 *  - a bound run whose Actions run completed with no result → `cancelled` when GitHub cancelled it,
 *    else `failed`; one GitHub no longer has → `failed`; one that is going → `running`.
 * A proposal waiting for a person is never touched. Every ending is conditional on the run still
 * working, so a result arriving meanwhile wins.
 */
export async function backstopMergeRuns(app: GithubApp, nowMs = Date.now()): Promise<void> {
	await clearLapsedAccepts(app).catch((err) =>
		captureServerError(err, { source: 'merge-run accept backstop' }),
	);
	const runs = await workingMergeRuns();
	if (!runs.length) return;
	const age = (at: Date) => nowMs - at.getTime();
	const end = (run: MergeMainRun, ending: Ending) => settleMergeRun(run.id, WORKING, ending);
	const unbound: MergeMainRun[] = [];
	const bound: (MergeMainRun & { ghRunId: number })[] = [];
	for (const run of runs) {
		if (age(run.createdAt) > MERGE_TIMED_OUT_MS) {
			const ended = await end(run, { status: 'failed', reason: MERGE_RUN_REASONS.timedOut });
			if (ended && run.ghRunId !== null) {
				await cancelActionsRun(app, run.ghRunId).catch(() => undefined);
			}
			continue;
		}
		if (run.ghRunId === null) unbound.push(run);
		else bound.push({ ...run, ghRunId: run.ghRunId });
	}

	const listed = unbound.length ? await listedRuns(app).catch(() => null) : null;
	const bot = listed?.length ? await fixRunBot(app).catch(() => null) : null;
	if (listed && !(listed.length && bot === null)) {
		for (const run of unbound) {
			const found = listed.find(
				(w) =>
					isMergeRunTitle(w.display_title, run.id) &&
					bot !== null &&
					w.actor?.login === bot &&
					Date.parse(w.created_at ?? '') >= run.createdAt.getTime() - BIND_SLACK_MS,
			);
			if (found) {
				await bindMergeRun(run.id, found.id);
				continue;
			}
			if (age(run.createdAt) > MERGE_DID_NOT_START_MS) {
				await end(run, { status: 'failed', reason: MERGE_RUN_REASONS.didNotStart });
			}
		}
	}

	for (const run of bound.slice(0, BOUND_READS)) {
		const gh = await readActionsRun(app, run.ghRunId).catch(() => undefined);
		if (gh === undefined) continue;
		if (gh === null) {
			await end(run, { status: 'failed', reason: MERGE_RUN_REASONS.goneOnGithub });
		} else if (gh.status === 'completed') {
			await end(
				run,
				gh.conclusion === 'cancelled'
					? { status: 'cancelled', reason: MERGE_RUN_REASONS.cancelledOnGithub }
					: { status: 'failed', reason: MERGE_RUN_REASONS.endedWithoutResult },
			);
		} else if (gh.status === 'in_progress' && run.status === 'dispatched') {
			await markMergeRunRunning(run.id);
		}
	}
}
