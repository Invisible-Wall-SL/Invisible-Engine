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

/**
 * What the run's own records say, for `checkSubmission`. `plays` is what this step's plays settled
 * as (`playVerdict`), counted from the run's draft jobs queued since the step began; the checks
 * bind `fixed` and `verified` to it.
 */
export interface RepairFacts {
	/** The step the run is in. */
	step: string;
	/** Writes by `builder` or `animator` that the launcher completed in this run. */
	fixWrites: number;
	plays: { requested: number; passed: number; failed: number; unplayed: number } | null;
}

/**
 * Why a submission is refused, or null. Code, not the model's say-so: a fix needs the verify step
 * and an edit made by a writing agent; an escalation names a real pipeline area and a title.
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
		if (s.verified === 'played_fail') {
			return 'A play that failed is not a fix. Fix it again, or submit another outcome.';
		}
		if (facts.fixWrites === 0) {
			return 'Nothing was changed in this run: no builder or animator write completed. Assign the fix first, or submit another outcome.';
		}
	}
	if (facts.plays) {
		const { requested, passed, failed } = facts.plays;
		if (s.outcome === 'fixed' && requested === 0) {
			return 'Play the draft again before concluding a fix.';
		}
		if (s.verified === 'played_pass' && passed === 0) {
			return 'verified says played_pass, but no play of this step passed.';
		}
		if (s.verified === 'played_fail' && failed === 0) {
			return 'verified says played_fail, but no play of this step failed.';
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
	budgetCapUsd: number | null;
}): string {
	return [
		'A new Invisible Director repair run. Read the bug, reproduce it, then fix and verify it.',
		'',
		JSON.stringify(brief, null, 2),
	].join('\n');
}
