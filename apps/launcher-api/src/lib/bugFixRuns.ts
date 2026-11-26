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
	'diagnosed',
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

/**
 * What the run concluded, in its own words; `second_area` names a cause outside its area, and
 * `diagnosed` is a diagnose run that offers options (ADR-0014): never a build run's.
 */
export const FIX_RUN_OUTCOMES = [
	'fixed',
	'not_reproduced',
	'needs_person',
	'second_area',
	'diagnosed',
] as const;
export type FixRunOutcome = (typeof FIX_RUN_OUTCOMES)[number];

export const isFixRunOutcome = (v: unknown): v is FixRunOutcome =>
	typeof v === 'string' && (FIX_RUN_OUTCOMES as readonly string[]).includes(v);

/**
 * A run diagnoses or builds (ADR-0014). Start fix always starts a `diagnose` run: it reproduces the
 * bug and changes no file. A person picks one of its options, which starts a `build` run that may
 * implement only that option. A row from before ADR-0014 is a build.
 */
export const FIX_RUN_MODES = ['diagnose', 'build'] as const;
export type FixRunMode = (typeof FIX_RUN_MODES)[number];

export const isFixRunMode = (v: unknown): v is FixRunMode =>
	typeof v === 'string' && (FIX_RUN_MODES as readonly string[]).includes(v);

export const FIX_OPTION_IDS = ['A', 'B', 'C', 'D'] as const;
export type FixOptionId = (typeof FIX_OPTION_IDS)[number];

export const isFixOptionId = (v: unknown): v is FixOptionId =>
	typeof v === 'string' && (FIX_OPTION_IDS as readonly string[]).includes(v);

/** One way to settle the bug, as a diagnose run offers it; plain words, never markup. */
export interface FixRunOption {
	id: FixOptionId;
	name: string;
	/** What it would change, in plain words. */
	change: string;
	/** The work involved. */
	cost: string;
	/** The risk to current games and tools. */
	risk: string;
	/** What the player would notice. */
	player: string;
}

/**
 * What a diagnose run reports (ADR-0014 §1): the run's own untrusted text, cleaned like `summary`
 * (`cleanText`, directives and private names out) and shown as plain text. `kind` is `defect` when
 * the code does something wrong and one fix is right, `decision` when reasonable people could pick
 * differently. One to four options with unique ids, in order.
 */
export interface FixRunDiagnosis {
	reported: string;
	cause: string;
	evidence: string;
	kind: 'defect' | 'decision';
	options: FixRunOption[];
	recommendation: { option: FixOptionId; why: string };
}

/** The option a person chose for a build run, and who chose it and when. */
export interface FixRunChoice {
	optionId: FixOptionId;
	name: string;
	change: string;
	note: string | null;
	decidedBy: string;
	decidedAt: string;
}

/** What is kept of a diagnosis's text, in code points. */
export const DIAGNOSIS_CAPS = { name: 120, why: 1_000, text: 3_000, total: 16_000 } as const;
export const MAX_OPTIONS = 4;
/** A person's note on the option they choose. */
export const MAX_BUILD_NOTE = 1_000;

/**
 * What a build run says about its change, in everyday words (ADR-0014 §2): what changed, steps a
 * person can follow to see it, and what it could affect. The run's own untrusted text, cleaned like
 * `summary`; each at most {@link EXPLANATION_CAP} characters.
 */
export interface FixRunExplanation {
	changed: string;
	howToCheck: string;
	risks: string;
}

export const EXPLANATION_KEYS = [
	'changed',
	'howToCheck',
	'risks',
] as const satisfies readonly (keyof FixRunExplanation)[];
export const EXPLANATION_CAP = 3_000;

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

/** How a run is named: the actor of what the run itself records, and the workflow's `run-name`. */
export const fixRunName = (id: string): string => `Fix run ${id}`;

/** The `run-name` a later workflow gives a run: the run and what it is (`Fix run <id> · diagnose`). */
export const fixRunRunName = (id: string, mode: FixRunMode): string =>
	`${fixRunName(id)} · ${mode}`;

/**
 * Whether an Actions run's title is this fix run's: the bare `Fix run <id>`, or the title that
 * carries the run's own mode, so the workflow may be renamed at any time (a live run lasts 90
 * minutes at most).
 */
export const isFixRunTitle = (title: string | undefined, id: string, mode: FixRunMode): boolean =>
	title === fixRunRunName(id, mode) || title === fixRunName(id);

/** The branch a run's pull request is opened from; `bug-<n>` is what the link sync reads. */
export const fixRunBranch = (number: number, id: string): string => `bug-${number}-fix-${id}`;

const FIX_RUN_BRANCH = /^bug-([1-9]\d{0,8})-fix-([0-9a-f]{10})$/;

/** The bug and the run a branch name spells (`fixRunBranch`'s inverse), or null for any other. */
export function parseFixRunBranch(branch: string): { bug: number; id: string } | null {
	const m = FIX_RUN_BRANCH.exec(branch);
	return m && { bug: Number(m[1]), id: m[2] };
}

/** The pull request's title, which the squash merge makes the commit on `main`. */
export const fixRunTitle = (scope: string, number: number, title: string): string =>
	`${scope}: ${bugRef(number)} ${title}`;

/** A run's `director_spend.run_id`, and the prefix of each row's `request_id`. */
export const fixRunSpendId = (id: string): string => `fix:${id}`;

// ── Starting one ──────────────────────────────────────────────────────────────

/** Why Start fix is refused (each a 409 with this code), in the order they are checked. */
export type StartRefusal =
	'bug_closed' | 'pr_open' | 'fix_run_live' | 'too_many_fix_runs' | 'fix_budget_spent';

/** Why building an option is refused, beyond what refuses a start (ADR-0014 §1). */
export type BuildRefusal = 'not_diagnosed' | 'stale_diagnosis' | 'no_such_option';

export type FixRunRefusal = StartRefusal | BuildRefusal;

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

export function startRefusal(f: StartFacts): StartRefusal | null {
	if (f.status !== 'open' && f.status !== 'working') return 'bug_closed';
	if (f.openPr !== null) return 'pr_open';
	if (f.liveRun !== null) return 'fix_run_live';
	if (f.liveTotal >= f.maxLive) return 'too_many_fix_runs';
	if (f.monthSpendUsd >= f.monthlyCapUsd) return 'fix_budget_spent';
	return null;
}

/** The run a build is asked to come from, as the refusals read it. */
export interface BuildParent {
	id: string;
	bugNumber: number;
	mode: FixRunMode;
	status: FixRunStatus;
	diagnosis: FixRunDiagnosis | null;
}

/**
 * The first reason `optionId` cannot be built from `parent` on bug `number`: the run is not a
 * finished diagnose run of this bug, a newer diagnose run of the bug exists (`latestDiagnoseId`),
 * or the diagnosis has no such option. Checked before the start refusals.
 */
export function buildRefusal(
	number: number,
	parent: BuildParent | null,
	latestDiagnoseId: string | null,
	optionId: unknown,
): BuildRefusal | null {
	if (
		!parent ||
		parent.bugNumber !== number ||
		parent.mode !== 'diagnose' ||
		parent.status !== 'diagnosed' ||
		!parent.diagnosis
	) {
		return 'not_diagnosed';
	}
	if (latestDiagnoseId !== parent.id) return 'stale_diagnosis';
	if (!parent.diagnosis.options.some((o) => o.id === optionId)) return 'no_such_option';
	return null;
}

/**
 * The bug's current diagnosis: its newest diagnose run, when that one ended `diagnosed`. A newer
 * diagnose run that is live, failed or found nothing makes an older diagnosis stale. `runs` are
 * newest first.
 */
export function latestDiagnosisOf<T extends { mode: FixRunMode; status: FixRunStatus }>(
	runs: T[],
): T | null {
	const newest = runs.find((r) => r.mode === 'diagnose');
	return newest?.status === 'diagnosed' ? newest : null;
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
	/**
	 * The bug's current diagnosis (`latestDiagnosisOf`): the newest `diagnosed` diagnose run, null
	 * when a newer diagnose run exists or there is none. Everyone who sees the bug sees it.
	 */
	latestDiagnosis: FixRunView | null;
	/**
	 * The viewer may build one of its options now: `may`, `ready`, no start refusal, and a current
	 * diagnosis. A bug with a live run, an open pull request or a closed status has none.
	 */
	canBuild: boolean;
}

/** A page where nothing can be started: a game bug, or a viewer without the pair. */
export const NO_FIX: FixFacts = {
	may: false,
	ready: false,
	refusal: null,
	latestDiagnosis: null,
	canBuild: false,
};

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
		case 'not_diagnosed':
			return `That is not a finished diagnosis of ${bugRef(number)}.`;
		case 'stale_diagnosis':
			return `${bugRef(number)} has a newer diagnosis. Choose from that one.`;
		case 'no_such_option':
			return 'That diagnosis has no such option.';
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
	diagnoseChangedFiles: 'A diagnose run changed files; nothing was kept.',
	noDiagnosis: 'The run did not explain its diagnosis.',
	noExplanation: 'The run did not explain its change; nothing was opened.',
	noDecision: 'This build has no recorded decision; nothing was opened.',
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
	/** A diagnose run's outcome `diagnosed` carries it; a build run's never does. */
	diagnosis?: FixRunDiagnosis;
	/** A build run's change, explained (ADR-0014 §2): all three, or nothing is opened. */
	changed?: string;
	howToCheck?: string;
	risks?: string;
	files: FixRunFile[];
	usage: FixRunUsage[];
}

// ── What a page shows ─────────────────────────────────────────────────────────

/** The fields of a stored run a page's view is made from (`bug_fix_runs`). */
export interface FixRunRecord {
	id: string;
	mode: FixRunMode;
	status: FixRunStatus;
	outcome: FixRunOutcome | null;
	ghRunId: number | null;
	prNumber: number | null;
	branch: string | null;
	reason: string | null;
	summary: string | null;
	secondBug: FixRunSecondBug | null;
	diagnosis: FixRunDiagnosis | null;
	chosenOption: FixRunChoice | null;
	explanation: FixRunExplanation | null;
	parentRunId: string | null;
	spendUsd: number | null;
	startedBy: string;
	resultAt: Date | null;
	createdAt: Date;
	finishedAt: Date | null;
}

/** One fix run as a bug page shows it. The run's words are text, never HTML. */
export interface FixRunView {
	id: string;
	/** `diagnose` or `build`; an event of a run from before ADR-0014 names no mode, and is a build. */
	mode: FixRunMode;
	status: FixRunStatus;
	outcome: FixRunOutcome | null;
	prNumber: number | null;
	prUrl: string | null;
	branch: string | null;
	actionsUrl: string | null;
	reason: string | null;
	summary: string | null;
	secondBug: FixRunSecondBug | null;
	/** A diagnose run that ended `diagnosed`: its options and recommendation. Plain text. */
	diagnosis: FixRunDiagnosis | null;
	/** A build run: the option a person chose, who and when, and their note. */
	chosenOption: FixRunChoice | null;
	/** A build run that opened a change: what it changed, how to check it, its risks. Plain text. */
	explanation: FixRunExplanation | null;
	/** A build run: the diagnose run it came from. */
	parentRunId: string | null;
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
		mode: run.mode,
		status: run.status,
		outcome: run.outcome,
		prNumber: run.prNumber,
		prUrl: run.prNumber === null ? null : `${github}/pull/${run.prNumber}`,
		branch: run.branch,
		actionsUrl: run.ghRunId === null ? null : `${github}/actions/runs/${run.ghRunId}`,
		reason: run.reason,
		summary: run.summary,
		secondBug: run.secondBug,
		diagnosis: run.diagnosis,
		chosenOption: run.chosenOption,
		explanation: run.explanation,
		parentRunId: run.parentRunId,
		spendUsd: run.spendUsd,
		startedBy: run.startedBy,
		createdAt: run.createdAt.toISOString(),
		finishedAt: run.finishedAt?.toISOString() ?? null,
		canStop: mayAct && isLiveFixRun(run.status) && run.resultAt === null,
	};
}

// ── Whether a change was built for the option a person chose ──────────────────

/** The fields of a run `fixDecisionState` reads; a stored run (`FixRunRecord`) has them all. */
export interface DecisionRun {
	id: string;
	mode: FixRunMode;
	createdAt: Date;
	diagnosis: FixRunDiagnosis | null;
	chosenOption: FixRunChoice | null;
	explanation: FixRunExplanation | null;
	parentRunId: string | null;
}

/** A `fix_decision` event of the bug: the build it started is `data.build`. */
export interface DecisionEvent {
	id: number;
	data: Record<string, unknown>;
}

export const DECISION_REASONS = {
	none: 'No decision is recorded for this change: it was built before fix runs asked first.',
	newerDecision:
		'A newer decision was recorded on the bug: this change was built for an earlier one.',
	newerDiagnosis: 'A newer diagnosis replaced the one this change was built from.',
} as const;

export type FixDecisionState =
	| {
			ok: true;
			choice: FixRunChoice;
			explanation: FixRunExplanation | null;
			diagnosis: FixRunDiagnosis | null;
	  }
	| { ok: false; reason: string };

/**
 * Whether `run`, a fix run's change, was built for what a person decided (ADR-0014 §3): it is a
 * build with a chosen option; the bug's newest `fix_decision` names it as the build; and no diagnose
 * run of the bug is newer than the diagnosis it came from. `bugRuns` are all the bug's runs, any
 * order; `decisions` all its `fix_decision` events, any order. Pure: Mark ready and merge refuse
 * a change whose answer is not `ok`.
 */
export function fixDecisionState(
	run: DecisionRun,
	bugRuns: DecisionRun[],
	decisions: DecisionEvent[],
): FixDecisionState {
	const parent = run.parentRunId ? bugRuns.find((r) => r.id === run.parentRunId) : undefined;
	if (run.mode !== 'build' || !run.chosenOption || !parent) {
		return { ok: false, reason: DECISION_REASONS.none };
	}
	const newest = decisions.reduce<DecisionEvent | null>(
		(best, d) => (!best || d.id > best.id ? d : best),
		null,
	);
	if (!newest) return { ok: false, reason: DECISION_REASONS.none };
	if (newest.data.build !== run.id) return { ok: false, reason: DECISION_REASONS.newerDecision };
	const replaced = bugRuns.some(
		(r) => r.mode === 'diagnose' && r.createdAt.getTime() > parent.createdAt.getTime(),
	);
	if (replaced) return { ok: false, reason: DECISION_REASONS.newerDiagnosis };
	return {
		ok: true,
		choice: run.chosenOption,
		explanation: run.explanation,
		diagnosis: parent.diagnosis,
	};
}
