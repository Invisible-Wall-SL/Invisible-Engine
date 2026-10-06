/**
 * The agent evaluation report (ADR-0007 "Agents tab"; PLAN 5.4): what `agent-eval.yml` writes as
 * the `agent-eval-report` artifact (`report.json`) and posts as the `agent-eval` commit status, and
 * what Invisible Pipeline Changes reads back into a change's "Agent evaluation" section.
 *
 * Pure and self-contained on purpose — no imports, only erasable TypeScript — because the launcher
 * imports this file by relative path, the way it imports `runState.ts`: its typecheck refuses the
 * `./x.ts` specifiers the worker's loader needs, so a file it shares must need none.
 *
 * The cap is a HARD stop on real usage: the runner sums `costOfUsage` over every response the API
 * returns and stops before the next call once the sum reaches `capUsd`; a response that carries the
 * sum past the cap is the last one, so the overshoot is at most one call. "Capped" is a failure.
 */

/** The hard per-run cap, in USD (owner decision 2026-10-05). */
export const EVAL_CAP_USD = 20;
export const EVAL_REPORT_VERSION = 1;
/** The artifact `agent-eval.yml` uploads; `report.json` inside it is this document. */
export const EVAL_REPORT_ARTIFACT = 'agent-eval-report';
/** The commit status context the workflow posts. */
export const EVAL_STATUS_CONTEXT = 'agent-eval';
/** The label a PR must carry for the eval to run. */
export const AGENT_DEFINITION_LABEL = 'agent-definition';

export type EvalResult =
	/** Both definitions ran on the reference set and were scored. */
	| 'scored'
	/** The agent has no reference set yet: nothing to compare, and nothing was spent. */
	| 'no-eval-set'
	/** The edited definition fails the loader; the worker would refuse to boot with it. */
	| 'invalid'
	/** The cap stopped the run before it finished. */
	| 'capped'
	/** The run failed for another reason (an API error, a missing secret). */
	| 'error';

export interface EvalUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
}

/** What one element of an actual breakdown looked like against the expected one. */
export interface EvalElementView {
	/** Whether an actual element was found for the expected one (matched by box overlap). */
	found: boolean;
	name: string | null;
	status: string | null;
	regions: string[];
	/** The actual status equals the expected one. */
	statusMatch: boolean;
	/** Jaccard overlap of the region sets, 1 when both are empty. */
	regionScore: number;
}

/** One expected element of the reference set, with each side's answer for it. */
export interface EvalItem {
	image: string;
	n: number;
	name: string;
	expected: { status: string; regions: string[] };
	before: EvalElementView | null;
	after: EvalElementView | null;
	/** The two sides disagree on this element. */
	changed: boolean;
}

export interface EvalSide {
	definition: { model: string; effort: string | null };
	/** 0..1: the mean over the expected elements of ½ status agreement + ½ region agreement. */
	score: number;
	statusAgreement: number;
	regionAgreement: number;
	/** Elements this side found that match no expected element. */
	extraElements: number;
	calls: number;
	usage: EvalUsage;
	costUsd: number;
}

export interface EvalReport {
	version: typeof EVAL_REPORT_VERSION;
	agent: string;
	/** The PR head the edited definition came from. */
	head: { sha: string };
	/** The `main` commit whose code ran the eval and whose definition is "before". */
	base: { sha: string };
	result: EvalResult;
	capUsd: number;
	costUsd: number;
	capped: boolean;
	/** The reference set the agent was scored on; null when it has none. */
	set: { name: string; images: number; elements: number } | null;
	/** Null when `main` has no such definition (a new agent), or when nothing ran. */
	before: EvalSide | null;
	after: EvalSide | null;
	items: EvalItem[];
	/** `invalid`: the loader's errors; `error`: what failed; `capped`: where it stopped. */
	errors: string[];
	/** The one-line summary, as the status description (at most 140 characters). */
	line: string;
}

const DESCRIPTION_MAX = 140;
const money = (usd: number): string => `$${usd.toFixed(2)}`;
const pct = (score: number): string => `${Math.round(score * 100)}%`;

/** The status description for a report, within GitHub's 140 characters. */
export function evalLine(
	report: Omit<EvalReport, 'line' | 'version' | 'head' | 'base' | 'capUsd'> & { capUsd: number },
): string {
	let line: string;
	switch (report.result) {
		case 'scored': {
			const n = report.set?.elements ?? report.items.length;
			const before = report.before ? pct(report.before.score) : 'no definition on main';
			const after = report.after ? pct(report.after.score) : '—';
			line = `${report.agent}: ${before} → ${after} on ${n} element${n === 1 ? '' : 's'} · ${money(report.costUsd)} of ${money(report.capUsd)}`;
			break;
		}
		case 'no-eval-set':
			line = `${report.agent}: no eval set yet, nothing to compare`;
			break;
		case 'invalid':
			line = `${report.agent}: the edited definition fails the loader — ${report.errors[0] ?? 'invalid'}`;
			break;
		case 'capped':
			line = `${report.agent}: capped at ${money(report.capUsd)} (spent ${money(report.costUsd)}) — ${report.errors[0] ?? 'stopped'}`;
			break;
		default:
			line = `${report.agent}: the eval failed — ${report.errors[0] ?? 'error'}`;
	}
	return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1)}…` : line;
}

/** Whether a result lets the change merge (ADR-0007: a failed or capped eval blocks it). */
export const evalPasses = (result: EvalResult): boolean =>
	result === 'scored' || result === 'no-eval-set';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every((s) => typeof s === 'string');
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseView(v: unknown): EvalElementView | null {
	if (v === null) return null;
	if (
		!isRecord(v) ||
		typeof v.found !== 'boolean' ||
		(v.name !== null && typeof v.name !== 'string') ||
		(v.status !== null && typeof v.status !== 'string') ||
		!isStringArray(v.regions) ||
		typeof v.statusMatch !== 'boolean' ||
		!isFiniteNumber(v.regionScore)
	) {
		throw new Error('an element view is malformed');
	}
	return {
		found: v.found,
		name: v.name as string | null,
		status: v.status as string | null,
		regions: v.regions,
		statusMatch: v.statusMatch,
		regionScore: v.regionScore,
	};
}

function parseUsage(v: unknown): EvalUsage {
	if (
		!isRecord(v) ||
		!isFiniteNumber(v.inputTokens) ||
		!isFiniteNumber(v.outputTokens) ||
		!isFiniteNumber(v.cacheReadInputTokens) ||
		!isFiniteNumber(v.cacheCreationInputTokens)
	) {
		throw new Error('usage is malformed');
	}
	return {
		inputTokens: v.inputTokens,
		outputTokens: v.outputTokens,
		cacheReadInputTokens: v.cacheReadInputTokens,
		cacheCreationInputTokens: v.cacheCreationInputTokens,
	};
}

function parseSide(v: unknown): EvalSide | null {
	if (v === null) return null;
	if (
		!isRecord(v) ||
		!isRecord(v.definition) ||
		typeof v.definition.model !== 'string' ||
		(v.definition.effort !== null && typeof v.definition.effort !== 'string') ||
		!isFiniteNumber(v.score) ||
		!isFiniteNumber(v.statusAgreement) ||
		!isFiniteNumber(v.regionAgreement) ||
		!isFiniteNumber(v.extraElements) ||
		!isFiniteNumber(v.calls) ||
		!isFiniteNumber(v.costUsd)
	) {
		throw new Error('a side is malformed');
	}
	return {
		definition: { model: v.definition.model, effort: v.definition.effort as string | null },
		score: v.score,
		statusAgreement: v.statusAgreement,
		regionAgreement: v.regionAgreement,
		extraElements: v.extraElements,
		calls: v.calls,
		usage: parseUsage(v.usage),
		costUsd: v.costUsd,
	};
}

const RESULTS: readonly EvalResult[] = ['scored', 'no-eval-set', 'invalid', 'capped', 'error'];

/**
 * A report as the artifact holds it, checked field by field: the artifact's bytes are a branch's
 * and a workflow's, so nothing in them is trusted by shape alone. Throws naming what is wrong.
 */
export function parseEvalReport(value: unknown): EvalReport {
	if (!isRecord(value)) throw new Error('the report is not an object');
	if (value.version !== EVAL_REPORT_VERSION) throw new Error('the report is not version 1');
	if (typeof value.agent !== 'string' || !/^[a-z][a-z-]*$/.test(value.agent)) {
		throw new Error('the report names no agent');
	}
	if (!isRecord(value.head) || typeof value.head.sha !== 'string') {
		throw new Error('the report names no head commit');
	}
	if (!isRecord(value.base) || typeof value.base.sha !== 'string') {
		throw new Error('the report names no base commit');
	}
	if (typeof value.result !== 'string' || !RESULTS.includes(value.result as EvalResult)) {
		throw new Error('the report has no result');
	}
	if (!isFiniteNumber(value.capUsd) || !isFiniteNumber(value.costUsd)) {
		throw new Error('the report has no cost');
	}
	if (typeof value.capped !== 'boolean')
		throw new Error('the report does not say if it was capped');
	let set: EvalReport['set'] = null;
	if (value.set !== null) {
		if (
			!isRecord(value.set) ||
			typeof value.set.name !== 'string' ||
			!isFiniteNumber(value.set.images) ||
			!isFiniteNumber(value.set.elements)
		) {
			throw new Error('the reference set is malformed');
		}
		set = { name: value.set.name, images: value.set.images, elements: value.set.elements };
	}
	if (!Array.isArray(value.items)) throw new Error('the report has no items');
	const items: EvalItem[] = value.items.map((item) => {
		if (
			!isRecord(item) ||
			typeof item.image !== 'string' ||
			!isFiniteNumber(item.n) ||
			typeof item.name !== 'string' ||
			!isRecord(item.expected) ||
			typeof item.expected.status !== 'string' ||
			!isStringArray(item.expected.regions) ||
			typeof item.changed !== 'boolean'
		) {
			throw new Error('an item is malformed');
		}
		return {
			image: item.image,
			n: item.n,
			name: item.name,
			expected: { status: item.expected.status, regions: item.expected.regions },
			before: parseView(item.before),
			after: parseView(item.after),
			changed: item.changed,
		};
	});
	if (!isStringArray(value.errors)) throw new Error('the report has no errors list');
	if (typeof value.line !== 'string') throw new Error('the report has no summary line');
	return {
		version: EVAL_REPORT_VERSION,
		agent: value.agent,
		head: { sha: value.head.sha },
		base: { sha: value.base.sha },
		result: value.result as EvalResult,
		capUsd: value.capUsd,
		costUsd: value.costUsd,
		capped: value.capped,
		set,
		before: parseSide(value.before),
		after: parseSide(value.after),
		items,
		errors: value.errors,
		line: value.line,
	};
}
