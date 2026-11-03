import {
	FIX_RUN_REASONS,
	FIX_RUN_WORKFLOW,
	actionsRefusal,
	fixRunBranch,
	fixRunName,
	type FixRunStatus,
} from '$lib/bugFixRuns';
import type { Actor } from './bugReportsStore';
import { bindFixRun, liveFixRuns, settleFixRun, type BugFixRun } from './bugFixRunsStore';
import { ENV } from './env';
import { GithubAppError, type GithubApp } from './githubApp';

/**
 * The GitHub Actions side of fix runs (ADR-0013 §3, §5): dispatching `bug-fix.yml` through the
 * launcher's GitHub App, reading and cancelling the Actions run, finding a run's pull request by its
 * branch, and the backstop that settles a run whose job died without calling back. Apart from
 * `bugFixRuns.ts` because the link sync (`bugReports.ts`) runs the backstop, and that module is the
 * one `bugFixRuns.ts` builds on.
 *
 * Dispatching and cancelling need the App's Actions **write** permission (it had read until
 * ADR-0013); a 403 saying the App lacks access says so in the run's reason. Nothing here throws to
 * its caller for a GitHub answer it can name: a failure becomes the run's reason, or waits for the
 * next pass.
 */

/** No person: what the run itself records on its bug (its end, its first contact). */
export const fixRunActor = (id: string): Actor => ({ id: null, name: fixRunName(id) });

/** The App's bot, the only `actor` a fix run's job may have: a person's re-run is refused. */
export async function fixRunBot(app: GithubApp): Promise<string> {
	return `${await app.slug()}[bot]`;
}

/** An Actions run, the fields read. */
export interface GhWorkflowRun {
	id: number;
	display_title?: string;
	path?: string;
	status?: string;
	conclusion?: string | null;
	actor?: { login?: string } | null;
	created_at?: string;
	html_url?: string;
}

const repo = (): string => ENV.GITHUB_ENGINE_REPO;

export const actionsRunUrl = (ghRunId: number): string =>
	`https://github.com/${repo()}/actions/runs/${ghRunId}`;

export async function messageOf(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? res.statusText;
}

/** What a dispatch came to: GitHub took it (the run's id when it said), refused it, or never said. */
export type Dispatched =
	| { kind: 'sent'; ghRunId: number | null }
	| { kind: 'refused'; reason: string }
	| { kind: 'unknown' };

/**
 * Dispatch the workflow on `main` with ONE input, the run's id — inputs are public, so never the
 * bug's number or text. GitHub answers 200 with the new run's id when asked for it
 * (`return_run_details`), else 204; either way the run's `run-name` lets it be found later. A
 * GitHub that does not know `return_run_details` (a 422 naming it) is asked once more without.
 * Only a definitive 4xx refuses the run; a timeout, a network error or a 5xx may still have started
 * one, so the run stays `dispatched` for the backstop to find or give up on.
 */
export async function dispatchFixRun(app: GithubApp, id: string): Promise<Dispatched> {
	const send = (details: boolean) =>
		app.fetch(`/repos/${repo()}/actions/workflows/${FIX_RUN_WORKFLOW}/dispatches`, {
			method: 'POST',
			body: JSON.stringify({
				ref: 'main',
				inputs: { fix_run: id },
				...(details ? { return_run_details: true } : {}),
			}),
		});
	let res: Response;
	try {
		res = await send(true);
		if (res.status === 422) {
			const message = await messageOf(res);
			if (!message.includes('return_run_details')) {
				return { kind: 'refused', reason: actionsRefusal(422, message, 'dispatching the fix run') };
			}
			res = await send(false);
		}
	} catch {
		return { kind: 'unknown' };
	}
	if (res.status === 404) return { kind: 'refused', reason: FIX_RUN_REASONS.noWorkflow };
	if (res.status >= 400 && res.status < 500) {
		const message = await messageOf(res);
		return {
			kind: 'refused',
			reason: actionsRefusal(res.status, message, 'dispatching the fix run'),
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

/** The Actions run, or null when GitHub has none by that id. */
export async function readActionsRun(
	app: GithubApp,
	ghRunId: number,
): Promise<GhWorkflowRun | null> {
	const res = await app.fetch(`/repos/${repo()}/actions/runs/${ghRunId}`);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new GithubAppError(`GitHub ${res.status}: ${await messageOf(res)}`, res.status);
	}
	return (await res.json()) as GhWorkflowRun;
}

/**
 * Ask GitHub to cancel the Actions run: `cancelling` (202), `finished` (409: it already ended),
 * `gone` (404: GitHub has no such run), or GitHub's refusal with its status.
 */
export async function cancelActionsRun(
	app: GithubApp,
	ghRunId: number,
): Promise<
	| { kind: 'cancelling' | 'finished' | 'gone' }
	| { kind: 'refused'; status: number; message: string }
> {
	const res = await app.fetch(`/repos/${repo()}/actions/runs/${ghRunId}/cancel`, {
		method: 'POST',
	});
	if (res.status === 202) return { kind: 'cancelling' };
	if (res.status === 409) return { kind: 'finished' };
	if (res.status === 404) return { kind: 'gone' };
	return { kind: 'refused', status: res.status, message: await messageOf(res) };
}

/** The pull request GitHub has from `branch` (open or not), or null; throws when GitHub can't say. */
export async function pullForBranch(app: GithubApp, branch: string): Promise<number | null> {
	const r = repo();
	const owner = r.split('/')[0];
	const pulls = await app.json<{ number: number }[]>(
		`/repos/${r}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=1`,
	);
	return pulls[0]?.number ?? null;
}

// ── The backstop ──────────────────────────────────────────────────────────────

/** A dispatched run GitHub never shows a run for is given up after this long. */
export const DID_NOT_START_MS = 15 * 60_000;
/** Any live run is given up after this long: the job's own timeout is 75 minutes. */
export const TIMED_OUT_MS = 90 * 60_000;
/** A claimed result still not opened after this long means the launcher stopped mid-commit. */
export const MID_PR_MS = 10 * 60_000;
/** An Actions run may be stamped a little before the launcher stored its fix run. */
const BIND_SLACK_MS = 60_000;
/** Bound runs read per pass, oldest first: the rest wait a minute. */
const BOUND_READS = 10;

type Ending = { status: Exclude<FixRunStatus, 'dispatched' | 'running'>; reason: string };

/**
 * Settle what a dead job leaves live, once per link sync (no loop of its own — ground rule 8):
 *  - a run whose result was claimed is left alone while its pull request is being opened; past
 *    {@link MID_PR_MS} it is `pr_opened` when GitHub has the PR from its branch, else `failed`;
 *  - any other live run past {@link TIMED_OUT_MS} → `failed`, and its Actions run cancelled;
 *  - an unbound run is looked for once among the workflow's runs (its `run-name` and the App's
 *    bot) and bound; none found after {@link DID_NOT_START_MS} → `failed`;
 *  - a bound run whose Actions run completed with no result → `cancelled` when GitHub cancelled
 *    it, else `failed`, with the run's link; one GitHub no longer has → `failed`.
 * Every ending but the mid-commit one is conditional on the run having no claimed result, so a
 * result arriving meanwhile wins. A GitHub error on one read (or on the listing) leaves those runs
 * for the next pass, and the others are still read.
 */
export async function backstopFixRuns(app: GithubApp, nowMs = Date.now()): Promise<void> {
	const runs = await liveFixRuns();
	if (!runs.length) return;
	const age = (at: Date) => nowMs - at.getTime();
	const end = (run: BugFixRun, ending: Ending, extra: Record<string, unknown> = {}) =>
		settleFixRun(run.id, ending, fixRunActor(run.id), { withoutResult: true, extra });
	const unbound: BugFixRun[] = [];
	const bound: (BugFixRun & { ghRunId: number })[] = [];
	for (const run of runs) {
		if (run.resultAt) {
			if (age(run.resultAt) > MID_PR_MS) await endMidCommit(app, run);
			continue;
		}
		if (age(run.createdAt) > TIMED_OUT_MS) {
			const link = run.ghRunId === null ? {} : { actions: actionsRunUrl(run.ghRunId) };
			const ended = await end(run, { status: 'failed', reason: FIX_RUN_REASONS.timedOut }, link);
			if (ended && run.ghRunId !== null) {
				await cancelActionsRun(app, run.ghRunId).catch(() => undefined);
			}
			continue;
		}
		if (run.ghRunId === null) unbound.push(run);
		else bound.push({ ...run, ghRunId: run.ghRunId });
	}

	// A listing GitHub would not give says nothing about these runs: they wait for the next pass.
	const listed = unbound.length ? await listedRuns(app).catch(() => null) : null;
	if (listed) {
		const bot = listed.length ? await fixRunBot(app).catch(() => null) : null;
		for (const run of unbound) {
			const found = listed.find(
				(w) =>
					w.display_title === fixRunName(run.id) &&
					bot !== null &&
					w.actor?.login === bot &&
					Date.parse(w.created_at ?? '') >= run.createdAt.getTime() - BIND_SLACK_MS,
			);
			if (found) {
				await bindFixRun(run.id, found.id);
				continue;
			}
			if (age(run.createdAt) > DID_NOT_START_MS) {
				await end(run, { status: 'failed', reason: FIX_RUN_REASONS.didNotStart });
			}
		}
	}

	for (const run of bound.slice(0, BOUND_READS)) {
		const gh = await readActionsRun(app, run.ghRunId).catch(() => undefined);
		if (gh === undefined) continue;
		const link = { actions: actionsRunUrl(run.ghRunId) };
		if (gh === null) {
			await end(run, { status: 'failed', reason: FIX_RUN_REASONS.goneOnGithub }, link);
		} else if (gh.status === 'completed') {
			await end(
				run,
				gh.conclusion === 'cancelled'
					? { status: 'cancelled', reason: FIX_RUN_REASONS.cancelledOnGithub }
					: { status: 'failed', reason: FIX_RUN_REASONS.endedWithoutResult },
				link,
			);
		}
	}
}

/** The workflow's recent dispatched runs; none when `main` has no such workflow yet (404). */
async function listedRuns(app: GithubApp): Promise<GhWorkflowRun[]> {
	const res = await app.fetch(
		`/repos/${repo()}/actions/workflows/${FIX_RUN_WORKFLOW}/runs?event=workflow_dispatch&per_page=50`,
	);
	if (res.status === 404) return [];
	if (!res.ok) {
		throw new GithubAppError(`GitHub ${res.status}: ${await messageOf(res)}`, res.status);
	}
	return ((await res.json()) as { workflow_runs?: GhWorkflowRun[] }).workflow_runs ?? [];
}

/**
 * A result claimed long ago and never settled: the launcher stopped between the claim and the
 * settle. Its pull request may exist all the same — then that is how the run ended.
 */
async function endMidCommit(app: GithubApp, run: BugFixRun): Promise<void> {
	const branch = fixRunBranch(run.bugNumber, run.id);
	let pr: number | null;
	try {
		pr = await pullForBranch(app, branch);
	} catch {
		return;
	}
	await settleFixRun(
		run.id,
		pr === null
			? { status: 'failed', reason: FIX_RUN_REASONS.stoppedMidPr }
			: { status: 'pr_opened', prNumber: pr, branch },
		fixRunActor(run.id),
	);
}
