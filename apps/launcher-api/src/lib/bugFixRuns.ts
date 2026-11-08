import { bugRef, type BugStatus } from '$lib/bugReports';

/**
 * Fix runs on pipeline bugs (ADR-0013), the parts the pages, the server and the fixture share. A
 * person who holds both "Start fix runs on pipeline bugs" and pipeline triage starts one on a
 * pipeline bug; the launcher dispatches `bug-fix.yml` on `main` through its GitHub App with the
 * run's id as the one input (inputs are public), the job reads the bug back with a GitHub OIDC
 * token, runs Claude Code with the build agents and posts its result, and the launcher re-checks
 * the change and opens it as a draft pull request on `bug-<n>-fix-<id>` — which the link sync then
 * links like any `bug-<n>` branch, so the bug's status moves exactly as it does for a person's fix.
 * Here: the vocabularies, the names the launcher and the workflow agree on, the start refusals, the
 * sentences a run ends with, the result the job posts, and what a page shows of a run. No Svelte,
 * no server imports.
 */

export const FIX_RUN_STATUSES = [
	'dispatched',
	'running',
	'pr_opened',
	'no_fix',
	'failed',
	'cancelled',
] as const;
export type FixRunStatus = (typeof FIX_RUN_STATUSES)[number];

/** A run still going: dispatched (no contact from the job yet) or running (it read its bug). */
export const LIVE_FIX_RUN_STATUSES = [
	'dispatched',
	'running',
] as const satisfies readonly FixRunStatus[];

export const isLiveFixRun = (status: FixRunStatus): boolean =>
	(LIVE_FIX_RUN_STATUSES as readonly string[]).includes(status);

/** What the run concluded, in its own words; `second_area` names a cause outside its area. */
export const FIX_RUN_OUTCOMES = ['fixed', 'not_reproduced', 'needs_person', 'second_area'] as const;
export type FixRunOutcome = (typeof FIX_RUN_OUTCOMES)[number];

export const isFixRunOutcome = (v: unknown): v is FixRunOutcome =>
	typeof v === 'string' && (FIX_RUN_OUTCOMES as readonly string[]).includes(v);

/** A second bug the run proposes; stored on the run, never filed by it (a triager files it). */
export interface FixRunSecondBug {
	area: string;
	title: string;
	evidence: string;
}

// ── What the launcher and the workflow agree on ───────────────────────────────

/** The workflow file on `main` the App dispatches. */
export const FIX_RUN_WORKFLOW = 'bug-fix.yml';
export const FIX_RUN_WORKFLOW_PATH = `.github/workflows/${FIX_RUN_WORKFLOW}`;
/** The Actions environment that holds the run's Anthropic key, deployment branches `main` only. */
export const FIX_RUN_ENVIRONMENT = 'bug-fix';
/** The audience the job's OIDC tokens are minted for; no other token opens a fix run's bug. */
export const FIX_RUN_AUDIENCE = 'invisible-launcher-bug-fix';
/** The `director_spend.agent` a run's spend is recorded under (the "Anthropic (agents)" card). */
export const FIX_RUN_AGENT = 'bug-fix';

/** A run's id: 10 lowercase hex characters, so a branch can never spell a second `bug-<n>`. */
export const FIX_RUN_ID = /^[0-9a-f]{10}$/;

/** How a run is named: the workflow's `run-name`, and the actor of what the run itself records. */
export const fixRunName = (id: string): string => `Fix run ${id}`;

/** The branch a run's pull request is opened from; `bug-<n>` is what the link sync reads. */
export const fixRunBranch = (number: number, id: string): string => `bug-${number}-fix-${id}`;

/** The pull request's title, which the squash merge makes the commit on `main`. */
export const fixRunTitle = (scope: string, number: number, title: string): string =>
	`${scope}: ${bugRef(number)} ${title}`;

/** A run's `director_spend.run_id`, and the prefix of each row's `request_id`. */
export const fixRunSpendId = (id: string): string => `fix:${id}`;

// ── Starting one ──────────────────────────────────────────────────────────────

/** Why Start fix is refused (each a 409 with this code), in the order they are checked. */
export type FixRunRefusal =
	'bug_closed' | 'pr_open' | 'fix_run_live' | 'too_many_fix_runs' | 'fix_budget_spent';

/** What the start refusals read: the bug, its links and runs, every live run, and the month. */
export interface StartFacts {
	status: BugStatus;
	/** A linked pull request still open, if any. */
	openPr: number | null;
	/** The bug's own live run, if any. */
	liveRun: string | null;
	/** Live runs over every bug. */
	liveTotal: number;
	maxLive: number;
	/** This calendar month's (UTC) fix-run spend, and its ceiling. */
	monthSpendUsd: number;
	monthlyCapUsd: number;
}

export function startRefusal(f: StartFacts): FixRunRefusal | null {
	if (f.status !== 'open' && f.status !== 'working') return 'bug_closed';
	if (f.openPr !== null) return 'pr_open';
	if (f.liveRun !== null) return 'fix_run_live';
	if (f.liveTotal >= f.maxLive) return 'too_many_fix_runs';
	if (f.monthSpendUsd >= f.monthlyCapUsd) return 'fix_budget_spent';
	return null;
}

/** The first instant of `nowMs`'s calendar month in UTC: the monthly ceiling's window. */
export function monthStartUtc(nowMs: number): Date {
	const d = new Date(nowMs);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * What a pipeline bug's page learned about Start fix on the server: the viewer holds both
 * capabilities (`may`), fix runs can run at all (`ready`: the GitHub App is configured and GitHub
 * has `bug-fix.yml` as an active workflow), and the first start refusal that needs no GitHub, with
 * its sentence. The decisions a page makes from it are `fixControl` in `routes/(app)/bugs/fixView.ts`.
 */
export interface FixFacts {
	may: boolean;
	ready: boolean;
	refusal: { code: FixRunRefusal; message: string } | null;
}

/** A page where nothing can be started: a game bug, or a viewer without the pair. */
export const NO_FIX: FixFacts = { may: false, ready: false, refusal: null };

const usd = (n: number): string => `$${n.toFixed(2)}`;

export function refusalMessage(code: FixRunRefusal, number: number, f: StartFacts): string {
	switch (code) {
		case 'bug_closed':
			return `${bugRef(number)} is closed. Reopen it to start a fix run.`;
		case 'pr_open':
			return `A fix is already in review: #${f.openPr}.`;
		case 'fix_run_live':
			return `${bugRef(number)} already has a fix run going${f.liveRun ? ` (fix run ${f.liveRun})` : ''}.`;
		case 'too_many_fix_runs':
			return `${f.liveTotal} fix run${f.liveTotal === 1 ? ' is' : 's are'} going already, the most at once (Admin › Settings). Start this one when one ends.`;
		case 'fix_budget_spent':
			return `Fix runs have spent ${usd(f.monthSpendUsd)} of this month's ${usd(f.monthlyCapUsd)} (Admin › Settings). New fix runs start next month.`;
	}
}

// ── How a run ends ────────────────────────────────────────────────────────────

/** The launcher's own sentences for a run's end (`bug_fix_runs.reason`), never the run's words. */
export const FIX_RUN_REASONS = {
	actionsWrite: 'The GitHub App needs Actions: Read and write (docs/INFRA.md).',
	noWorkflow:
		'GitHub has no .github/workflows/bug-fix.yml on main for the App to run yet (ADR-0013 card 13B; docs/INFRA.md).',
	noResult: 'The run ended without a result.',
	didNotStart: 'The Actions run did not start.',
	endedWithoutResult: 'The Actions run ended without a result.',
	cancelledOnGithub: 'The Actions run was cancelled.',
	goneOnGithub: 'GitHub no longer has the Actions run.',
	timedOut: 'The run timed out.',
	stoppedMidPr: 'The launcher stopped while opening the pull request.',
	launcherFailed: 'The launcher failed while opening the pull request.',
	bugClosed: 'The bug was closed while the run was going.',
} as const;

/** A stored reason is at most this many characters: GitHub's messages can run long. */
export const MAX_REASON = 300;

/** `text` cut to `max` code points (never half a surrogate pair), an ellipsis marking the cut. */
export function capText(text: string, max: number): string {
	const points = Array.from(text);
	return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text;
}

export const capReason = (text: string): string => capText(text, MAX_REASON);

/** What GitHub says when the App lacks a permission, here Actions write. */
const NOT_ACCESSIBLE = 'Resource not accessible by integration';

/**
 * GitHub refusing an Actions call (`doing`: "dispatching the fix run"). Only a 403 that says the
 * App lacks access is the Actions-write sentence; a 403 for anything else (a rate limit, a policy)
 * is said in GitHub's own words.
 */
export const actionsRefusal = (status: number, message: string, doing: string): string =>
	status === 403 && message.includes(NOT_ACCESSIBLE)
		? FIX_RUN_REASONS.actionsWrite
		: capReason(`GitHub ${status} ${doing}: ${message}`);

export const refusedChange = (rule: string): string =>
	capReason(`The change was refused (${rule}).`);

export const stoppedBy = (person: string): string => `Stopped by ${person}.`;

// ── What the job posts ────────────────────────────────────────────────────────

/** One model's usage over the whole run, as the CLI reports it. */
export interface FixRunUsage {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/** One file of the change: its full new content, or `null` when it is deleted. */
export interface FixRunFile {
	path: string;
	mode?: '100644' | '100755';
	content: string | null;
}

/**
 * `POST /api/pipeline/fix-runs/<id>/result`, as the workflow's collector (`scripts/bug-fix/`,
 * ADR-0013 card 13B) builds it: JSON, optionally gzipped (`Content-Encoding: gzip`). `failure` set
 * means the run ended without a result of its own, whatever else it carries.
 */
export interface FixRunResultBody {
	baseSha: string;
	outcome: FixRunOutcome;
	failure?: string;
	title: string;
	scope: string;
	summary: string;
	lesson: string;
	gates: { command: string; ok: boolean }[];
	secondBug?: FixRunSecondBug;
	files: FixRunFile[];
	usage: FixRunUsage[];
}

// ── What a page shows ─────────────────────────────────────────────────────────

/** The fields of a stored run a page's view is made from (`bug_fix_runs`). */
export interface FixRunRecord {
	id: string;
	status: FixRunStatus;
	outcome: FixRunOutcome | null;
	ghRunId: number | null;
	prNumber: number | null;
	branch: string | null;
	reason: string | null;
	summary: string | null;
	secondBug: FixRunSecondBug | null;
	spendUsd: number | null;
	startedBy: string;
	resultAt: Date | null;
	createdAt: Date;
	finishedAt: Date | null;
}

/** One fix run as a bug page shows it. The run's words are text, never HTML. */
export interface FixRunView {
	id: string;
	status: FixRunStatus;
	outcome: FixRunOutcome | null;
	prNumber: number | null;
	prUrl: string | null;
	branch: string | null;
	actionsUrl: string | null;
	reason: string | null;
	summary: string | null;
	secondBug: FixRunSecondBug | null;
	/** Null: no result reported, so the spend is unknown. */
	spendUsd: number | null;
	startedBy: string;
	createdAt: string;
	finishedAt: string | null;
	/** The viewer may stop it: it is live, its result is not being opened, and they may start runs. */
	canStop: boolean;
}

export function fixRunView(run: FixRunRecord, repo: string, mayAct: boolean): FixRunView {
	const github = `https://github.com/${repo}`;
	return {
		id: run.id,
		status: run.status,
		outcome: run.outcome,
		prNumber: run.prNumber,
		prUrl: run.prNumber === null ? null : `${github}/pull/${run.prNumber}`,
		branch: run.branch,
		actionsUrl: run.ghRunId === null ? null : `${github}/actions/runs/${run.ghRunId}`,
		reason: run.reason,
		summary: run.summary,
		secondBug: run.secondBug,
		spendUsd: run.spendUsd,
		startedBy: run.startedBy,
		createdAt: run.createdAt.toISOString(),
		finishedAt: run.finishedAt?.toISOString() ?? null,
		canStop: mayAct && isLiveFixRun(run.status) && run.resultAt === null,
	};
}
