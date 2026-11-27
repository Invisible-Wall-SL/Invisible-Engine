import { parseFixRunBranch } from '$lib/bugFixRuns';
import { bugPath, bugRef } from '$lib/bugReports';
import {
	afterAcceptText,
	isLiveMergeRun,
	type MergeChoice,
	type FileDiff,
	type MergeRunExplanation,
	type MergeRunFileView,
	type MergeRunHunk,
	type MergeRunView,
	type MergeRunsAnswer,
	type MergeTakes,
} from '$lib/mergeMainRuns';
import type { AgentLastChange } from '$lib/server/pipelineAgents';
import type {
	AgentEvalCheck,
	ChangeDetail,
	ChangeFixRun,
	ChangeStatus,
	ChangeSummary,
	CheckGroup,
	CheckJob,
	HarnessCheck,
} from '$lib/server/pipelineChanges';
import type { MergeHistoryEntry } from '$lib/server/pipelineMerge';
import type { CompletedMerge, PipelineMerge } from '$lib/server/pipelineMerges';
import type { HarnessRow } from '$lib/server/pipelineReport';
import type {
	EvalElementView,
	EvalReport,
	EvalSide,
} from '../../../../../../services/director-worker/src/eval/report';

/**
 * Pure helpers for the Changes, Agents and History tabs: wording, tones and URLs derived from what
 * `/api/pipeline/changes`, `/api/pipeline/agents` and `/api/pipeline/merges` answer. No Svelte and no browser globals, so a
 * Node fixture can import it as it is.
 */

export type Tone = 'green' | 'red' | 'blue' | 'amber' | 'muted' | 'text';
export type PillTone = Exclude<Tone, 'text'>;

export const NO_CHECKS_TEXT = 'No checks have reported on this head yet.';
export const BLOCKED_CONFLICT_TEXT = 'Merge conflict with main.';
export const APPROVE_HINT = 'Approve each changed screen below, or push a fix.';
export const MERGE_NEEDS_CAPABILITY_TEXT = 'Merging needs the “Merge pipeline changes” permission.';
export const MERGE_DRAFT_TEXT = 'This change is a draft: mark it ready for review first.';
export const READY_NEEDS_CAPABILITY_TEXT =
	'This change is a draft. Marking it ready for review needs the “Merge pipeline changes” permission.';
export const MERGE_RETRY_TEXT = 'Try again resends the same request, so it never merges twice.';
export const ON_HOLD_OFFERS_TEXT =
	'This change is on hold: resume it before updating, re-recording or merging.';
export const UPDATE_DONE_TEXT = 'GitHub is merging main in; CI re-runs on the new head.';
/** Days a draft stays in conflict before the page offers to put it on hold. */
export const HOLD_HINT_DAYS = 14;
export const ROLLBACK_NEEDS_CAPABILITY_TEXT =
	'Rolling back needs the Merge pipeline changes capability.';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NAMES_SHOWN = 3;

export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/**
 * A link the page will render: GitHub's own pages, nothing else. A check run, a commit status or
 * a file URL is written by whatever posted it — a branch's own workflow can post a status with any
 * `target_url` — so anything but `https://github.com/…` renders as text.
 */
export function safeHref(url: string | null | undefined): string | null {
	return typeof url === 'string' && /^https:\/\/github\.com\//.test(url) ? url : null;
}

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

/** The pill of a change in the list or the detail: a held change is grey and never Blocked. */
export function changePill(change: Pick<ChangeSummary, 'status' | 'onHold'>): StatusPill {
	if (change.onHold) return { tone: 'muted', label: 'On hold', dot: false };
	return statusPill(change.status);
}

/** Held changes sort last; the order within each group is kept. */
export function sortChanges<T extends Pick<ChangeSummary, 'onHold'>>(changes: T[]): T[] {
	return [...changes].sort((a, b) => Number(a.onHold) - Number(b.onHold));
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
	if (detail.onHold || detail.status.kind !== 'blocked') return null;
	if (detail.mergeableState === 'dirty') {
		return { text: BLOCKED_CONFLICT_TEXT, url: safeHref(detail.url) };
	}
	for (const group of detail.checks) {
		const failed = group.jobs.find((j) => j.state === 'fail');
		if (failed) {
			return {
				text: `${group.workflow}: ${failed.name} ${jobWord(failed)}`,
				url: safeHref(failed.url ?? group.url),
			};
		}
	}
	const agentEval = detail.agentEval;
	if (agentEval?.blocking) {
		return {
			text: `agent-eval: ${agentEval.blocking}`,
			url: safeHref(agentEval.run?.url) ?? (agentEval.run ? safeHref(agentEval.status?.url) : null),
		};
	}
	const { harness } = detail;
	const status = harness.status;
	if (status && (status.state === 'failure' || status.state === 'error')) {
		const url = safeHref(status.url) ?? safeHref(harness.run?.url);
		const sentences = breakages(harness);
		if (sentences.length) {
			const hint = harness.unapprovable === null ? ` ${APPROVE_HINT}` : '';
			return { text: `${sentences.join('; ')}.${hint}`, url };
		}
		return { text: `current-games: ${status.description ?? 'failed'}`, url };
	}
	return { text: detail.status.reason, url: safeHref(detail.url) };
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

export const shortSha = (sha: string): string => sha.slice(0, 7);

export function mergeConfirmMessage(
	detail: Pick<ChangeDetail, 'number' | 'title' | 'headSha'>,
): string {
	return `${detail.title}\n\nSquash-merges head ${shortSha(detail.headSha)} (${detail.headSha}) into main as "${detail.title} (#${detail.number})". Branch protection still applies.`;
}

export const FIX_NOT_RECORDED_TEXT = 'Not recorded for this change';
export const FIX_DECISION_FALLBACK_TEXT = 'The decision this change answers to is not current.';

/** The sentence that stops a fix-run change at Mark ready and merge; `null` when nothing does. */
export function fixDecisionBlock(detail: { fixRun?: ChangeFixRun | null }): string | null {
	const decision = detail.fixRun?.decision;
	return decision && !decision.ok ? decision.reason || FIX_DECISION_FALLBACK_TEXT : null;
}

export interface FixApprovalRow {
	label: string;
	/** `null` shows "Not recorded for this change". */
	text: string | null;
}

export interface FixApproval {
	rows: FixApprovalRow[];
	/** One line per option that was not chosen; folded, and absent when there are none. */
	others: string[];
	/** Why this change cannot be marked ready or merged; `null` when the decision holds. */
	blocked: string | null;
	bugRef: string;
	bugHref: string;
}

/**
 * What the "What you're approving" card shows for a change a fix run built (ADR-0014 §3), or
 * `null` for any other change. A part the change does not have is `text: null`, never left out.
 */
export function fixApprovalState(
	detail: { fixRun: ChangeFixRun | null },
	now: number = Date.now(),
): FixApproval | null {
	const run = detail.fixRun;
	if (!run) return null;
	const { choice, diagnosis, explanation } = run;
	const chosen = choice
		? `${choice.optionId} — ${choice.name}\n${choice.change}\nchosen by ${choice.decidedBy} · ${timeAgo(choice.decidedAt, now)}${choice.note ? `\nNote: ${choice.note}` : ''}`
		: null;
	return {
		rows: [
			{ label: 'What you reported', text: diagnosis?.reported || null },
			{ label: 'What was wrong', text: diagnosis?.cause || null },
			{ label: 'The option you chose', text: chosen },
			{ label: 'What changed', text: explanation?.changed || null },
			{ label: 'How to check it yourself', text: explanation?.howToCheck || null },
			{ label: 'Risks', text: explanation?.risks || null },
		],
		others: (diagnosis?.otherOptions ?? []).map((o) => `${o.id} — ${o.name}: ${o.change}`),
		blocked: fixDecisionBlock(detail),
		bugRef: bugRef(run.bug),
		bugHref: bugPath({ number: run.bug, kind: 'pipeline', projectKey: null }),
	};
}

/** The bug a change's branch names as its fix run (`bug-<n>-fix-<id>`), as the list's tag. */
export function fixRunTag(branch: string): { bug: number; text: string } | null {
	const named = parseFixRunBranch(branch);
	return named && { bug: named.bug, text: `fix run · ${bugRef(named.bug)}` };
}

export interface MergeBar {
	/** `draft` shows no merge button (the draft bar offers Mark ready for review); `null` shows none. */
	action: 'merge' | 'draft' | null;
	text: string;
}

/**
 * What the bar under a Ready change offers. Nobody merges a by-hand change from here, so that is
 * said before the capability; a draft is said only to someone who could merge it.
 */
export function mergeBar(
	detail: Pick<ChangeDetail, 'draft' | 'headSha' | 'filesTruncated'> & {
		fixRun?: ChangeFixRun | null;
		onHold?: boolean;
	},
	canMerge: boolean,
	byHand: boolean,
): MergeBar {
	if (detail.onHold) return { action: null, text: ON_HOLD_OFFERS_TEXT };
	if (byHand) {
		const why = detail.filesTruncated ? 'is too large to check' : 'edits the harness';
		return { action: null, text: `Merge by hand on GitHub after review: this change ${why}.` };
	}
	const fixBlock = fixDecisionBlock(detail);
	if (fixBlock) return { action: null, text: fixBlock };
	if (!canMerge) return { action: null, text: MERGE_NEEDS_CAPABILITY_TEXT };
	if (detail.draft) return { action: 'draft', text: MERGE_DRAFT_TEXT };
	return {
		action: 'merge',
		text: `Squash-merges head ${shortSha(detail.headSha)} into main. You can roll back from History.`,
	};
}

export interface ReadyBar {
	/** `ready` offers Mark ready for review; `null` only says why it is not offered. */
	action: 'ready' | null;
	text: string;
}

/**
 * The bar under an OPEN DRAFT change, whatever its checks say (ADR-0013 §8; a fix run's pull
 * request opens as a draft): `pipelineMerge` holders get Mark ready for review, who cannot merge
 * are told why they cannot. Nothing for a change that is not an open draft.
 */
export function readyBar(
	detail: Pick<ChangeDetail, 'draft' | 'state'> & {
		fixRun?: ChangeFixRun | null;
		onHold?: boolean;
	},
	canMerge: boolean,
): ReadyBar | null {
	if (detail.state !== 'open' || !detail.draft || detail.onHold) return null;
	const fixBlock = fixDecisionBlock(detail);
	if (fixBlock) return { action: null, text: fixBlock };
	if (!canMerge) return { action: null, text: READY_NEEDS_CAPABILITY_TEXT };
	return {
		action: 'ready',
		text: 'This change is a draft, and a draft cannot merge. Marking it ready for review does not merge it.',
	};
}

/** The words `check-runtime-bytes.mjs` ends a failed comparison on, which its annotation carries. */
export const RUNTIME_BYTES_SENTENCE = 'a runtime is not the bytes it was';
/** The check run, and its workflow, that compares the runtimes with their manifests. */
export const RUNTIME_BYTES_JOB = 'runtime-bytes';
export const RERECORD_NOTE_TEXT =
	'CI re-checks the new head; if main changed the runtimes meanwhile, re-record again.';

export interface RerecordBar {
	/** The head the failed run built: what the server pins the commit to. */
	headSha: string;
}

/**
 * Re-record runtime bytes: offered on an open change whose newest `runtime-bytes` job failed with
 * the closing sentence of `check:runtime-bytes` (not for a leak it cannot tell from a change, and
 * not for any other failure), to a `pipelineMerge` holder. Changes are branches of this repository
 * only (forks are never listed), and the server refuses a head that moved. Null: nothing to offer.
 */
export function rerecordBar(
	detail: Pick<ChangeDetail, 'state' | 'merged' | 'headSha' | 'checks'> & { onHold?: boolean },
	canMerge: boolean,
): RerecordBar | null {
	if (!canMerge || detail.state !== 'open' || detail.merged || detail.onHold) return null;
	const job = detail.checks
		.flatMap((g) => g.jobs)
		.filter((j) => j.name === RUNTIME_BYTES_JOB)
		.at(-1);
	if (job?.state !== 'fail' || !job.instruction?.includes(RUNTIME_BYTES_SENTENCE)) return null;
	return { headSha: detail.headSha };
}

export interface UpdateBar {
	/** The head the page showed: what the server pins `update-branch` to. */
	headSha: string;
	text: string;
}

/**
 * Update from main (ADR-0015 §1): offered to a `pipelineMerge` holder on an open change that is not
 * on hold, that GitHub says merges cleanly, and that is behind `main` (`behindBy`, read in the
 * detail). Changes are branches of this repository only. Null: nothing to offer.
 */
export function updateBar(
	detail: Pick<ChangeDetail, 'state' | 'merged' | 'mergeable' | 'headSha' | 'behindBy'> & {
		onHold?: boolean;
	},
	canMerge: boolean,
): UpdateBar | null {
	if (!canMerge || detail.state !== 'open' || detail.merged || detail.onHold) return null;
	if (detail.mergeable !== true || !detail.behindBy || detail.behindBy < 1) return null;
	const n = detail.behindBy;
	return {
		headSha: detail.headSha,
		text: `${n} ${plural(n, 'commit')} behind main. GitHub merges main into this branch; there is nothing to choose.`,
	};
}

/** What the page does with a refused update: GitHub's own link only for the workflow refusal. */
export function updateRefusalView(
	status: number,
	body: unknown,
): { text: string; href: string | null } {
	const { code, url } = (body && typeof body === 'object' ? body : {}) as {
		code?: unknown;
		url?: unknown;
	};
	return {
		text: apiErrorText(status, body),
		href: code === 'workflow_refused' && typeof url === 'string' ? safeHref(url) : null,
	};
}

/** "On hold", or "On hold · since 2026-11-20" (UTC date of the label). */
export function heldText(since: string | null): string {
	const date = since ? new Date(since) : null;
	return date && !Number.isNaN(date.getTime())
		? `On hold · since ${date.toISOString().slice(0, 10)}`
		: 'On hold';
}

/** Put on hold is a general action: any open change not already held, for a `pipelineMerge` holder. */
export function holdOffered(
	detail: Pick<ChangeDetail, 'state' | 'merged'> & { onHold?: boolean },
	canMerge: boolean,
): boolean {
	return canMerge && detail.state === 'open' && !detail.merged && !detail.onHold;
}

export interface HoldBar {
	/** `null` shows the sentence only (no permission). */
	action: 'hold' | 'resume' | null;
	text: string;
}

/**
 * The hold bar: a held change says so, with Resume for a `pipelineMerge` holder; a DRAFT blocked by
 * a conflict whose head commit is `HOLD_HINT_DAYS` or more old says how far behind it is, with Put
 * on hold. Nothing otherwise.
 */
export function holdBar(
	detail: Pick<
		ChangeDetail,
		'state' | 'merged' | 'draft' | 'mergeableState' | 'behindBy' | 'headCommittedAt' | 'heldSince'
	> & { onHold?: boolean },
	canMerge: boolean,
	now: number = Date.now(),
): HoldBar | null {
	if (detail.state !== 'open' || detail.merged) return null;
	if (detail.onHold)
		return { action: canMerge ? 'resume' : null, text: heldText(detail.heldSince) };
	if (!detail.draft || detail.mergeableState !== 'dirty' || !detail.headCommittedAt) return null;
	const age = Math.floor((now - Date.parse(detail.headCommittedAt)) / DAY);
	if (!(age >= HOLD_HINT_DAYS)) return null;
	const behind = detail.behindBy
		? `${detail.behindBy} ${plural(detail.behindBy, 'commit')} behind main`
		: 'Behind main';
	return { action: canMerge ? 'hold' : null, text: `${behind} for ${age} days` };
}

// ── Resolve conflict (ADR-0015 §5) ────────────────────────────────────────────

export const PUSHED_RECENTLY_MS = HOUR;
export const PUSHED_RECENTLY_TEXT =
	'This branch was pushed in the last hour. A session may still be working on it, and must pull before its next push.';
export const MERGE_BRANCH_MOVED_TEXT = 'The branch moved; resolve again.';

/**
 * Resolve conflict is offered to a `pipelineMerge` holder on an open change that GitHub says
 * conflicts with `main`, that is not on hold and has no merge run going or waiting — and only while
 * GitHub has an active `merge-main.yml` (`merge.ready`), so a button that can only fail is not shown.
 */
export function resolveOffered(
	detail: Pick<ChangeDetail, 'state' | 'merged' | 'mergeableState'> & { onHold?: boolean },
	merge: Pick<MergeRunsAnswer, 'ready' | 'run'> | null,
	canMerge: boolean,
): boolean {
	if (!canMerge || !merge?.ready) return false;
	if (detail.state !== 'open' || detail.merged || detail.onHold) return false;
	if (detail.mergeableState !== 'dirty') return false;
	return !(merge.run && isLiveMergeRun(merge.run.status));
}

export interface MergeRunLine {
	tone: 'blue' | 'amber' | 'red';
	text: string;
	/** A run that ended asking for a person: the card offers Copy merge brief. */
	brief: boolean;
}

/**
 * An Accept's claim whose lease ran out: nobody is accepting any more, and Accept is offered again.
 * The server says so, by the DATABASE's clock (`acceptLapsed` in the view); this page's own clock is
 * never compared with a timestamp the database made.
 */
export const acceptLapsed = (run: Pick<MergeRunView, 'status' | 'acceptLapsed'>): boolean =>
	run.status === 'accepting' && run.acceptLapsed;

/**
 * The newest merge run's line while it works, or when it ended without a proposal to show. Null for
 * a proposal (its card), an accepted or discarded run, and a cancelled one.
 */
export function mergeRunLine(
	run: MergeRunView | null,
	now: number = Date.now(),
): MergeRunLine | null {
	if (!run) return null;
	const since = `started ${timeAgo(run.createdAt, now)} by ${run.startedBy}`;
	switch (run.status) {
		case 'dispatched':
			return {
				tone: 'blue',
				brief: false,
				text: `Resolving the conflict: waiting for the job (${since}).`,
			};
		case 'running':
			return {
				tone: 'blue',
				brief: false,
				text: `Resolving the conflict: the job is working (${since}).`,
			};
		case 'accepting':
			return acceptLapsed(run)
				? null
				: {
						tone: 'blue',
						brief: false,
						text: `Accepting… by ${run.acceptedBy ?? 'a person'} (${timeAgo(run.acceptingAt ?? run.updatedAt, now)}).`,
					};
		case 'stale':
			return { tone: 'amber', brief: false, text: run.reason ?? MERGE_BRANCH_MOVED_TEXT };
		case 'needs_person':
			return { tone: 'amber', brief: true, text: run.reason ?? 'This conflict needs a person.' };
		case 'no_proposal':
		case 'failed':
			return { tone: 'red', brief: false, text: run.reason ?? 'The run ended without a proposal.' };
		default:
			return null;
	}
}

const CHOICE_TEXT: Record<MergeChoice, string> = {
	main: "took main's",
	change: "kept this change's",
	both: 'kept both',
	combined: 'combined both',
};
const TAKES_TEXT: Record<MergeTakes, string> = {
	main: "main's",
	change: "this change's",
	both: 'both',
	combined: 'a combination',
};

export const choiceWord = (choice: MergeChoice): string => CHOICE_TEXT[choice];
export const takesWord = (takes: MergeTakes): string => TAKES_TEXT[takes];

export const RESULT_NOT_LOCATED =
	'The resolved lines could not be located in the final file: read "What Accept changes on this branch" under the file below, or open the resolved file.';

/** The diff of one file of the proposal: what Accept changes on the branch there, or null when it takes nothing from the run. */
export const diffOf = (explanation: MergeRunExplanation | null, path: string): FileDiff | null =>
	explanation?.diff.find((d) => d.path === path) ?? null;

/** A diff line's two gutters: its number in the branch's version and in the merged file. */
export const gutter = (n: number | null): string => (n === null ? '' : String(n));

/** The sign a diff line is drawn with. */
export const DIFF_SIGN = { ctx: ' ', del: '-', add: '+' } as const;

/** The notice under a result the job cut at its cap: Accept pushes the whole file. */
export const resultCutText = (lines: number): string =>
	`[${lines} ${plural(lines, 'line')} of the result ${lines === 1 ? 'is' : 'are'} not shown: read the diff under the file below, or open the resolved file, before accepting.]`;

/**
 * One hunk as the card's three columns: main's and this change's lines as git had them, and the
 * result. For a `lines` hunk the result is the resolved file's own lines at the hunk, found by the
 * job from git's clean pieces around it (§10), never the model's words, with a notice when the job
 * had to cut it; when the job could not place it, the card says so and shows nothing else (never
 * what the hunk says it took). For a `description` hunk (a rule's or a modify/delete: its `main` and
 * `change` are words) the result follows what it took, and a combination has only what `nowDoes`
 * says.
 */
export function hunkColumns(
	h: Pick<MergeRunHunk, 'main' | 'change' | 'takes' | 'nowDoes' | 'result' | 'resultCut' | 'kind'>,
): { main: string; change: string; result: string } {
	let result: string;
	if (h.result !== null) {
		result = h.resultCut > 0 ? `${h.result}\n${resultCutText(h.resultCut)}` : h.result;
	} else if (h.kind === 'lines') result = RESULT_NOT_LOCATED;
	else if (h.takes === 'main') result = h.main;
	else if (h.takes === 'change') result = h.change;
	else if (h.takes === 'both') result = `${h.change}\n${h.main}`;
	else result = h.nowDoes ?? '';
	return { main: h.main, change: h.change, result };
}

/**
 * The body of an Accept: the head THIS PAGE showed the person (`detail.headSha`), not the run's, so a
 * branch that moved since the page loaded is refused as stale instead of accepted.
 */
export const acceptBody = (detail: Pick<ChangeDetail, 'headSha'>): { headSha: string } => ({
	headSha: detail.headSha,
});

export interface ProposalSection {
	key: string;
	title: string;
	/** Plain text lines; the page never renders them as HTML. */
	lines: string[];
}

/** What follows Accept, one line per file a build rule left as main's (§3); no job builds it. */
export function afterAcceptLines(files: Pick<MergeRunFileView, 'path' | 'rule'>[]): string[] {
	return files.flatMap((f) => {
		const text = afterAcceptText(f);
		return text ? [`${f.path}: ${text}`] : [];
	});
}

/** ADR-0015 §4's sections of an explanation, those that have content. */
export function proposalSections(
	e: MergeRunExplanation,
	files: Pick<MergeRunFileView, 'path' | 'rule'>[] = [],
): ProposalSection[] {
	const sections: ProposalSection[] = [
		{
			key: 'conflicted',
			title: 'What conflicted',
			lines: e.conflicted.map((c) => {
				const met = c.met.map((m) => (m.pr === null ? m.title : `#${m.pr} ${m.title}`));
				return met.length ? `${c.path}: met ${met.join('; ')}` : c.path;
			}),
		},
		{
			key: 'takes',
			title: 'What the resolution takes',
			lines: e.hunks.map((h) => `${h.path} (hunk ${h.index + 1}): ${takesWord(h.takes)}. ${h.why}`),
		},
		{
			key: 'now-does',
			title: 'What the merged code now does',
			lines: e.hunks
				.filter((h) => h.nowDoes)
				.map((h) => `${h.path} (hunk ${h.index + 1}): ${h.nowDoes}`),
		},
		{
			key: 'otherwise',
			title: 'What else was possible',
			lines: e.hunks
				.filter((h) => h.otherwise)
				.map((h) => `${h.path} (hunk ${h.index + 1}): ${h.otherwise}`),
		},
		{
			key: 'outside',
			title: 'Also changed outside the conflict',
			lines: e.outside.map((o) => `${o.path}: ${o.what}`),
		},
		{
			key: 'checks',
			title: 'Checks run',
			lines: e.checks.map((c) => `${c.ok ? 'passed' : 'failed'}: ${c.command}`),
		},
		{ key: 'after-accept', title: 'What follows Accept', lines: afterAcceptLines(files) },
		{ key: 'risks', title: 'Risks', lines: e.risks ? [e.risks] : [] },
	];
	return sections.filter((s) => s.lines.length > 0);
}

export interface ProposalBar {
	/** "Resolved against main at 1a2b3c4, 3 commits behind now." */
	headline: string;
	cost: string | null;
	/** The branch was pushed in the last hour: a session may be working on it. */
	pushedRecently: boolean;
	/** Why Accept is not offered, or null when it is. */
	blocked: string | null;
	/** Accept and Discard are the `pipelineMerge` holder's. */
	canAct: boolean;
}

/**
 * What the proposal card shows around the explanation: the commit it was resolved against and how
 * far `main` has moved, the cost, a warning for a branch pushed in the last hour, and whether Accept
 * is offered (the change's head must still be the run's: otherwise the proposal is stale).
 */
export function proposalBar(
	run: Pick<MergeRunView, 'status' | 'mainSha' | 'headSha' | 'spendUsd' | 'acceptLapsed'>,
	detail: Pick<ChangeDetail, 'headSha' | 'state' | 'onHold'>,
	facts: Pick<MergeRunsAnswer, 'behindNow' | 'headCommittedAt'>,
	canMerge: boolean,
	now: number = Date.now(),
): ProposalBar | null {
	if (run.status !== 'proposed' && !acceptLapsed(run)) return null;
	const behind =
		facts.behindNow === null
			? ''
			: facts.behindNow === 0
				? ', main has not moved since'
				: `, ${facts.behindNow} ${plural(facts.behindNow, 'commit')} behind now`;
	const committed = facts.headCommittedAt ? Date.parse(facts.headCommittedAt) : NaN;
	return {
		headline: `Resolved against main at ${shortSha(run.mainSha)}${behind}.`,
		cost: run.spendUsd === null ? null : `Cost ${money(run.spendUsd)}`,
		pushedRecently: now - committed >= 0 && now - committed < PUSHED_RECENTLY_MS,
		blocked:
			detail.state !== 'open'
				? 'This change is not open.'
				: detail.onHold
					? ON_HOLD_OFFERS_TEXT
					: detail.headSha !== run.headSha
						? MERGE_BRANCH_MOVED_TEXT
						: null,
		canAct: canMerge,
	};
}

export interface MergedInCard {
	title: string;
	rows: { path: string; text: string }[];
}

/** The "Main merged in" card of an accepted run: who and when, against which `main`, each choice. */
export function mergedInCard(
	run: MergeRunView | null,
	now: number = Date.now(),
): MergedInCard | null {
	if (!run || run.status !== 'accepted') return null;
	return {
		title: `Main merged in · ${run.acceptedBy ?? 'a person'} · ${timeAgo(run.finishedAt ?? run.updatedAt, now)} · main at ${shortSha(run.mainSha)}`,
		rows: run.files.map((f) => ({
			path: f.path,
			text: `${choiceWord(f.choice)}${f.choice === 'combined' ? '; now differs from both sides' : ''}${f.deleted ? '; deleted' : ''}${afterAcceptText(f) ? `. ${afterAcceptText(f)}` : ''}`,
		})),
	};
}

/** What a session needs to do the merge by hand: Copy merge brief. Public data only. */
export function mergeBrief(
	detail: Pick<ChangeDetail, 'number' | 'branch' | 'url' | 'headSha'>,
	run: MergeRunView,
): string {
	const lines = [
		`Merge main into ${detail.branch} (${detail.url}).`,
		`Head ${detail.headSha}; main at ${run.mainSha}.`,
		`Why a person is needed: ${run.reason ?? 'the run did not say.'}`,
	];
	const hunks = run.explanation?.hunks ?? [];
	if (run.files.length) {
		lines.push(
			'Files the run resolved:',
			...run.files.map((f) => `- ${f.path}: ${choiceWord(f.choice)}`),
		);
	}
	if (hunks.length) {
		lines.push(
			'Choices it proposed:',
			...hunks.map((h) => `- ${h.path} (hunk ${h.index + 1}): ${takesWord(h.takes)}. ${h.why}`),
		);
	}
	lines.push(
		'Merge origin/main into the branch yourself, apply these choices, run the checks of the packages you touch, and push. Do not rebase or force-push.',
	);
	return lines.join('\n');
}

/** The bar after a merge: "Merged into main as <sha> by <who> · just now". */
export function mergedText(
	result: { merge: Pick<CompletedMerge, 'mergeSha' | 'mergedBy' | 'at'>; already: boolean },
	now: number,
): string {
	const { merge } = result;
	const verb = result.already ? 'Already merged' : 'Merged';
	return `${verb} into main as ${shortSha(merge.mergeSha)} by ${merge.mergedBy} · ${timeAgo(merge.at, now)}`;
}

/** The branch the server opens a rollback on (`revertMerge` in `pipelineMerge.ts` names it so). */
export const revertBranchOf = (merge: Pick<CompletedMerge, 'prNumber' | 'mergeSha'>): string =>
	`revert/${merge.prNumber}-${shortSha(merge.mergeSha)}`;

export function rollbackConfirmMessage(
	merge: Pick<CompletedMerge, 'prNumber' | 'title' | 'mergeSha'>,
): string {
	return `${merge.title}\n\nOpens a revert pull request of merge ${shortSha(merge.mergeSha)} on branch ${revertBranchOf(merge)}. It goes through the same checks and approvals; nothing changes on main until it merges.`;
}

/** "No changed screens", or "2 approved screens · by Gualtiero, tester". */
export function approvalsSummary(merge: Pick<PipelineMerge, 'approvals'>): string {
	const { approvals } = merge;
	if (!approvals.length) return 'No changed screens';
	const names = [...new Set(approvals.map((a) => a.approver))];
	return `${approvals.length} approved ${plural(approvals.length, 'screen')} · by ${listNames(names)}`;
}

export type HistoryRowState = 'reverted' | 'revert-open' | 'rollbackable';

/** A merge rolls back once: not after its revert merged, nor while a revert of it is open. */
export function historyRowState(
	entry: Pick<MergeHistoryEntry, 'revertedBy' | 'revertOpen'>,
): HistoryRowState {
	if (entry.revertedBy) return 'reverted';
	if (entry.revertOpen) return 'revert-open';
	return 'rollbackable';
}

// ── Agents tab and the "Agent evaluation" check ────────────────────────────────

/** A 0..1 score as a whole percent: the same rounding the status line uses. */
export const pct = (score: number): string => `${Math.round(score * 100)}%`;

export const money = (usd: number): string => `$${usd.toFixed(2)}`;

/** An agent's effort, or what steers a model that has none (Haiku's thinking budget). */
export const effortWord = (effort: string | null): string => effort ?? 'thinking budget';

/** The same, for a chip or a card line: "medium effort" or "thinking budget". */
export const effortLabel = (effort: string | null): string =>
	effort ? `${effort} effort` : effortWord(effort);

export const toolsWord = (n: number): string => `${n} ${plural(n, 'tool')}`;

export const openChangesWord = (n: number): string => `${n} open ${plural(n, 'change')}`;

export const charsWord = (n: number): string =>
	`${n.toLocaleString('en-US')} ${plural(n, 'character')}`;

/** "Changed 2 h ago by Ana", "Changed on 2026-08-01 by Ana", or "no change recorded". */
export function changedText(
	last: Pick<AgentLastChange, 'date' | 'author'> | null,
	now: number = Date.now(),
): string {
	if (!last) return 'no change recorded';
	const when = timeAgo(last.date, now);
	const parts = ['Changed'];
	if (when) parts.push(/^\d{4}-\d{2}-\d{2}$/.test(when) ? `on ${when}` : when);
	if (last.author) parts.push(`by ${last.author}`);
	return parts.join(' ');
}

export interface EvalPill {
	tone: PillTone;
	label: string;
}

/** The pill on the "Agent evaluation" card: the score move, or where the evaluation stands. */
export function evalPill(check: AgentEvalCheck): EvalPill {
	const state = check.report;
	if (state.state === 'ready') {
		const { report } = state;
		switch (report.result) {
			case 'scored': {
				const { before, after } = report;
				if (!after) return { tone: 'amber', label: 'scored' };
				if (!before) return { tone: 'green', label: `new · after ${pct(after.score)}` };
				return {
					tone: after.score >= before.score ? 'green' : 'amber',
					label: `before ${pct(before.score)} → after ${pct(after.score)}`,
				};
			}
			case 'no-eval-set':
				return { tone: 'muted', label: 'no eval set' };
			case 'invalid':
				return { tone: 'red', label: 'invalid' };
			case 'capped':
				return { tone: 'red', label: 'capped' };
			default:
				return { tone: 'red', label: 'failed' };
		}
	}
	if (check.status?.state === 'failure' || check.status?.state === 'error') {
		return { tone: 'red', label: 'failed' };
	}
	switch (state.state) {
		case 'running':
			return { tone: 'blue', label: 'running' };
		case 'none':
			return check.status?.state === 'pending'
				? { tone: 'blue', label: 'running' }
				: { tone: 'muted', label: 'not started' };
		default:
			return { tone: 'amber', label: state.state };
	}
}

/** The reference set as one line: "mockups · 2 images · 13 elements", or "repair · 5 cases". */
export function evalSetText(set: EvalReport['set'], cases?: EvalReport['cases']): string {
	if (!set) return 'No reference set';
	const { name, images, elements } = set;
	if (cases) return `${name} · ${elements} ${plural(elements, 'case')}`;
	return `${name} · ${images} ${plural(images, 'image')} · ${elements} ${plural(elements, 'element')}`;
}

/** "$3.20 of $20.00": what the run spent against its hard cap. */
export const evalCostText = (report: Pick<EvalReport, 'costUsd' | 'capUsd'>): string =>
	`${money(report.costUsd)} of ${money(report.capUsd)}`;

/** A side's definition as one line: "claude-sonnet-5-5 · medium". */
export const evalSideText = (side: EvalSide | null): string =>
	side ? `${side.definition.model} · ${effortWord(side.definition.effort)}` : 'no definition';

export interface EvalRow {
	label: string;
	before: string;
	after: string;
}

/** The before/after summary table; a side that did not run reads "—". A repair report counts cases passed. */
export function evalRows(report: Pick<EvalReport, 'before' | 'after' | 'cases'>): EvalRow[] {
	const row = (label: string, read: (side: EvalSide) => string): EvalRow => ({
		label,
		before: report.before ? read(report.before) : '—',
		after: report.after ? read(report.after) : '—',
	});
	const { cases } = report;
	if (cases) {
		const passed = (side: 'before' | 'after'): string =>
			report[side] ? `${cases.filter((c) => c[side]?.passed).length} of ${cases.length}` : '—';
		return [
			{ label: 'Cases passed', before: passed('before'), after: passed('after') },
			row('Calls', (s) => String(s.calls)),
			row('Cost', (s) => money(s.costUsd)),
		];
	}
	return [
		row('Score', (s) => pct(s.score)),
		row('Status agreement', (s) => pct(s.statusAgreement)),
		row('Region agreement', (s) => pct(s.regionAgreement)),
		row('Extra elements', (s) => String(s.extraElements)),
		row('Calls', (s) => String(s.calls)),
		row('Cost', (s) => money(s.costUsd)),
	];
}

export interface EvalCell {
	text: string;
	/** The regions the side named, and how much of the expected set it got. */
	detail: string;
	tone: Tone;
}

/** One side's answer for one expected element. */
export function evalCell(view: EvalElementView | null): EvalCell {
	if (!view) return { text: '—', detail: '', tone: 'muted' };
	if (!view.found) return { text: 'not found', detail: '', tone: 'red' };
	const regions = view.regions.length ? view.regions.join(', ') : 'no regions';
	const exact = view.regionScore >= 1;
	return {
		text: view.status ?? 'no status',
		detail: exact ? regions : `${regions} · regions ${pct(view.regionScore)}`,
		tone: !view.statusMatch ? 'red' : exact ? 'green' : 'amber',
	};
}

/** The first line of a commit message: what a log shows. */
export const firstLine = (message: string): string => message.split(/\r?\n/, 1)[0] ?? '';

/** The pull request title the server gives an agent-definition change. */
export const agentChangeTitle = (name: string, why: string): string => `agents: ${name} — ${why}`;

/** The `errors` list of a 400 answer, as the server's strings. */
export function errorListOf(body: unknown): string[] {
	if (!body || typeof body !== 'object') return [];
	const { errors } = body as { errors?: unknown };
	return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string') : [];
}
