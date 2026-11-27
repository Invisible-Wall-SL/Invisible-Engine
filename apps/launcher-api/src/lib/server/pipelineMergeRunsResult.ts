import {
	MERGE_CAPS,
	MERGE_CHOICES,
	MERGE_HUNK_KINDS,
	MERGE_MODES,
	MERGE_RUN_ID,
	MERGE_RULES,
	MERGE_TAKES,
	SHA_40,
	isMergeRunOutcome,
	type MergeChoice,
	type MergeRule,
	type MergeRunExplanation,
	type MergeRunFile,
	type MergeRunHunk,
	type MergeRunOutcome,
} from '$lib/mergeMainRuns';

import {
	HIDDEN,
	TEXT_SLACK,
	cleanLine,
	cleanText,
	isLockfile,
	isRecord,
	pathProblem,
	protectedEntry,
	secretIn,
	unmarked,
	withoutDirectives,
} from './bugFixRunsChange';
import { blobSha, type Files } from './pipelineMergeRunsBuild';

/**
 * Reading what a merge run's job posts (ADR-0015 §10) and judging the part of it that needs no
 * GitHub. The result is untrusted — a model wrote some of it, steered by text people wrote — so it is
 * parsed strictly (a field the contract does not name is refused), every text is cleaned and
 * scanned, and every file it asks to write is held to the rules of §5 that need only the file list.
 * The rules that need the trees (which paths both sides changed, a secret in a line neither side had)
 * are Accept's (`pipelineMergeRunsBuild.ts`). A refusal names the rule, never a path or a value the
 * result chose.
 */

/** A body the launcher cannot read: a 400, the launcher's words, never a value the result chose. */
export class ResultProblem extends Error {
	constructor(what: string) {
		super(`The result's ${what}.`);
		this.name = 'ResultProblem';
	}
}

function bad(what: string): never {
	throw new ResultProblem(what);
}

export interface ParsedMergeResult {
	mergeRun: string;
	headSha: string | null;
	mainSha: string | null;
	baseSha: string | null;
	outcome: MergeRunOutcome | null;
	failure: string | null;
	reason: string;
	files: MergeRunFile[];
	explanation: MergeRunExplanation | null;
	/** `usage`, unread: `parseUsage` judges it. */
	usage: unknown;
}

const TOP_KEYS = [
	'mergeRun',
	'headSha',
	'mainSha',
	'baseSha',
	'outcome',
	'failure',
	'reason',
	'files',
	'explanation',
	'usage',
];
/** Every key but `outcome` and `failure`, which a form leaves out. */
const REQUIRED_KEYS = [
	'mergeRun',
	'headSha',
	'mainSha',
	'baseSha',
	'reason',
	'files',
	'explanation',
	'usage',
];
const FILE_KEYS = ['path', 'choice', 'rule', 'content', 'mode'];
const EXPLANATION_KEYS = ['conflicted', 'hunks', 'outside', 'checks', 'risks'];
const HUNK_KEYS = [
	'path',
	'index',
	'main',
	'change',
	'result',
	'kind',
	'takes',
	'why',
	'nowDoes',
	'otherwise',
];
const MAX_LIST = 100;
const TITLE_CAP = 300;
const COMMAND_CAP = 300;

function only(v: Record<string, unknown>, keys: string[], where: string): void {
	if (Object.keys(v).some((k) => !keys.includes(k)))
		bad(`${where} has a field the launcher does not know`);
}

/** A string within {@link TEXT_SLACK} times its cap, else a refusal: the cleaning is not handed megabytes. */
function text(v: unknown, field: string, cap: number = MERGE_CAPS.text): string {
	if (typeof v !== 'string') return bad(`${field} is not text`);
	if (v.length > cap * TEXT_SLACK) bad(`${field} is far longer than the launcher keeps`);
	return v;
}

function optionalText(v: unknown, field: string): string | null {
	return v === null || v === undefined ? null : text(v, field);
}

function list(v: unknown, field: string, max = MAX_LIST): unknown[] {
	if (!Array.isArray(v)) return bad(`${field} is not a list`);
	if (v.length > max) bad(`${field} has more than ${max} entries`);
	return v;
}

function record(v: unknown, field: string): Record<string, unknown> {
	return isRecord(v) ? v : bad(`${field} has an entry that is not an object`);
}

const isChoice = (v: unknown): v is MergeChoice =>
	typeof v === 'string' && (MERGE_CHOICES as readonly string[]).includes(v);
const isRule = (v: unknown): v is MergeRule =>
	typeof v === 'string' && (MERGE_RULES as readonly string[]).includes(v);

function parseFiles(v: unknown): MergeRunFile[] {
	return list(v, 'files', MERGE_CAPS.files).map((raw): MergeRunFile => {
		const f = record(raw, 'files');
		only(f, FILE_KEYS, 'files');
		if (typeof f.path !== 'string') return bad('files has an entry with no path');
		if (!isChoice(f.choice)) return bad('files has a choice the launcher does not know');
		if (f.rule !== null && !isRule(f.rule))
			return bad('files has a rule the launcher does not know');
		if (f.content !== null && typeof f.content !== 'string') {
			return bad('files has an entry whose content is neither text nor null');
		}
		if (typeof f.mode !== 'string' || !(MERGE_MODES as readonly string[]).includes(f.mode)) {
			return bad('files has a mode other than 100644 or 100755');
		}
		return {
			path: f.path,
			choice: f.choice,
			rule: f.rule,
			content: f.content,
			mode: f.mode as MergeRunFile['mode'],
		};
	});
}

function parseExplanation(v: unknown): MergeRunExplanation {
	const e = record(v, 'explanation');
	only(e, EXPLANATION_KEYS, 'explanation');
	const conflicted = list(e.conflicted, 'conflicted').map((raw) => {
		const c = record(raw, 'conflicted');
		only(c, ['path', 'met'], 'conflicted');
		return {
			path: text(c.path, 'a path', MERGE_CAPS.path),
			met: list(c.met, 'met').map((m) => {
				const entry = record(m, 'met');
				only(entry, ['pr', 'title'], 'met');
				const pr = entry.pr;
				if (pr !== null && !(typeof pr === 'number' && Number.isSafeInteger(pr) && pr > 0)) {
					return bad('met has a pull request that is not a number');
				}
				return { pr, title: text(entry.title, 'a title', TITLE_CAP) };
			}),
		};
	});
	const hunks = list(e.hunks, 'hunks', MERGE_CAPS.hunks).map((raw): MergeRunHunk => {
		const h = record(raw, 'hunks');
		only(h, HUNK_KEYS, 'hunks');
		const index = h.index;
		if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 100_000) {
			return bad('hunks has an index that is not a whole number');
		}
		if (typeof h.kind !== 'string' || !(MERGE_HUNK_KINDS as readonly string[]).includes(h.kind)) {
			return bad('hunks has a kind the launcher does not know');
		}
		if (typeof h.takes !== 'string' || !(MERGE_TAKES as readonly string[]).includes(h.takes)) {
			return bad('hunks has a choice the launcher does not know');
		}
		return {
			path: text(h.path, 'a path', MERGE_CAPS.path),
			index,
			main: text(h.main, 'a hunk', MERGE_CAPS.lines),
			change: text(h.change, 'a hunk', MERGE_CAPS.lines),
			result: !('result' in h)
				? bad('a hunk has no result field')
				: h.result === null
					? null
					: text(h.result, 'a hunk', MERGE_CAPS.lines),
			kind: h.kind as MergeRunHunk['kind'],
			takes: h.takes as MergeRunHunk['takes'],
			why: text(h.why, 'a hunk'),
			nowDoes: optionalText(h.nowDoes, 'a hunk'),
			otherwise: optionalText(h.otherwise, 'a hunk'),
		};
	});
	const outside = list(e.outside, 'outside').map((raw) => {
		const o = record(raw, 'outside');
		only(o, ['path', 'what'], 'outside');
		return { path: text(o.path, 'a path', MERGE_CAPS.path), what: text(o.what, 'outside') };
	});
	const checks = list(e.checks, 'checks').map((raw) => {
		const c = record(raw, 'checks');
		only(c, ['command', 'ok'], 'checks');
		if (typeof c.ok !== 'boolean') return bad('checks has an entry whose ok is not true or false');
		return { command: text(c.command, 'a check', COMMAND_CAP), ok: c.ok };
	});
	return { conflicted, hunks, outside, checks, risks: text(e.risks, 'risks') };
}

/**
 * The result as the job posted it, or a {@link ResultProblem}: the contract's shape and nothing else.
 * The job sends exactly three forms, each with every key but the one its form leaves out
 * (`outcome` in a failure, `failure` in the others, either may be `null`):
 *  - a proposal: `outcome` `proposed`, `reason` null, `files`, an `explanation` and a `baseSha`;
 *  - a refusal: any other `outcome`, a `reason` sentence, `files` `[]`, `explanation` null;
 *  - a failure (the job itself broke): a `failure` sentence, `reason` null, `files` `[]`,
 *    `explanation` null.
 * `headSha` and `mainSha` are always the run's; `baseSha` is null only with no single merge base or
 * when the job broke first. Anything else is refused, however harmless it looks.
 */
export function parseMergeResult(body: Record<string, unknown>): ParsedMergeResult {
	only(body, TOP_KEYS, 'body');
	for (const key of REQUIRED_KEYS) if (!(key in body)) bad(`${key} is missing`);
	if (typeof body.mergeRun !== 'string' || !MERGE_RUN_ID.test(body.mergeRun)) {
		bad('mergeRun is not a merge run id');
	}
	const given = <T>(v: unknown): v is T => v !== undefined && v !== null;
	const failure = given(body.failure)
		? text(body.failure, 'failure', MERGE_CAPS.text).trim() || bad('failure is empty')
		: null;
	let outcome: MergeRunOutcome | null = null;
	if (given(body.outcome)) {
		if (!isMergeRunOutcome(body.outcome)) bad('outcome is not one the launcher knows');
		outcome = body.outcome as MergeRunOutcome;
	}
	if (outcome && failure) bad('has both an outcome and a failure');
	if (!outcome && !failure) bad('outcome is missing');
	const sha = (key: 'headSha' | 'mainSha' | 'baseSha', nullable: boolean): string | null => {
		const v = body[key];
		if (v === null && nullable) return null;
		return typeof v === 'string' && SHA_40.test(v) ? v : bad(`${key} is not a 40-character SHA`);
	};
	const headSha = sha('headSha', false);
	const mainSha = sha('mainSha', false);
	const baseSha = sha('baseSha', outcome !== 'proposed');
	let reason = '';
	let files: MergeRunFile[] = [];
	let explanation: MergeRunExplanation | null = null;
	if (outcome === 'proposed') {
		if (body.reason !== null) bad('reason is not null in a proposal');
		files = parseFiles(body.files);
		explanation = parseExplanation(body.explanation);
	} else {
		if (!Array.isArray(body.files) || body.files.length)
			bad('files is not empty without a proposal');
		if (body.explanation !== null) bad('explanation is not null without a proposal');
		if (failure) {
			if (body.reason !== null) bad('reason is not null in a failure');
		} else {
			reason = text(body.reason, 'reason');
		}
	}
	return {
		mergeRun: body.mergeRun as string,
		headSha,
		mainSha,
		baseSha,
		outcome,
		failure,
		reason,
		files,
		explanation,
		usage: body.usage,
	};
}

// ── Cleaning ──────────────────────────────────────────────────────────────────

const FORMAT = /\p{Cf}/gu;

/**
 * A code excerpt as the card shows it: no format characters (bidi, zero-width), no CI-skip
 * directive, capped. Its tags and brackets stay, since the card renders it as text, never HTML,
 * and its indentation stays: only the last line break is dropped.
 */
function cleanExcerpt(excerpt: string, max: number): string {
	const kept = withoutDirectives(excerpt.replace(/\r\n?/g, '\n').replace(FORMAT, '')).replace(
		/\n$/,
		'',
	);
	const points = Array.from(kept);
	return points.length > max ? `${points.slice(0, max - 1).join('')}…` : kept;
}

const HIDDEN_LINE = '[line hidden: it looks like a secret]';

/** A side's own line that looks like a secret is hidden from the page, not a reason to refuse: the repository holds such lines (docs, env names). */
const hideSecretLines = (text: string): string =>
	text
		.split('\n')
		.map((line) => (secretIn(line) ? HIDDEN_LINE : line))
		.join('\n');

const optionalExcerpt = (v: string | null, max: number): string | null =>
	v === null ? null : cleanExcerpt(v, max);

const optionalClean = (v: string | null, max: number): string | null =>
	v === null ? null : cleanText(v, max) || null;

/** Every text of the explanation cleaned as a fix run's are: plain, capped, unlinked and quiet. */
export function cleanExplanation(e: MergeRunExplanation): MergeRunExplanation {
	return {
		conflicted: e.conflicted.map((c) => ({
			path: c.path,
			met: c.met.map((m) => ({ pr: m.pr, title: cleanLine(m.title, TITLE_CAP) })),
		})),
		hunks: e.hunks.map((h) => ({
			path: h.path,
			index: h.index,
			main: hideSecretLines(cleanExcerpt(h.main, MERGE_CAPS.lines)),
			change: hideSecretLines(cleanExcerpt(h.change, MERGE_CAPS.lines)),
			result: optionalExcerpt(h.result, MERGE_CAPS.lines),
			kind: h.kind,
			takes: h.takes,
			why: cleanText(h.why, MERGE_CAPS.text),
			nowDoes: optionalClean(h.nowDoes, MERGE_CAPS.text),
			otherwise: optionalClean(h.otherwise, MERGE_CAPS.text),
		})),
		outside: e.outside.map((o) => ({ path: o.path, what: cleanText(o.what, MERGE_CAPS.text) })),
		checks: e.checks.map((c) => ({
			command: cleanLine(c.command, COMMAND_CAP).replace(/`/g, "'"),
			ok: c.ok,
		})),
		risks: cleanText(e.risks, MERGE_CAPS.text),
	};
}

/**
 * Every prose text of an explanation, for the scan and the 16,000-character cap. The real lines of
 * a hunk (`main`, `change`, `result`) are not prose: they are code the repository already holds,
 * capped on their own ({@link explanationLines}), and a `result` must be inside its file, which
 * Accept's content scan reads.
 */
export function explanationTexts(e: MergeRunExplanation): string[] {
	return [
		...e.conflicted.flatMap((c) => [c.path, ...c.met.map((m) => m.title)]),
		...e.hunks.flatMap((h) => [h.path, h.why, h.nowDoes ?? '', h.otherwise ?? '']),
		...e.outside.flatMap((o) => [o.path, o.what]),
		...e.checks.map((c) => c.command),
		e.risks,
	];
}

/** The code points of every hunk's real lines, for their own cap. */
export const explanationLines = (e: MergeRunExplanation): number =>
	e.hunks.reduce(
		(n, h) =>
			n +
			Array.from(h.main).length +
			Array.from(h.change).length +
			(h.result === null ? 0 : Array.from(h.result).length),
		0,
	);

/**
 * The first secret in a hunk's `result` lines that neither of its sides had, scanned as sent and as
 * cleaned (cleaning strips zero-width characters that could rejoin a key a scan of the raw text
 * missed). A line a side already held is the repository's own and is not the result's to answer for.
 */
export function resultSecretProblem(
	raw: MergeRunExplanation,
	cleaned: MergeRunExplanation,
): string | null {
	for (const [i, h] of raw.hunks.entries()) {
		const c = cleaned.hunks[i];
		const theirs = new Set(
			[h.main, h.change, c.main, c.change].flatMap((t) => t.replace(/\r\n?/g, '\n').split('\n')),
		);
		for (const text of [h.result, c.result]) {
			if (text === null) continue;
			for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
				if (!theirs.has(line) && secretIn(line)) return 'secret scan: a secret in a hunk result';
			}
		}
	}
	return null;
}

const flat = (text: string): string =>
	withoutDirectives(text.replace(/\r\n?/g, '\n').replace(FORMAT, ''));

/**
 * The first hunk whose `result` is not in its file's content, or null. The result is cut at the
 * cap with a trailing `…`, so that cut is allowed for; a file the files do not list, a deletion, or
 * text the file does not hold is not.
 */
export function resultProblem(e: MergeRunExplanation, files: MergeRunFile[]): string | null {
	for (const h of e.hunks) {
		if (h.result === null) continue;
		const file = files.find((f) => f.path === h.path);
		if (!file || file.content === null) return 'a hunk shows a result that is not in its file';
		const whole = flat(file.content);
		if (
			!whole.includes(h.result) &&
			!(h.result.endsWith('…') && whole.includes(h.result.slice(0, -1)))
		) {
			return 'a hunk shows a result that is not in its file';
		}
	}
	return null;
}

/** The characters an explanation holds in all, in code points. */
export const explanationSize = (e: MergeRunExplanation): number =>
	explanationTexts(e).reduce((n, t) => n + Array.from(t).length, 0);

/** A proposal must say something under every heading that always has content (§10). */
export function isExplainedMerge(e: MergeRunExplanation | null): e is MergeRunExplanation {
	return (
		e !== null &&
		e.risks.length > 0 &&
		e.conflicted.length > 0 &&
		e.hunks.every((h) => h.why.length > 0)
	);
}

// ── What a file may be, without GitHub ────────────────────────────────────────

/** The files of §3's build rules, by where each lives. */
const RULE_PATHS: Record<Exclude<MergeRule, 'docs-append'>, RegExp> = {
	'runtime-bytes': /^scripts\/runtime-bytes\/[^/]+\.json$/,
	'vendored-bundle': /^apps\/launcher-api\/static\/(?:rigger|rig-viewer)\/vendor\/[^/]+\.js$/,
	ratchet: /^(?:svelte-check-baseline|eslint-suppressions)\.json$/,
};
const DOCS_PATH = /^docs\/.+\.md$/;

/**
 * Whether `file` is a build rule's file left pending (§3, §10): the rule's own path, `main`'s
 * entry. The job never builds branch code, so a person or CI follows up after Accept.
 */
export const isPendingRuleFile = (file: Pick<MergeRunFile, 'path' | 'choice' | 'rule'>): boolean =>
	file.choice === 'main' &&
	file.rule !== null &&
	file.rule !== 'docs-append' &&
	RULE_PATHS[file.rule].test(file.path);

/** Whether `f` is exactly what `main` holds at its path (nothing, for a deletion). */
function isMainsEntry(f: MergeRunFile, main: Files | null): boolean {
	if (main === null) return false;
	const entry = main.get(f.path);
	if (f.content === null) {
		// Absent from `main` as written, and not merely under another case: `.GitHub/…` is not a
		// deletion of `.github/…`.
		const lower = f.path.toLowerCase();
		return entry === undefined && ![...main.keys()].some((k) => k.toLowerCase() === lower);
	}
	return entry !== undefined && entry.sha === blobSha(f.content) && entry.mode === f.mode;
}

/**
 * Whether `f` rests on the exemption of {@link filesProblem}: a protected path or a lockfile listed
 * as `main`'s own. The caller reads `main`'s tree only when one does.
 */
export const needsMainsTree = (f: MergeRunFile): boolean =>
	f.choice === 'main' && f.rule === null && (protectedEntry(f.path) !== null || isLockfile(f.path));

/**
 * The first rule the files break that needs no GitHub: their count in the model's hands, their size,
 * their paths and modes, that a file's rule and choice agree and its path is where the rule's files
 * live, a protected path (but the docs-append rule's, which may add to one), a lockfile, hidden
 * Unicode, and a secret in a path. `main` is `main`'s tree at the run's SHA, for the one exemption
 * (above): without it, a protected path or a lockfile is always refused.
 */
export function filesProblem(
	files: MergeRunFile[],
	hunkPaths: ReadonlySet<string>,
	main: Files | null = null,
): string | null {
	const seen = new Set<string>();
	let total = 0;
	let model = 0;
	for (const f of files) {
		const problem = pathProblem(f.path);
		if (problem) return problem;
		const key = f.path.toLowerCase();
		if (seen.has(key)) return 'it lists one path twice';
		seen.add(key);
		if (f.rule === 'docs-append') {
			if (f.choice !== 'both' || !DOCS_PATH.test(f.path)) {
				return 'a docs-append file is not a markdown file under docs/ taken as both';
			}
		} else if (f.rule !== null) {
			if (!isPendingRuleFile(f)) return "a build rule's file is not main's, left pending";
		}
		// `main`'s own entry written onto `main`'s tree changes nothing: it is how a path both sides
		// changed identically, or both deleted, is listed. So a protected path or a lockfile may be
		// listed as `main`'s only when it IS `main`'s entry at the run's SHA, byte for byte and mode
		// for mode (or absent from it, for a deletion): "main's" is a claim until `main` says so.
		const keepsMain = f.choice === 'main' && f.rule === null && isMainsEntry(f, main);
		const guarded = protectedEntry(f.path);
		if (guarded && f.rule !== 'docs-append' && !keepsMain) {
			return `it touches a protected path (${guarded})`;
		}
		if (isLockfile(f.path) && !keepsMain) {
			return 'it changes a lockfile: dependencies are for a person to decide';
		}
		if (f.rule === null && hunkPaths.has(f.path)) model++;
		if (secretIn(f.path)) return 'secret scan: a secret in a path';
		if (f.content === null) continue;
		if (!f.content.isWellFormed()) return 'a file is not UTF-8 text';
		if (f.content.includes('\u0000')) return 'a file holds a NUL byte';
		if (HIDDEN.test(f.content)) return 'a file holds Unicode tag or bidi control characters';
		const bytes = Buffer.byteLength(f.content, 'utf8');
		if (bytes > MERGE_CAPS.file) return 'a file is larger than 2 MB';
		total += bytes;
	}
	if (total > MERGE_CAPS.total) return 'the files are larger than 4 MB in all';
	if (model > MERGE_CAPS.modelFiles)
		return `it resolves more than ${MERGE_CAPS.modelFiles} files by hand`;
	return null;
}

/** A secret in what the result said, as written, cleaned, or with its tags taken out. */
export function textsProblem(raw: string[], clean: string[]): string | null {
	for (const t of [...raw, ...clean, ...raw.map(unmarked)]) {
		const found = secretIn(t);
		if (found) return `secret scan: ${found} in the explanation`;
	}
	return null;
}
