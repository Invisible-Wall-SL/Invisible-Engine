// Job `propose` of a Resolve conflict run (ADR-0015 §2, §4, §10; card 15B1): its own code, run from
// the pristine copy of main ($RUNNER_TEMP/main), never from the workspace the model writes in.
// Built-ins only: nothing under node_modules runs here.
//
//   node collect.mjs stage    before the model: check job merge's record against main's git, lay
//                             the merged tree into the workspace, list the conflicts for the model
//   node collect.mjs prepare  render the CLI's settings, agents and prompt into
//                             $RUNNER_TEMP/claude/conf, as bug-fix.yml's own prepare does
//   node collect.mjs result   after it: collect the resolution, hold it to §4, build §10's result
//                             and POST it with an OIDC token
//
// Environment: MERGE_RUN (10 hex), HEAD_SHA, MAIN_SHA (40 hex), RUNNER_TEMP, GITHUB_WORKSPACE;
// BUDGET_USD (the dispatch input `budget_usd`: the run's cap, 0 when the month is spent); stage
// also GITHUB_OUTPUT (`model=true|false`), result LAUNCHER_URL and the OIDC request
// pair. Under $RUNNER_TEMP: `main/` (main at MAIN_SHA, its git also holding HEAD_SHA and the
// history back to the merge base), `merge/` (job merge's artifact), `conflicts/conflicts.json`
// (stage's list for the model), `out/result.json` (the model's), `claude/stream.jsonl` (the
// CLI's), `key/anthropic`. The workspace starts as a clean checkout of main at MAIN_SHA.
//
// NOTHING IN THE RECORD IS TAKEN ON TRUST. Both steps redo the merge from main's git with
// merge.mjs's `analyse` and refuse a record that differs, all of it: no job runs branch code (the
// owner's decision of 2026-11-27), so a build rule's file is main's and `pending`, the command
// that follows Accept named in the proposal.
//
// THE MODEL'S RESULT, `$RUNNER_TEMP/out/result.json`:
//   { "outcome": "proposed" | "needs_person", "reason": "<when needs_person>",
//     "hunks": [{ "path", "index", "takes": "main"|"change"|"both"|"combined",
//                 "why", "nowDoes": "<required when combined>" | null, "otherwise": "…" | null }],
//     "outside": [{ "path", "what" }], "checks": [{ "command", "ok" }], "risks": "…" }
// Every hunk of every file left for the model needs its entry (index as conflicts.json counts
// them), and every file changed outside its hunks its `outside` line; anything missing or empty
// ends the run `no_proposal`. collect fills each hunk's `main` and `change` from git (the model's
// own words for them are ignored) and the rules' part.
//
// THE LOG IS PUBLIC and reads `::` commands: each step prints one line inside a stop-commands
// span, paths in printable ASCII only, and nothing of the model's words.

import { createHash } from 'node:crypto';
import {
	appendFileSync,
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
	JobError,
	agentsJson,
	fail,
	failureOf,
	oidcToken,
	printFenced,
	readPlain,
	readStream,
	render,
	request,
	sandboxTsx,
	shown,
	textOf,
	trustedUrl,
} from '../bug-fix/collect.mjs';
import {
	MAX_FILE_BYTES,
	MAX_TOTAL_BYTES,
	analyse,
	blobs,
	git,
	markerLines,
	names,
	sameEntry,
	sharedLines,
	textOrNull,
} from './merge.mjs';

export const AUDIENCE = 'invisible-launcher-merge-main';
const MERGE_RUN = /^[0-9a-f]{10}$/;
const SHA = /^[0-9a-f]{40}$/;
/** §8's statuses: what the launcher may answer the result with. */
const STATUSES = [
	'dispatched',
	'running',
	'proposed',
	'accepted',
	'discarded',
	'stale',
	'needs_person',
	'no_proposal',
	'failed',
	'cancelled',
];
export const TAKES = ['main', 'change', 'both', 'combined'];
export const TEXT_CAP = 3_000;
export const EXPLANATION_CAP = 16_000;
const COMMAND_CAP = 300;
const MAX_CHECKS = 50;
const MAX_RESULT_JSON = 256 * 1024;
const MAX_RECORD_JSON = 16 * 1024 * 1024;
/** What a body may unpack to: 4 MB of files, JSON-escaped, and the explanation. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
const GZIP_OVER = 400 * 1024;
export const NO_EXPLANATION = 'The run did not explain its resolution.';
/** Unicode tag characters and bidi controls: text that reads one way and runs another. */
const HIDDEN = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069]/gu;
/** A control character but tab and newline. */
const control = (c) => {
	const n = c.codePointAt(0);
	return (n < 32 && c !== '\n' && c !== '\t') || n === 127;
};

/** A refusal of what the run made, in the job's words: the run ends `no_proposal`. */
class NoProposal extends Error {}
const noProposal = (sentence) => {
	throw new NoProposal(sentence);
};
/** A JobError raised reading what the run made is the run's: `no_proposal`. */
function theRuns(fn) {
	try {
		return fn();
	} catch (err) {
		if (err instanceof JobError) noProposal(err.message);
		throw err;
	}
}

function env(name) {
	const v = process.env[name];
	if (!v) fail(`${name} is not set.`);
	return v;
}

/**
 * The run's dollar cap, the dispatch input `budget_usd` (§10): a decimal of at most two places,
 * 0 when the month's budget is spent, and never past $100 whatever the launcher's cap.
 */
export function budgetOf(raw) {
	if (typeof raw !== 'string' || !/^\d{1,3}(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 100) {
		fail('BUDGET_USD is not a dollar amount from 0 to 100.');
	}
	return Number(raw);
}

/** The run's pinned inputs, checked. */
export function inputs() {
	const input = {
		mergeRun: env('MERGE_RUN'),
		head: env('HEAD_SHA'),
		main: env('MAIN_SHA'),
		budget: budgetOf(process.env.BUDGET_USD),
	};
	if (!MERGE_RUN.test(input.mergeRun)) fail('MERGE_RUN is not a merge run id.');
	if (!SHA.test(input.head) || !SHA.test(input.main)) fail('HEAD_SHA or MAIN_SHA is not 40 hex.');
	return input;
}

/** Where everything lives; POSIX paths, as the job runs on Linux. */
export function paths(runnerTemp, workspace) {
	const at = (name) => posix.join(runnerTemp, name);
	return {
		workspace,
		main: at('main'),
		record: at('merge'),
		conflicts: at('conflicts'),
		out: at('out'),
		claude: at('claude'),
		key: at('key'),
	};
}

// ── The record, checked against main's git ────────────────────────────────────

/** A file of the record's directory, through the same one-descriptor read as the change. */
function recordFile(dir, rel, limit) {
	if (!/^(?:record\.json|files\/\d{1,6})$/.test(rel))
		fail('The merge record names a file it may not.');
	return readPlain(realpathSync(dir), join(dir, rel), limit).bytes;
}

/** The record job merge wrote, each path's content read in; its shape checked. */
export function readRecord(dir, input) {
	let record = null;
	try {
		record = JSON.parse(recordFile(dir, 'record.json', MAX_RECORD_JSON).toString('utf8'));
	} catch (err) {
		if (err instanceof JobError) throw err;
	}
	const lists = ['paths', 'checks', 'model'];
	if (
		!record ||
		record.version !== 1 ||
		record.headSha !== input.head ||
		record.mainSha !== input.main ||
		lists.some((k) => !Array.isArray(record[k])) ||
		record.paths.some((x) => !x || typeof x !== 'object')
	) {
		fail("The merge record is not this run's.");
	}
	for (const x of record.paths) {
		const bytes = typeof x.file === 'string' ? recordFile(dir, x.file, MAX_FILE_BYTES) : null;
		x.content = bytes && textOrNull(bytes);
		if (bytes && x.content === null) fail('The merge record holds a file that is not text.');
	}
	return record;
}

const fieldsOf = (x) =>
	JSON.stringify([x.path, x.status, x.conflicted, x.kind, x.rule, x.pending, x.mode, x.sides]);
const json = (v) => JSON.stringify(v);

/**
 * The merge as main's git makes it: the record must agree with it everywhere. A build rule's file
 * is main's with its command `pending`; nothing is built.
 */
export function trustedPlan(p, input) {
	const record = readRecord(p.record, input);
	const plan = analyse({ gitDir: join(p.main, '.git'), head: input.head, main: input.main });
	const differs = (what) =>
		fail(`The merge record does not match the merge main's git makes (${what}).`);
	if (record.baseSha !== plan.baseSha) differs('the merge base');
	if (json(record.model) !== json(plan.model)) differs('the files for the model');
	if (json(record.paths.map((x) => x?.path)) !== json(plan.paths.map((x) => x.path))) {
		differs('the paths both sides changed');
	}
	if (json(record.checks) !== json(plan.checks)) differs('the checks');
	if (record.outcome !== plan.outcome || record.reason !== plan.reason) differs('the outcome');
	plan.paths.forEach((ours, i) => {
		const theirs = record.paths[i];
		const choice = ours.status === 'conflict' ? null : ours.choice;
		if (
			fieldsOf(ours) !== fieldsOf(theirs) ||
			ours.content !== theirs.content ||
			choice !== theirs.choice
		) {
			differs(shown(ours.path));
		}
	});
	return plan;
}

// ── Stage: the workspace the model starts from ────────────────────────────────

/** Write `data` at `path` in the workspace, replacing whatever is there. */
function put(workspace, path, mode, data) {
	const file = join(workspace, path);
	mkdirSync(dirname(file), { recursive: true });
	rmSync(file, { recursive: true, force: true });
	writeFileSync(file, data);
	chmodSync(file, mode === '100755' ? 0o755 : 0o644);
}

/** The conflicts as the model reads them: its files, the pending rules, what rules cleared. */
export function conflictsFor(plan, input, p) {
	const of = (path) => plan.paths.find((x) => x.path === path);
	return {
		mergeRun: input.mergeRun,
		headSha: plan.headSha,
		mainSha: plan.mainSha,
		baseSha: plan.baseSha,
		files: plan.model.map((path) => {
			const x = of(path);
			return {
				path,
				kind: x.kind,
				markerSize: x.markerSize,
				hunks: x.hunks.map((h) => ({ index: h.index, lines: h.lines })),
				met: x.met,
			};
		}),
		pending: plan.paths
			.filter((x) => x.pending)
			.map((x) => ({ path: x.path, rule: x.rule, command: x.pending })),
		byRule: plan.paths
			.filter((x) => x.status === 'mechanical')
			.map((x) => ({ path: x.path, rule: x.rule })),
		result: posix.join(p.out, 'result.json'),
	};
}

/**
 * Turn the workspace (main at MAIN_SHA) into the merged tree, each conflict left for the model
 * with its markers, and list them. `model`: whether the model has anything to do and a budget.
 */
export function stage(p, input) {
	const plan = trustedPlan(p, input);
	mkdirSync(p.out, { recursive: true });
	if (plan.outcome) return { plan, model: false };
	const notMain = [...plan.merged].filter(
		([path, e]) => e.content === undefined && !sameEntry(plan.mainListing.get(path) ?? null, e),
	);
	const bytes = blobs(
		join(p.main, '.git'),
		notMain.map(([, e]) => e.oid),
	);
	for (const path of plan.mainListing.keys()) {
		if (!plan.merged.has(path)) rmSync(join(p.workspace, path), { recursive: true, force: true });
	}
	for (const [path, e] of notMain) put(p.workspace, path, e.mode, bytes.get(e.oid));
	for (const x of plan.paths) if (x.content !== null) put(p.workspace, x.path, x.mode, x.content);
	mkdirSync(p.conflicts, { recursive: true });
	writeFileSync(join(p.conflicts, 'conflicts.json'), JSON.stringify(conflictsFor(plan, input, p)));
	return { plan, model: plan.model.length > 0 && input.budget > 0 };
}

// ── Prepare: the CLI's settings, agents and prompt ────────────────────────────

/**
 * The values the templates are rendered with. bug-fix's settings template (what prove-cli.mjs
 * proves) reads the conflicts folder where a fix run has its bug's: readable, never writable.
 */
export function prepareValues(p) {
	return {
		WORKSPACE: p.workspace,
		MAIN: p.main,
		KEY: p.key,
		OUT: p.out,
		CLAUDE: p.claude,
		BUG: p.conflicts,
		CONFLICTS: posix.join(p.conflicts, 'conflicts.json'),
		RESULT: posix.join(p.out, 'result.json'),
	};
}

/**
 * What bug-fix.yml's own `prepare` renders, into the same places, from the pristine copy: the
 * settings, this folder's coordinator.md as the prompt, the build agents and the tsx shim.
 */
function prepareStep() {
	const input = inputs();
	const p = paths(env('RUNNER_TEMP'), env('GITHUB_WORKSPACE'));
	const values = prepareValues(p);
	const bugFix = join(p.main, 'scripts', 'bug-fix');
	const promptFile = join(p.main, 'scripts', 'merge-main', 'coordinator.md');
	if (!existsSync(promptFile))
		fail("The model's prompt (scripts/merge-main/coordinator.md) is missing.");
	const conf = posix.join(p.claude, 'conf');
	mkdirSync(conf, { recursive: true });
	mkdirSync(p.out, { recursive: true });
	const settings = render(readFileSync(join(bugFix, 'settings.json'), 'utf8'), values);
	JSON.parse(settings);
	writeFileSync(join(conf, 'settings.json'), settings);
	writeFileSync(join(conf, 'prompt.md'), render(readFileSync(promptFile, 'utf8'), values));
	const agents = agentsJson(join(p.main, '.claude', 'agents'));
	writeFileSync(join(conf, 'agents.json'), JSON.stringify(agents));
	const shimDir = posix.join(env('RUNNER_TEMP'), 'tsx-shim');
	mkdirSync(shimDir, { recursive: true });
	const shim = join(shimDir, 'tsx.mjs');
	writeFileSync(shim, readFileSync(join(bugFix, 'tsx-shim.mjs')));
	const swapped = sandboxTsx(p.workspace, shim);
	printFenced(
		`merge run ${input.mergeRun}: prepared ${Object.keys(agents).length} agents, ${swapped} tsx shims`,
	);
}

// ── Result: what the run changed ──────────────────────────────────────────────

const blobId = (bytes) =>
	createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const modeOf = (st) => ((st.mode & 0o111) !== 0 ? '100755' : '100644');
const lstatOrNull = (file) => {
	try {
		return lstatSync(file);
	} catch {
		return null;
	}
};

/**
 * Every path whose state in the workspace is not what stage left there (the merged tree, each
 * conflict with its markers): `path → 'gone' | 'other' (not a plain file) | 'changed'`. Tracked
 * paths are compared by size, mode and blob id; new files are what main's index does not track
 * and the workspace's ignore files do not hide. Read with main's git, never the workspace's.
 */
export function workspaceChanges(p, plan) {
	const gitDir = join(p.main, '.git');
	const real = realpathSync(p.workspace);
	const expected = plan.merged;
	const oids = [
		...new Set([...expected.values()].filter((e) => e.content === undefined).map((e) => e.oid)),
	];
	const sizes = new Map();
	if (oids.length) {
		const out = git(gitDir, ['cat-file', '--batch-check'], { input: `${oids.join('\n')}\n` });
		for (const line of out.toString('latin1').split('\n')) {
			const [oid, , size] = line.split(' ');
			if (oid) sizes.set(oid, Number(size));
		}
	}
	const fresh = git(gitDir, [
		'--work-tree',
		p.workspace,
		'-c',
		'core.fsmonitor=',
		'-c',
		'core.untrackedCache=false',
		'ls-files',
		'-z',
		'--others',
		'--exclude-standard',
	])
		.toString('utf8')
		.split('\0')
		.filter(Boolean);
	// git lists a folder holding a repository of its own as `dir/`: its files would drop out.
	if (fresh.some((f) => f.endsWith('/'))) noProposal('The run left a nested git repository.');
	const changes = new Map();
	for (const path of new Set([...expected.keys(), ...plan.mainListing.keys(), ...fresh])) {
		if (path === '.git' || path.startsWith('.git/')) continue;
		const want = expected.get(path) ?? null;
		const st = lstatOrNull(join(p.workspace, path));
		if (!st) {
			if (want) changes.set(path, 'gone');
			continue;
		}
		if (!st.isFile()) {
			changes.set(path, 'other');
			continue;
		}
		const text = want?.content;
		const size = text === undefined ? sizes.get(want?.oid) : Buffer.byteLength(text);
		if (!want || st.size !== size || modeOf(st) !== want.mode) {
			changes.set(path, 'changed');
			continue;
		}
		const now = theRuns(() => readPlain(real, join(p.workspace, path), size));
		const same =
			text === undefined ? blobId(now.bytes) === want.oid : now.bytes.equals(Buffer.from(text));
		if (!same || now.mode !== want.mode) changes.set(path, 'changed');
	}
	return changes;
}

const piecesOf = (text) => text.split(/(?<=\n)/).filter(Boolean);
const startsAt = (lines, piece, at) => piece.every((l, i) => lines[at + i] === l);

/**
 * Whether `text` changes anything outside the conflicts of a file's merged `segments`: every clean
 * piece must still be there, in order, the first at the start and the last at the end.
 */
export function outsideEdited(segments, text) {
	const cleans = segments.filter((s) => s.clean !== undefined).map((s) => piecesOf(s.clean));
	const lines = piecesOf(text);
	if (!startsAt(lines, cleans[0], 0)) return true;
	let at = cleans[0].length;
	for (const piece of cleans.slice(1, -1)) {
		let found = -1;
		for (let i = at; i + piece.length <= lines.length && found < 0; i++) {
			if (startsAt(lines, piece, i)) found = i;
		}
		if (found < 0) return true;
		at = found + piece.length;
	}
	const last = cleans.at(-1);
	return !(lines.length - last.length >= at && startsAt(lines, last, lines.length - last.length));
}

/**
 * What the run left in its files, held to §4: only the files left for it changed (a pending file
 * stays main's); each UTF-8 text with no NUL, under 2 MB, no marker left; deleted only where one
 * side deleted it. Answers each final text and mode, and the files changed outside their conflicts.
 */
function resolution(p, plan) {
	const own = new Set(plan.model);
	const real = realpathSync(p.workspace);
	const finals = new Map();
	const modes = new Map();
	for (const [path, how] of workspaceChanges(p, plan)) {
		if (!own.has(path)) {
			noProposal(`The run changed ${names([path])}, which is not one of the files left for it.`);
		}
		if (how === 'other')
			noProposal(`The run left ${names([path])} as something other than a file.`);
		if (how === 'gone') {
			finals.set(path, null);
			continue;
		}
		const now = theRuns(() => readPlain(real, join(p.workspace, path), MAX_FILE_BYTES));
		finals.set(
			path,
			theRuns(() => textOf(now.bytes, path)),
		);
		modes.set(path, now.mode);
	}
	const outside = [];
	for (const x of plan.paths.filter((y) => own.has(y.path))) {
		const final = finals.has(x.path) ? finals.get(x.path) : x.content;
		if (final === null) {
			if (x.kind !== 'modify/delete')
				noProposal(`The run deleted ${names([x.path])}, which both sides kept.`);
			continue;
		}
		if (markerLines(final, x.markerSize).length)
			noProposal(`The run left a conflict marker in ${names([x.path])}.`);
		if (x.kind === 'content' && outsideEdited(x.segments, final)) outside.push(x.path);
		finals.set(x.path, final);
	}
	return { finals, modes, outside };
}

// ── Result: the explanation ───────────────────────────────────────────────────

/** Untrusted text as the launcher keeps it: no hidden or control characters, trimmed, capped. */
export function clean(value, cap = TEXT_CAP) {
	if (typeof value !== 'string') return '';
	const text = Array.from(value.replace(/\r\n?/g, '\n').replace(HIDDEN, ''))
		.filter((c) => !control(c))
		.join('')
		.trim();
	return Array.from(text).slice(0, cap).join('');
}

/** Every string a value holds, counted in code points. */
export function measure(value) {
	if (typeof value === 'string') return Array.from(value).length;
	if (Array.isArray(value)) return value.reduce((n, v) => n + measure(v), 0);
	if (value && typeof value === 'object') {
		return Object.values(value).reduce((n, v) => n + measure(v), 0);
	}
	return 0;
}

const DOCS_WHY =
	"Both sides only added lines here, so no line is lost: this change's go above main's, as it lands later and these files are newest first.";

/**
 * How the proposal words a build rule's file: each side's, and what follows Accept in plain words.
 * Nothing is built here (no job runs branch code), so the file is main's until a person or CI acts.
 */
const RULE_WORDS = {
	'runtime-bytes': (x) => ({
		main: `The ${x.runtime} runtime's bytes as main recorded them.`,
		change: `The ${x.runtime} runtime's bytes as this change recorded them.`,
		after:
			"After Accept, CI's runtime-bytes check fails; click **Re-record runtime bytes** on the change.",
	}),
	'vendored-bundle': (x) => ({
		main: `The ${x.bundle} bundle as main built it.`,
		change: `The ${x.bundle} bundle as this change built it.`,
		after: `After Accept, rebuild with \`pnpm --filter launcher-api build:${x.bundle}\` in the change's session.`,
	}),
	ratchet: () => ({
		main: 'The baseline as main recorded it.',
		change: 'The baseline as this change recorded it.',
		after:
			"After Accept, lower the baseline in the change's session if `check:svelte` or lint fails.",
	}),
};

/** What a rule did to one file, as the proposal's hunks for it. */
function ruleHunks(x) {
	if (x.rule === 'docs-append') {
		return x.hunks.map((h) => ({
			path: x.path,
			index: h.index,
			main: sideOf(x, h.index, 'main'),
			change: sideOf(x, h.index, 'change'),
			takes: 'both',
			why: DOCS_WHY,
			nowDoes: null,
			otherwise: null,
		}));
	}
	const words = RULE_WORDS[x.rule](x);
	const how = x.pending
		? `main's for now. ${words.after}`
		: "main's: no count differs between the sides.";
	return [
		{
			path: x.path,
			index: 0,
			main: words.main,
			change: words.change,
			takes: 'main',
			why: `Never merged by hand, and never built by the job: ${how}`,
			nowDoes: null,
			otherwise: null,
		},
	];
}

/**
 * What one side really had in a hunk, from the merge's own segments: the lines as git read them,
 * never the model's account of them. A hunk with no lines on that side (or a modify/delete, which
 * has no segments) falls back to the record's one-line summary.
 */
function sideOf(x, index, side) {
	const hunk = x.segments?.filter((s) => s.hunk)[index]?.hunk;
	const text = hunk?.[side]?.trim() ? clean(hunk[side]) : '';
	return text || x.hunks[index][side];
}

/** The model's hunks, outside edits, checks and risks, checked against the files it had. */
function modelExplanation(result, plan, outside) {
	const model = new Map(plan.model.map((path) => [path, plan.paths.find((x) => x.path === path)]));
	const list = (v) => (Array.isArray(v) ? v : noProposal(NO_EXPLANATION));
	const optional = (v) => (v === null || v === undefined ? null : clean(v) || null);
	const seen = new Set();
	const hunks = list(result.hunks).map((h) => {
		const x = model.get(h?.path);
		if (!x || !Number.isInteger(h.index) || h.index < 0 || h.index >= x.hunks.length) {
			noProposal('The run explained a hunk that is not one of its conflicts.');
		}
		const key = `${h.path}\0${h.index}`;
		if (seen.has(key)) noProposal('The run explained one hunk twice.');
		seen.add(key);
		const entry = {
			path: h.path,
			index: h.index,
			main: sideOf(x, h.index, 'main'),
			change: sideOf(x, h.index, 'change'),
			takes: TAKES.includes(h.takes) ? h.takes : null,
			why: clean(h.why),
			nowDoes: optional(h.nowDoes),
			otherwise: optional(h.otherwise),
		};
		if (!entry.takes || !entry.why) noProposal(NO_EXPLANATION);
		if (entry.takes === 'combined' && !entry.nowDoes) noProposal(NO_EXPLANATION);
		return entry;
	});
	for (const x of model.values()) {
		if (x.hunks.some((h) => !seen.has(`${x.path}\0${h.index}`))) noProposal(NO_EXPLANATION);
	}
	const listed = list(result.outside ?? []).map((o) => {
		if (!model.has(o?.path) || !clean(o.what)) noProposal(NO_EXPLANATION);
		return { path: o.path, what: clean(o.what) };
	});
	for (const path of outside) {
		if (!listed.some((o) => o.path === path)) {
			noProposal(`The run changed ${names([path])} outside its conflicts and did not list it.`);
		}
	}
	const checks = list(result.checks ?? [])
		.slice(0, MAX_CHECKS)
		.map((c) => ({ command: clean(c?.command, COMMAND_CAP), ok: c?.ok }));
	if (checks.some((c) => !c.command || typeof c.ok !== 'boolean')) noProposal(NO_EXPLANATION);
	const risks = clean(result.risks);
	if (!risks) noProposal(NO_EXPLANATION);
	return { hunks, outside: listed, checks, risks };
}

/** The model's result.json as data, read through one descriptor; null when there is none. */
function readModelResult(file) {
	if (!existsSync(file)) return null;
	try {
		const bytes = readPlain(realpathSync(dirname(file)), file, MAX_RESULT_JSON).bytes;
		const v = JSON.parse(bytes.toString('utf8'));
		return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
}

/**
 * §4's explanation, whole: what conflicted (from main's git), every hunk (the model's and the
 * rules'), what changed outside, the checks and the risks — what follows Accept for each pending
 * build is a risk.
 * Fitted into 16,000 characters by naming fewer of main's commits per file; null when even none
 * does not fit.
 */
function explanationOf(plan, own) {
	const ruled = plan.paths.filter((x) => x.rule && (x.status === 'mechanical' || x.pending));
	const hunks = [...(own?.hunks ?? []), ...ruled.flatMap((x) => ruleHunks(x))].sort((a, b) =>
		a.path === b.path ? a.index - b.index : a.path < b.path ? -1 : 1,
	);
	const undone = ruled
		.filter((x) => x.pending)
		.map((x) => `${x.path} is main's. ${RULE_WORDS[x.rule](x).after}`);
	const twice = ruled
		.filter((x) => x.rule === 'docs-append')
		.flatMap((x) =>
			x.segments
				.filter((s) => s.hunk)
				.flatMap((s) => sharedLines(s.hunk))
				.map((l) => [x.path, l]),
		)
		.map(([path, l]) => `${path}: both sides added "${clean(l, 100)}", which now appears twice.`);
	const risks = clean([own?.risks, ...undone, ...twice].filter(Boolean).join(' '));
	for (const keep of [5, 3, 1, 0]) {
		const explanation = {
			conflicted: plan.paths
				.filter((x) => x.conflicted)
				.map((x) => ({
					path: x.path,
					met: x.met.slice(0, keep).map((m) => ({ pr: m.pr, title: clean(m.title, 200) })),
				})),
			hunks,
			outside: own?.outside ?? [],
			checks: [...(own?.checks ?? []), ...plan.checks],
			risks: risks || 'none found',
		};
		if (measure(explanation) <= EXPLANATION_CAP) return explanation;
	}
	return null;
}

/** Which side a resolved file takes, from its content and the hunks the run gave it. */
function choiceOf(x, final, mode, hunks) {
	if (final === null) return x.texts.main === null ? 'main' : 'change';
	if (final === x.texts.main && mode === x.entries.main?.mode) return 'main';
	if (final === x.texts.change && mode === x.entries.change?.mode) return 'change';
	return hunks.length && hunks.every((h) => h.takes === 'both') ? 'both' : 'combined';
}

/** The fields every body starts with. */
const opening = (input, baseSha) => ({
	mergeRun: input.mergeRun,
	headSha: input.head,
	mainSha: input.main,
	baseSha: baseSha ?? null,
});

/** A body that ends the run without a proposal: an outcome and its reason. */
export const refusalBody = (input, baseSha, outcome, reason, usage = []) => ({
	...opening(input, baseSha),
	outcome,
	reason: clean(reason) || 'The run ended without a proposal.',
	files: [],
	explanation: null,
	usage,
});

/** A body for a job that broke: its sentence instead of an outcome. */
export const failureBody = (input, baseSha, failure, usage = []) => ({
	...opening(input, baseSha),
	failure: clean(failure),
	reason: null,
	files: [],
	explanation: null,
	usage,
});

/**
 * The proposal: §10's `files` (every path both sides changed, its choice, rule, content and mode)
 * and the explanation. `finals` holds what the run left in its files; `own` is null for a
 * mechanical-only run.
 */
function proposalBody(input, plan, { finals, modes }, own, usage) {
	const files = plan.paths.map((x) => {
		const resolved = finals.has(x.path);
		const content = resolved ? finals.get(x.path) : x.content;
		const mode = resolved ? (modes.get(x.path) ?? x.mode) : x.mode;
		const ownHunks = (own?.hunks ?? []).filter((h) => h.path === x.path);
		const choice = x.rule
			? content === x.texts.main
				? 'main'
				: 'both'
			: plan.model.includes(x.path)
				? choiceOf(x, content, mode, ownHunks)
				: x.choice;
		return { path: x.path, choice, rule: x.rule, content, mode };
	});
	const sizes = files.map((f) => (f.content === null ? 0 : Buffer.byteLength(f.content)));
	const refuse = (sentence) =>
		refusalBody(input, plan.baseSha, own ? 'no_proposal' : 'too_large', sentence, usage);
	if (sizes.some((n) => n > MAX_FILE_BYTES) || sizes.reduce((a, b) => a + b, 0) > MAX_TOTAL_BYTES) {
		return refuse('The merged files are over 2 MB a file or 4 MB in all.');
	}
	const explanation = explanationOf(plan, own);
	if (!explanation) return refuse('The explanation would be longer than 16,000 characters.');
	return {
		...opening(input, plan.baseSha),
		outcome: 'proposed',
		reason: null,
		files,
		explanation,
		usage,
	};
}

/** The run's key, only to make sure the result does not carry it; '' when it cannot be read. */
function readKey(file) {
	try {
		return readFileSync(file, 'utf8').trim();
	} catch {
		const r = spawnSync('/usr/bin/sudo', ['-n', '/bin/cat', '--', file], { encoding: 'utf8' });
		return r.status === 0 ? r.stdout.trim() : '';
	}
}

/**
 * §10's result for this run. Every way it can end has one: a refusal job merge or the redone merge
 * found, a mechanical-only proposal its rules explain, the ceiling spent, the CLI's own failure,
 * the model's proposal, or why it is refused.
 */
export function buildResult(p, input, key = '') {
	let plan = null;
	let usage = [];
	let body;
	try {
		plan = trustedPlan(p, input);
		const base = plan.baseSha;
		if (plan.outcome) return refusalBody(input, base, plan.outcome, plan.reason);
		const none = { finals: new Map(), modes: new Map() };
		if (!plan.model.length) return proposalBody(input, plan, none, null, []);
		if (!(input.budget > 0)) {
			const sentence = `This month's budget for fix and merge runs is spent, so the model did not run: a person resolves ${names(plan.model)}.`;
			return refusalBody(input, base, 'needs_person', sentence);
		}
		const streamFile = join(p.claude, 'stream.jsonl');
		const stream = existsSync(streamFile)
			? readStream(readFileSync(streamFile, 'utf8'))
			: { usage: [], ended: 'absent' };
		usage = stream.usage;
		const broke = failureOf(stream.ended);
		if (broke) return failureBody(input, base, broke, usage);
		const result = readModelResult(join(p.out, 'result.json'));
		if (
			!result ||
			(result.outcome !== undefined && !['proposed', 'needs_person'].includes(result.outcome))
		) {
			return refusalBody(input, base, 'no_proposal', NO_EXPLANATION, usage);
		}
		if (result.outcome === 'needs_person') {
			const why = clean(result.reason);
			return refusalBody(
				input,
				base,
				why ? 'needs_person' : 'no_proposal',
				why || NO_EXPLANATION,
				usage,
			);
		}
		const resolved = resolution(p, plan);
		const own = modelExplanation(result, plan, resolved.outside);
		body = proposalBody(input, plan, resolved, own, usage);
	} catch (err) {
		if (err instanceof NoProposal)
			return refusalBody(input, plan?.baseSha, 'no_proposal', err.message, usage);
		if (!(err instanceof JobError)) throw err;
		return failureBody(input, plan?.baseSha, err.message, usage);
	}
	if (key && JSON.stringify(body).includes(JSON.stringify(key).slice(1, -1))) {
		return failureBody(input, plan.baseSha, "The result held the run's API key.", usage);
	}
	return body;
}

/** The body as sent: JSON, gzipped past 400 KB; null when it unpacks past {@link MAX_BODY_BYTES}. */
export function encodeBody(body) {
	const raw = Buffer.from(JSON.stringify(body), 'utf8');
	if (raw.length > MAX_BODY_BYTES) return null;
	if (raw.length <= GZIP_OVER)
		return { bytes: raw, headers: { 'content-type': 'application/json' } };
	return {
		bytes: gzipSync(raw),
		headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
	};
}

/** The one line the log shows: what was sent and what the launcher answered; no run text. */
export function logLine(id, body, status, answer) {
	const settled = STATUSES.includes(answer?.status) ? `, ${answer.status}` : '';
	const spend =
		typeof answer?.spendUsd === 'number' && Number.isFinite(answer.spendUsd)
			? `, $${answer.spendUsd.toFixed(2)}`
			: '';
	return `merge run ${id}: ${body.outcome ?? 'failure'}, the launcher answered ${status}${settled}${spend}`;
}

const launcherUrl = (id) =>
	`${trustedUrl(env('LAUNCHER_URL'), ['app.invisiblewall.org']).origin}/api/pipeline/merge-runs/${id}/result`;

async function resultStep() {
	const input = inputs();
	const p = paths(env('RUNNER_TEMP'), env('GITHUB_WORKSPACE'));
	const body = buildResult(p, input, readKey(join(p.key, 'anthropic')));
	const post = async (b) => {
		const sent =
			encodeBody(b) ??
			encodeBody(failureBody(input, b.baseSha, 'The result is too large to send.', b.usage));
		const token = await oidcToken(AUDIENCE);
		return request(
			launcherUrl(input.mergeRun),
			{
				method: 'POST',
				headers: { ...sent.headers, authorization: `Bearer ${token}` },
				body: sent.bytes,
			},
			'with the result',
			{ tries: 1, timeoutMs: 10 * 60_000 },
		);
	};
	let sent = body;
	let res = await post(sent);
	// A body the launcher could not take still ends the run, with its spend.
	if ((res.status === 400 || res.status === 413) && !sent.failure) {
		const why = `The launcher refused the result as sent (HTTP ${res.status}).`;
		sent = failureBody(input, body.baseSha, why, body.usage);
		res = await post(sent);
	}
	const answer = await res.json().catch(() => null);
	printFenced(logLine(input.mergeRun, sent, res.status, answer));
	if (!res.ok) process.exitCode = 1;
}

function stageStep() {
	const input = inputs();
	const p = paths(env('RUNNER_TEMP'), env('GITHUB_WORKSPACE'));
	const { plan, model } = stage(p, input);
	appendFileSync(env('GITHUB_OUTPUT'), `model=${model}\n`);
	const byRule = plan.paths.filter((x) => x.status === 'mechanical').length;
	const skipped = plan.model.length && !model ? ', no budget: the model does not run' : '';
	printFenced(
		plan.outcome
			? `merge run ${input.mergeRun}: ${plan.outcome}, nothing staged`
			: `merge run ${input.mergeRun}: staged, ${plan.model.length} file(s) for the model, ${byRule} by rule${skipped}`,
	);
}

const COMMANDS = { stage: stageStep, prepare: prepareStep, result: resultStep };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const command = COMMANDS[process.argv[2]];
	if (!command) {
		console.error('usage: node collect.mjs stage | prepare | result');
		process.exit(2);
	}
	try {
		await command();
	} catch (err) {
		const said = err instanceof JobError ? err.message : 'The step failed (an unexpected error).';
		console.log(`::error title=merge-main::${said}`);
		process.exit(1);
	}
}
