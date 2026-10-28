import type { RunKind } from './runState.ts';

/**
 * A game repair run's vocabulary (ADR-0012): who leads each kind of run, who a repair run may
 * assign, what `run.submit_repair` carries and the code checks it passes. Plain data and pure
 * functions with no runtime imports, so the launcher's fixture can read the lists and the worker's
 * fixture can run the checks.
 */

/** The agent that gets the brief, the owner's messages and every other agent's report. */
export const LEAD_AGENTS: Readonly<Record<RunKind, string>> = {
	create: 'coordinator',
	repair: 'game-doctor',
};
/**
 * Deploy skew: a worker from before repair runs would drive a `kind = 'repair'` row as a create run
 * (the coordinator, the create steps). It cannot be changed, so the launcher refuses to START a
 * repair run unless a worker that knows the kind has said so lately: every sweep of a new worker
 * writes this app setting, at most once a minute. An old worker never writes it, and a rolled-back
 * one stops refreshing it, so the launcher stops starting repair runs within `WORKER_BEAT_MAX_AGE_MS`.
 */
export const WORKER_KINDS_KEY = 'DIRECTOR_WORKER_KINDS';
export const WORKER_KINDS = 'create,repair';
export const WORKER_BEAT_EVERY_MS = 45_000;
export const WORKER_BEAT_MAX_AGE_MS = 5 * 60_000;

export const leadOf = (kind: RunKind): string => LEAD_AGENTS[kind];

/** The agents a repair run may give a task to: the ones that write a project's content. */
export const REPAIR_ASSIGNABLE: readonly string[] = ['builder', 'animator'];

export const ART_NOT_REPAIRED = 'art is not repaired by Director yet';

/** How the doctor says a repair ended; `escalate` becomes `escalated` once the owner approves. */
export const SUBMIT_OUTCOMES = ['fixed', 'escalate', 'needs_person', 'not_reproduced'] as const;
export type SubmitOutcome = (typeof SUBMIT_OUTCOMES)[number];
export const VERIFIED = ['played_pass', 'played_fail', 'not_played'] as const;
export type Verified = (typeof VERIFIED)[number];

/**
 * The pipeline bug areas (`bugAreas('pipeline')` in the launcher's `$lib/bugReports`): a tool's id
 * or `engine` / `launcher` / `other`. The worker cannot import the launcher's module, so
 * `check:director-adapters` holds this list to it.
 */
export const PIPELINE_AREAS = [
	'comfyui',
	'atlasTool',
	'characters',
	'componentEditor',
	'director',
	'flipbook',
	'flow',
	'fontMaker',
	'ftpBrowser',
	'fx',
	'gameBugs',
	'gameConfig',
	'gameMaker',
	'invisibleLauncher',
	'localization',
	'pipelineBugs',
	'pipelineChanges',
	'spineViewer',
	'rigger',
	'editor',
	'shaders',
	'sheetMaker',
	'sound',
	'storybook',
	'symbols',
	'winText',
	'engine',
	'launcher',
	'other',
] as const;
export const NO_AREA = 'none';

export interface RepairSubmission {
	outcome: SubmitOutcome;
	summary: string;
	cause: string;
	changes: string;
	verified: Verified;
	pipeline_area: string;
	pipeline_title: string;
}

/** How a draft play settled, for the doctor's `verified` (ADR-0012 §2, ADR-0010 owner decision 4). */
export type PlayVerdict = 'passed' | 'failed' | 'unplayed';

/**
 * A settled play's verdict, from its `director_draft_jobs` row; null for a cancelled one (it never
 * ran and counts for nothing). A play that never ran (`no_player`, a refused submit, a timeout, a
 * player that could not play it) is `unplayed`: not a pass and not a fail. One that ran passed when
 * the runtime booted and every scenario reached every screen it expected with no stall and no error;
 * console lines alone do not fail it.
 */
export function playVerdict(status: string, result: unknown): PlayVerdict | null {
	if (status === 'cancelled') return null;
	if (status !== 'finished') return 'unplayed';
	const report = (typeof result === 'object' && result !== null ? result : {}) as {
		bootRefused?: unknown;
		scenarios?: unknown;
	};
	if (!Array.isArray(report.scenarios) || report.scenarios.length === 0) return 'unplayed';
	if (report.bootRefused) return 'failed';
	const clean = report.scenarios.every(
		(sc: { missing?: unknown; stall?: unknown; error?: unknown }) =>
			Array.isArray(sc?.missing) ? sc.missing.length === 0 && !sc.stall && !sc.error : false,
	);
	return clean ? 'passed' : 'failed';
}

/** The draft plays of the current step, counted from their `director_draft_jobs` rows. */
export interface PlayCounts {
	/** Plays still queued (or running): nothing is known of them yet. */
	open: number;
	/** Plays that settled, cancelled ones left out: `passed + failed + unplayed`. */
	requested: number;
	passed: number;
	failed: number;
	unplayed: number;
}

/**
 * What the step's plays say of the fix, derived by code and never taken from the doctor's claim
 * (`RepairSubmission.verified` is overwritten with it): any play that passed is `played_pass`; else
 * any that failed is `played_fail`; else `not_played` (no play settled, or only ones that never ran,
 * `no_player` among them).
 */
export function derivedVerified(plays: PlayCounts): Verified {
	return plays.passed > 0 ? 'played_pass' : plays.failed > 0 ? 'played_fail' : 'not_played';
}

/** What the run's own records say, for `checkSubmission`. */
export interface RepairFacts {
	/** The step the run is in. */
	step: string;
	/** Writes by `builder` or `animator` that the launcher completed in this run. */
	fixWrites: number;
	plays: PlayCounts;
}

/**
 * Why a submission is refused, or null. Code, not the model's say-so: a fix needs the verify step,
 * an edit made by a writing agent and a play of the step that settled and did not fail; an
 * escalation names a real pipeline area and a title. A fix whose plays never ran (no draft player)
 * is allowed, as `not_played`, so the owner can still approve it knowing it was not played.
 */
export function checkSubmission(s: RepairSubmission, facts: RepairFacts): string | null {
	const escalating = s.outcome === 'escalate';
	if (escalating) {
		if (!(PIPELINE_AREAS as readonly string[]).includes(s.pipeline_area)) {
			return `pipeline_area must be one of ${PIPELINE_AREAS.join(', ')} when escalating.`;
		}
		if (!s.pipeline_title.trim()) return 'pipeline_title is required when escalating.';
	} else {
		if (s.pipeline_area !== NO_AREA) {
			return `pipeline_area must be "${NO_AREA}" unless you escalate.`;
		}
		if (s.pipeline_title.trim()) return 'pipeline_title must be empty unless you escalate.';
	}
	if (s.outcome === 'fixed') {
		if (facts.step !== 'verify') {
			return `A fix is submitted from the verify step, not ${facts.step}: finish the fix, call run.request_checkpoint (step_done), then play it again.`;
		}
		if (facts.fixWrites === 0) {
			return 'Nothing was changed in this run: no builder or animator write completed. Assign the fix first, or submit another outcome.';
		}
		if (facts.plays.open > 0) {
			return 'A play of this step is still running. End your turn: you are told, with its report, when it settles. Then conclude.';
		}
		if (facts.plays.requested === 0) {
			return 'Play the draft again before concluding a fix: request a draft, play it, and wait for the report.';
		}
		if (derivedVerified(facts.plays) === 'played_fail') {
			return 'A play of this step failed and none passed, so this is not a fix. Fix it again and play it again, or submit another outcome.';
		}
	}
	return null;
}

export const ESCALATION_NOT_SERVED =
	'escalating to the pipeline is not available yet (the launcher does not serve bugs.escalate_game_bug): ask for a revision, or stop the run';

/** The outcome a run is recorded with (`director_runs.repair_outcome`) once the owner approves. */
export const repairOutcomeOf = (outcome: SubmitOutcome) =>
	outcome === 'escalate' ? ('escalated' as const) : outcome;

/** The brief of a repair run: where it is, never the bug's own words (ADR-0012 §2, layer 1). */
export function repairBrief(brief: {
	runId: string;
	project: string;
	client: string | null;
	bugNumber: number | null;
	family: string;
	budgetCapUsd: number | null;
}): string {
	return [
		'A new Invisible Director repair run. Read the bug, reproduce it, then fix and verify it.',
		'',
		JSON.stringify(brief, null, 2),
	].join('\n');
}
