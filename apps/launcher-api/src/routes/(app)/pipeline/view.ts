import type {
	ChangeDetail,
	ChangeStatus,
	CheckGroup,
	CheckJob,
	HarnessCheck,
} from '$lib/server/pipelineChanges';
import type { HarnessRow } from '$lib/server/pipelineReport';

/**
 * Pure helpers for the Changes tab: wording, tones and URLs derived from what
 * `/api/pipeline/changes` answers. No Svelte and no browser globals, so a Node fixture can import
 * it as it is.
 */

export type Tone = 'green' | 'red' | 'blue' | 'amber' | 'muted' | 'text';
export type PillTone = Exclude<Tone, 'text'>;

export const NO_CHECKS_TEXT = 'No checks have reported on this head yet.';
export const BLOCKED_CONFLICT_TEXT = 'Merge conflict with main: bring main in and resolve it.';
export const APPROVE_HINT = 'Approve each changed screen below, or push a fix.';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NAMES_SHOWN = 3;

export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/**
 * "just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", else the UTC date. A `Date` is
 * accepted because the server's row types say `Date` for what JSON delivers as a string.
 */
export function timeAgo(iso: string | Date, now: number = Date.now()): string {
	const then = iso instanceof Date ? iso.getTime() : Date.parse(iso);
	if (Number.isNaN(then)) return '';
	const age = now - then;
	if (age < MINUTE) return 'just now';
	if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
	if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
	if (age < 2 * DAY) return 'yesterday';
	if (age < 7 * DAY) return `${Math.floor(age / DAY)} days ago`;
	return new Date(then).toISOString().slice(0, 10);
}

export interface StatusPill {
	tone: PillTone;
	label: string;
	/** Testing is the only one with a live dot. */
	dot: boolean;
}

export function statusPill(status: ChangeStatus): StatusPill {
	if (status.kind === 'ready') return { tone: 'green', label: 'Ready to merge', dot: false };
	if (status.kind === 'blocked') return { tone: 'red', label: 'Blocked', dot: false };
	return { tone: 'blue', label: `Testing · ${status.done} of ${status.total}`, dot: true };
}

/** The text of an error answer: `{ error }` (502/503) or `{ message }` (a SvelteKit error). */
export function apiErrorText(status: number, body: unknown): string {
	if (body && typeof body === 'object') {
		const { error, message } = body as { error?: unknown; message?: unknown };
		if (typeof error === 'string' && error) return error;
		if (typeof message === 'string' && message) return message;
	}
	return `The request failed (${status}).`;
}

/** A check job's state as one word; a failure names its conclusion ("timed out", "cancelled"). */
export function jobWord(job: Pick<CheckJob, 'state' | 'conclusion'>): string {
	if (job.state === 'pass') return 'passed';
	if (job.state === 'pending') return 'running';
	if (job.state === 'skipped') return 'skipped';
	return job.conclusion && job.conclusion !== 'failure'
		? job.conclusion.replace(/_/g, ' ')
		: 'failed';
}

const listNames = (names: string[]): string =>
	names.length <= NAMES_SHOWN
		? names.join(', ')
		: `${names.slice(0, NAMES_SHOWN).join(', ')} and ${names.length - NAMES_SHOWN} more`;

const gameName = (row: HarnessRow): string =>
	row.variant === 'republished' ? `${row.name} (as republished)` : row.name;

const hardFailed = (row: HarnessRow): boolean =>
	row.build?.status === 'fail' || row.tests?.status === 'fail';

const rowFailed = (row: HarnessRow): boolean =>
	hardFailed(row) || row.looks.status === 'changed' || row.looks.status === 'error';

const stripPeriod = (s: string): string => s.replace(/\.+\s*$/, '');

/** What is wrong with one failing row, as clauses after "Breaks <game>:". */
function rowClauses(row: HarnessRow): string[] {
	const clauses: string[] = [];
	if (row.build?.status === 'fail') clauses.push('the build failed');
	if (row.tests?.status === 'fail') {
		const gates = (row.tests.gates ?? []).filter((g) => !g.pass).map((g) => g.gate);
		clauses.push(gates.length ? `its tests failed (${listNames(gates)})` : 'its tests failed');
	}
	if (row.looks.status === 'changed') {
		const screens = row.screens.filter((s) => !s.pass).map((s) => s.screen);
		const changed = row.looks.changed ?? screens.length;
		const of = row.looks.of ?? row.screens.length;
		const verb = of === 1 ? 'screen looks' : 'screens look';
		clauses.push(
			`${changed} of ${of} ${verb} different${screens.length ? ` (${listNames(screens)})` : ''}`,
		);
	}
	if (row.looks.status === 'error') {
		clauses.push(stripPeriod(row.looks.detail ?? 'its screens could not be compared'));
	}
	return clauses;
}

/** One "Breaks <game>: …" sentence per failing game of a ready report. */
function breakages(harness: HarnessCheck): string[] {
	if (harness.report.state !== 'ready') return [];
	return harness.report.report.games
		.filter(rowFailed)
		.map((row) => `Breaks ${gameName(row)}: ${rowClauses(row).join(' and ')}`);
}

export interface BlockedReason {
	text: string;
	/** Where to read more: the failed job, the harness run, or the pull request. */
	url: string | null;
}

/** Why a Blocked change is blocked, in the order the server decides it; `null` when it is not. */
export function blockedReason(detail: ChangeDetail): BlockedReason | null {
	if (detail.status.kind !== 'blocked') return null;
	if (detail.mergeableState === 'dirty') return { text: BLOCKED_CONFLICT_TEXT, url: detail.url };
	for (const group of detail.checks) {
		const failed = group.jobs.find((j) => j.state === 'fail');
		if (failed) {
			return {
				text: `${group.workflow}: ${failed.name} ${jobWord(failed)}`,
				url: failed.url ?? group.url,
			};
		}
	}
	const { harness } = detail;
	const status = harness.status;
	if (status && (status.state === 'failure' || status.state === 'error')) {
		const url = status.url ?? harness.run?.url ?? null;
		const sentences = breakages(harness);
		if (sentences.length) {
			const hint = harness.unapprovable === null ? ` ${APPROVE_HINT}` : '';
			return { text: `${sentences.join('; ')}.${hint}`, url };
		}
		return { text: `current-games: ${status.description ?? 'failed'}`, url };
	}
	return { text: detail.status.reason, url: detail.url };
}

export function blockedSentence(detail: ChangeDetail): string {
	return blockedReason(detail)?.text ?? '';
}

export interface Check1Summary {
	kind: 'none' | 'pass' | 'fail' | 'pending';
	passed: number;
	total: number;
	label: string;
}

export function check1Summary(checks: CheckGroup[]): Check1Summary {
	const passed = checks.reduce((n, g) => n + g.passed, 0);
	const total = checks.reduce((n, g) => n + g.total, 0);
	if (!checks.length) return { kind: 'none', passed, total, label: 'No checks yet' };
	if (checks.some((g) => g.state === 'fail'))
		return { kind: 'fail', passed, total, label: 'failed' };
	if (checks.some((g) => g.state === 'pending')) {
		return { kind: 'pending', passed, total, label: `running · ${passed} of ${total}` };
	}
	if (!total) return { kind: 'pass', passed, total, label: 'nothing to run' };
	return { kind: 'pass', passed, total, label: `${passed} of ${total} passed` };
}

export interface Check2Summary {
	tone: PillTone;
	label: string;
}

export function check2Summary(harness: HarnessCheck): Check2Summary {
	const state = harness.report;
	switch (state.state) {
		case 'ready': {
			const { summary, aborted } = state.report;
			if (summary.verdict === 'pass') {
				return { tone: 'green', label: `${summary.rendered} of ${summary.rendered} unchanged` };
			}
			const changed = summary.changedScreens.length;
			if (aborted || state.report.games.some(hardFailed) || !changed) {
				return { tone: 'red', label: 'failed' };
			}
			return { tone: 'red', label: `${changed} changed ${plural(changed, 'screen')}` };
		}
		case 'running':
			return { tone: 'blue', label: 'running' };
		case 'none':
			return { tone: 'muted', label: 'not started' };
		case 'skipped':
			return { tone: 'green', label: 'nothing to render' };
		default:
			return { tone: 'amber', label: state.state };
	}
}

/** One image of the report's full artifact, by the artifact's id (a re-run replaces it). */
export function reportImageUrl(number: number, imagesArtifactId: number, path: string): string {
	const segments = path.split('/').map(encodeURIComponent).join('/');
	return `/api/pipeline/changes/${number}/report/${segments}?artifact=${imagesArtifactId}`;
}

/** The id of the artifact that holds the screen images; `null` when it is gone or no report. */
export function imagesArtifactId(harness: HarnessCheck): number | null {
	return harness.report.state === 'ready' ? (harness.report.images?.artifactId ?? null) : null;
}

export interface Cell {
	text: string;
	tone: Tone;
}

const LOOKS_WORDS: Record<string, string> = {
	'own-bundle': 'Own bundle: build and tests only',
	'no-snapshot': 'Not rendered (no snapshot)',
	unpublished: 'Not rendered (not published)',
	refused: "Not rendered (main's runtime refuses the snapshot)",
	skip: 'Skipped',
};

const statusWord = (status: string): string => {
	const words = status.replace(/[-_]/g, ' ').trim();
	return words ? words[0].toUpperCase() + words.slice(1) : '—';
};

export function rowCells(row: HarnessRow): { build: Cell; tests: Cell; looks: Cell } {
	const build: Cell =
		row.build?.status === 'pass'
			? { text: 'Passed', tone: 'green' }
			: row.build?.status === 'fail'
				? { text: 'Failed', tone: 'red' }
				: { text: statusWord(row.build?.status ?? ''), tone: 'muted' };

	const gates = row.tests?.gates;
	const tests: Cell = gates?.length
		? {
				text: `${gates.filter((g) => g.pass).length} / ${gates.length}`,
				tone: row.tests.status === 'fail' ? 'red' : 'text',
			}
		: row.tests?.status === 'pass'
			? { text: 'Passed', tone: 'green' }
			: row.tests?.status === 'fail'
				? { text: 'Failed', tone: 'red' }
				: { text: statusWord(row.tests?.status ?? ''), tone: 'muted' };

	const { looks } = row;
	let cell: Cell;
	if (looks.status === 'same') {
		cell = {
			text: looks.of === undefined ? 'Same' : `Same on ${looks.of} ${plural(looks.of, 'screen')}`,
			tone: 'green',
		};
	} else if (looks.status === 'changed') {
		cell = { text: `${looks.changed ?? '?'} of ${looks.of ?? '?'} changed`, tone: 'red' };
	} else if (looks.status === 'error') {
		cell = { text: looks.detail ?? 'Error', tone: 'red' };
	} else {
		cell = { text: LOOKS_WORDS[looks.status] ?? statusWord(looks.status), tone: 'muted' };
	}
	return { build, tests, looks: cell };
}

export type ApprovalState = 'none' | 'partial' | 'complete' | 'complete-unposted';

/**
 * Where the approval set stands: `complete` when every changed screen has an approval that counts
 * and `current-games` is success; `complete-unposted` when every one is approved and the set can
 * clear the run, but the status is not success (a re-run on the same head reset it).
 */
export function approvalState(harness: HarnessCheck): ApprovalState {
	const { diffs } = harness;
	const approved = diffs.filter((d) => d.approval).length;
	if (!approved) return 'none';
	if (approved < diffs.length) return 'partial';
	if (harness.status?.state === 'success') return 'complete';
	return harness.unapprovable === null ? 'complete-unposted' : 'partial';
}

/** Approvals on a changed screen that no longer count: their approver lost `pipelineMerge`. */
export function lapsedApprovals(harness: HarnessCheck, diffId: string) {
	return harness.approvals.filter((a) => a.diffId === diffId && !a.standing);
}

export interface ApprovalBlocker {
	text: string;
	/** The change edits the harness or is too large to check: it merges by hand. */
	byHand: boolean;
}

/**
 * The banner above the report when approvals cannot clear it. The server's sentence for a report
 * that is not ready is the report's own detail, and a passing report has nothing to approve; both
 * are said elsewhere, so only a by-hand merge or a failing ready report raises it here.
 */
export function approvalBlocker(harness: HarnessCheck): ApprovalBlocker | null {
	const text = harness.unapprovable;
	if (text === null) return null;
	if (/manual merge/i.test(text)) return { text, byHand: true };
	const { report } = harness;
	if (report.state === 'ready' && report.report.summary.verdict === 'fail') {
		return { text, byHand: false };
	}
	return null;
}
