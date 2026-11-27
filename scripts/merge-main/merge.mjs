// Job `merge` of a Resolve conflict run (ADR-0015 §2–§4, card 15B1): merge main into a change at
// two pinned commits, clear what rules can clear, refuse what the job must, and write the `merge`
// record job `propose` reads. It runs from main's copy of scripts/merge-main/ and holds no secrets.
// It runs NO branch code: no install, no build, no ratchet (§2, the owner's decision of 2026-11-27).
// A branch's build could poison the Actions cache that main's own workflows restore.
//
//   node scripts/merge-main/merge.mjs --repo <checkout> --head <sha> --main <sha> --out <dir>
//
// <checkout> is a checkout of the change whose git also holds --head, --main and the history back
// to their merge base; only its git is read, its working tree is never touched. <dir> must not
// exist.
//
// PATH BY PATH. A path only one side changed takes that side's entry; only a path both sides
// changed is merged, with `git merge-file --diff3`, on the merge base's version (empty when both
// added it). No rename detection: that is how the launcher builds the merge from three trees (§5),
// so nothing can land on a path only one side changed.
//
// THE RULES (§3), each only where it applies cleanly; anything else is the model's:
//   docs-append      a `docs/**/*.md` whose every conflict both sides only added lines to: both
//                    kept, this change's above main's — unless both added the same block (two
//                    or more long lines), which keeping both would write twice
//   runtime-bytes    `scripts/runtime-bytes/<id>.json`: main's, pending
//   vendored-bundle  a bundle `check-vendored-bundles.mjs` lists: main's, pending
//   ratchet          `svelte-check-baseline.json`, `eslint-suppressions.json`: main's, pending
// The three that need a build are `pending`: the file holds main's, mechanical, `choice: 'main'`,
// and the record names the command a person or CI runs on the change afterwards
// (`pnpm check:runtime-bytes --update --only <id>`, `pnpm --filter launcher-api build:<name>`, the
// ratchet's update). Nothing here runs it.
//
// THE REFUSALS (§4), the most binding first: `harness_conflict` (a conflict under
// .github/workflows/ or scripts/current-games/), `needs_person` (a lockfile conflict, a migration
// number both sides added, a binary, a link or submodule, a mode both sides changed, a file and a
// folder at one path, not one merge base, nothing that conflicts), `protected_conflict` (a file
// left for the model that ADR-0013's list protects, read from bugFixRunsChange.ts), `too_large`
// (more than 10 files or 600 conflicting lines left for the model, a file over 2 MB, 4 MB in all).
//
// THE RECORD — <dir>/record.json, and <dir>/files/<n> holding each path's content:
//   { version: 1, headSha, mainSha, baseSha (null without one merge base),
//     outcome: null | 'needs_person' | 'harness_conflict' | 'protected_conflict' | 'too_large',
//     reason: null | '<sentence naming the files>',
//     paths: [{                                  every path both sides changed, sorted
//       path, status: 'clean' | 'mechanical' | 'conflict',
//       conflicted: bool,                        git could not merge it on its own
//       kind: 'identical' | 'content' | 'modify/delete',
//       rule: null | 'docs-append' | 'runtime-bytes' | 'vendored-bundle' | 'ratchet',
//       pending: null | '<commands>',            a rule's build (`a && b`), never run here: the
//                                                person or CI runs it after Accept
//       choice: null | 'main' | 'change' | 'both',   null while it is a conflict
//       mode: '100644' | '100755', file: 'files/<n>' | null (deleted),
//       sides: { base, change, main: '<blob id>' | null },
//       markerSize, hunks: [{ index, appendOnly, lines, change, main }],   change/main: summaries
//       lines,                                   conflicting lines, markers aside
//       met: [{ pr, title }] }],                 main's newest commits on it, when conflicted
//     model: ['<path>'],                         the files left for the model (status conflict,
//                                                rule null)
//     checks: [{ command, ok }] }                the text-only checks (docs-append); no command runs
// A path's file is what the merged tree holds there: git's clean merge, a rule's result, main's
// (pending), or the file with its markers (labelled `this change` | `base` | `main`, `markerSize`
// long). Nothing in it is trusted more than the branch: collect.mjs redoes all of it from main's
// git, and the launcher takes only what §5 allows.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { JobError, fail, printFenced, shown } from '../bug-fix/collect.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SHA = /^[0-9a-f]{40}$/;
const LABELS = { change: 'this change', base: 'base', main: 'main' };
const MAX_MODEL_FILES = 10;
const MAX_MODEL_LINES = 600;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_MET = 5;
const HARNESS = ['.github/workflows/', 'scripts/current-games/'];
export const RUNTIME_BYTES = /^scripts\/runtime-bytes\/([A-Za-z0-9_-]+)\.json$/;
const MIGRATION = /(?:^|\/)drizzle\/(\d{4})_[^/]+\.sql$/;
const DOCS = /^docs\/.+\.md$/;
/** A line both sides added in one hunk, from this length, is the same text added twice; shorter
 *  ones (a blank, a bullet's tail) repeat on purpose. Two such lines are a block both added. */
const DISTINCT_LINE = 40;
const PRINTABLE_PATH = /^[\x20-\x7e]{1,300}$/;
const REGULAR = ['100644', '100755'];
/** The ratchets' baselines (at the root) and the commands that lower each, for a person or CI. */
export const RATCHETS = {
	'svelte-check-baseline.json': (packages) =>
		packages.length
			? [
					['pnpm', 'check:svelte', '--only', packages.join(',')],
					['pnpm', 'check:svelte', '--only', packages.join(','), '--update'],
				]
			: [],
	'eslint-suppressions.json': () => [['pnpm', 'lint', '--prune-suppressions']],
};

// ── The lists this job reads from main's own files ────────────────────────────

/** What sits between the brackets of `const <name> … = [ … ];`; '' when absent. */
const listBlock = (src, name) =>
	new RegExp(`\\nconst ${name}\\b[^=\\n]*= \\[([\\s\\S]*?)\\];`).exec(src)?.[1] ?? '';

/** A list of single-quoted strings, or null when it holds anything else. */
function quotedList(block) {
	const rest = block.replace(/'[^'\n]+'/g, '').replace(/\/\/.*$/gm, '');
	return /^[\s,]*$/.test(rest) ? [...block.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]) : null;
}

/** A string literal, or a `const NAME = '…';` it names; null when it is neither. */
function literal(src, text) {
	const quoted = /^(['"])(.*)\1$/.exec(text);
	if (quoted) return quoted[2];
	const named = new RegExp(`\\nconst ${text} = (['"])(.*)\\1;\\n`).exec(src);
	return /^[A-Z_]+$/.test(text) && named ? named[2] : null;
}

/** A list of `[/re/flags, label],` lines, or null when a line is anything else. */
function ruleList(src, block) {
	const lines = block.split('\n').filter((l) => !/^\s*(?:\/\/.*)?$/.test(l));
	const rules = lines.map((l) => {
		const m = /^\s*\[\/(.+)\/([a-z]*), (.+)\],$/.exec(l);
		const label = m && literal(src, m[3]);
		return label ? { re: new RegExp(m[1], m[2]), label } : null;
	});
	return rules.every(Boolean) ? rules : null;
}

/**
 * ADR-0013's protected paths, the lockfile names and the vendored bundles, read from the files
 * that define them (main's, beside this script), never copied: a list that cannot be read stops
 * the job rather than protect nothing.
 */
export function loadRules(root = ROOT) {
	const src = readFileSync(
		join(root, 'apps/launcher-api/src/lib/server/bugFixRunsChange.ts'),
		'utf8',
	).replace(/\r\n/g, '\n');
	const sibling = /\nconst SIBLING_SOURCE = \/(.+)\/([a-z]*);\n/.exec(src);
	const rules = {
		paths: quotedList(listBlock(src, 'PROTECTED_PATHS')),
		names: quotedList(listBlock(src, 'PROTECTED_NAMES')),
		nameRules: ruleList(src, listBlock(src, 'PROTECTED_NAME_RULES')),
		pathRules: ruleList(src, listBlock(src, 'PROTECTED_PATH_RULES')),
		locks: quotedList(listBlock(src, 'LOCK_NAMES')),
		sibling: sibling ? new RegExp(sibling[1], sibling[2]) : null,
	};
	const vendored = readFileSync(
		join(root, 'apps/launcher-api/scripts/check-vendored-bundles.mjs'),
		'utf8',
	).replace(/\r\n/g, '\n');
	const block = listBlock(vendored, 'BUNDLES');
	const bundles = [...block.matchAll(/\{ name: '([^']+)', committed: '([^']+)' \}/g)];
	if (
		Object.values(rules).some((v) => !v || (Array.isArray(v) && !v.length)) ||
		!bundles.length ||
		bundles.length !== (block.match(/\{/g) ?? []).length
	) {
		fail('A list the merge reads (protected paths, lockfiles, vendored bundles) is unreadable.');
	}
	return { ...rules, bundles: new Map(bundles.map((m) => [`apps/launcher-api/${m[2]}`, m[1]])) };
}

/** The protected entry `path` is or is under, as bugFixRunsChange.ts's `protectedEntry` reads. */
export function protectedEntry(rules, path) {
	const asTs = rules.sibling.test(path) ? path.replace(rules.sibling, '.ts') : `${path}.ts`;
	return entryOf(rules, path) ?? entryOf(rules, asTs);
}

function entryOf(rules, path) {
	const segments = path.toLowerCase().split('/');
	for (let i = 1; i <= segments.length; i++) {
		const prefix = segments.slice(0, i).join('/');
		const name = segments[i - 1];
		if (rules.paths.includes(prefix)) return prefix;
		if (rules.names.includes(name)) return name;
		for (const { re, label } of rules.nameRules) if (re.test(name)) return label;
		for (const { re, label } of rules.pathRules) if (re.test(prefix)) return label;
	}
	return null;
}

// ── git ───────────────────────────────────────────────────────────────────────

const gitEnv = () => ({
	PATH: process.env.PATH ?? '',
	HOME: '/nonexistent',
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: '/dev/null',
	LANG: 'C',
});

/** git on `gitDir` with no system or global config and literal pathspecs: stdout, or a JobError. */
export function git(gitDir, args, { input, codes = [0] } = {}) {
	const r = spawnSync(
		'git',
		['-c', 'safe.directory=*', '--literal-pathspecs', '--git-dir', gitDir, ...args],
		{ env: gitEnv(), input, maxBuffer: 1024 * 1024 * 1024 },
	);
	if (r.error || !codes.includes(r.status)) fail(`git ${args[0]} failed on the merge.`);
	return r.stdout;
}

/** A checkout's git directory. */
export function gitDirOf(repo) {
	const r = spawnSync(
		'git',
		['-c', 'safe.directory=*', '-C', repo, 'rev-parse', '--absolute-git-dir'],
		{ env: gitEnv(), encoding: 'utf8' },
	);
	if (r.status !== 0) fail('The checkout is not a git repository.');
	return r.stdout.trim();
}

/** Every file of a commit: path → { mode, oid }. */
export function listing(gitDir, commit) {
	const out = new Map();
	for (const line of git(gitDir, ['ls-tree', '-r', '-z', '--full-tree', commit])
		.toString('utf8')
		.split('\0')) {
		if (!line) continue;
		const tab = line.indexOf('\t');
		const [mode, , oid] = line.slice(0, tab).split(' ');
		out.set(line.slice(tab + 1), { mode, oid });
	}
	return out;
}

/** Blobs' bytes by id, from one `cat-file --batch`. */
export function blobs(gitDir, oids) {
	const unique = [...new Set(oids)];
	const out = new Map();
	if (!unique.length) return out;
	const raw = git(gitDir, ['cat-file', '--batch'], { input: `${unique.join('\n')}\n` });
	let at = 0;
	for (const oid of unique) {
		const nl = raw.indexOf(10, at);
		const [got, type, size] = raw.subarray(at, nl).toString('latin1').split(' ');
		if (got !== oid || type !== 'blob') fail('git could not read a file of the merge.');
		out.set(oid, raw.subarray(nl + 1, nl + 1 + Number(size)));
		at = nl + 1 + Number(size) + 1;
	}
	return out;
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** UTF-8 text with no NUL, or null: a binary file. */
export function textOrNull(bytes) {
	try {
		const text = decoder.decode(bytes);
		return text.includes('\u0000') ? null : text;
	} catch {
		return null;
	}
}

/** Whether two tree entries (or absences) are the same. */
export const sameEntry = (a, b) =>
	a === null ? b === null : b !== null && a.mode === b.mode && a.oid === b.oid;

// ── One file's three-way merge ────────────────────────────────────────────────

/**
 * The shortest marker (git's 7 at least) that no line of any side starts with a run of, so a
 * marker can never be read as a line of the file, nor a line as a marker.
 */
function markerSize(texts) {
	let size = 7;
	for (const text of texts) {
		for (const line of (text ?? '').split('\n')) {
			const run = /^([<>|=])\1*/.exec(line)?.[0].length ?? 0;
			if (run >= size) size = run + 1;
		}
	}
	return size;
}

/** `git merge-file --diff3` of three texts: the merged text and how many conflicts it holds. */
function mergeFile(change, base, main, size) {
	const dir = mkdtempSync(join(tmpdir(), 'merge-main-'));
	try {
		const files = ['change', 'base', 'main'].map((n) => join(dir, n));
		[change, base, main].forEach((text, i) => writeFileSync(files[i], text));
		const labels = Object.values(LABELS).flatMap((l) => ['-L', l]);
		const r = spawnSync(
			'git',
			['merge-file', '-p', '--diff3', '--marker-size', String(size), ...labels, ...files],
			{ cwd: dir, env: gitEnv(), maxBuffer: 1024 * 1024 * 1024 },
		);
		if (r.error || r.status === null || r.status > 127) fail('git merge-file failed on the merge.');
		const text = textOrNull(r.stdout);
		if (text === null) fail('git merge-file wrote something that is not text.');
		return { text, conflicts: r.status };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * A merged text with markers, as its pieces in order: `{ clean }` and `{ hunk: { change, base,
 * main } }` alternating, a clean piece (maybe '') first and last.
 */
export function segmentsOf(text, size) {
	const open = `${'<'.repeat(size)} ${LABELS.change}`;
	const mid = `${'|'.repeat(size)} ${LABELS.base}`;
	const sep = '='.repeat(size);
	const close = `${'>'.repeat(size)} ${LABELS.main}`;
	const out = [];
	let clean = '';
	let hunk = null;
	let part = null;
	for (const line of text.split(/(?<=\n)/)) {
		const bare = line.replace(/\r?\n$/, '');
		if (part === null && bare === open) {
			out.push({ clean });
			clean = '';
			hunk = { change: '', base: '', main: '' };
			part = 'change';
		} else if (part === 'change' && bare === mid) part = 'base';
		else if (part === 'base' && bare === sep) part = 'main';
		else if (part === 'main' && bare === close) {
			out.push({ hunk });
			part = null;
		} else if (part === null) clean += line;
		else hunk[part] += line;
	}
	if (part !== null) fail('git merge-file left a conflict it did not close.');
	out.push({ clean });
	return out;
}

/** The lines of `text` a marker of `size` would be: what a resolved file must not hold. */
export function markerLines(text, size) {
	const starts = ['<', '|', '>'].map((c) => c.repeat(size));
	return text
		.split('\n')
		.map((l) => l.replace(/\r$/, ''))
		.filter((l) => starts.some((s) => l.startsWith(s)) || l === '='.repeat(size));
}

const lineCount = (text) => (text ? text.split(/(?<=\n)/).length : 0);

/** What one side of a hunk does, in a line: `Adds 3 lines here: "…".` */
function summary(text, edits) {
	const n = lineCount(text);
	if (!n) return edits ? 'Removes these lines.' : 'Adds nothing.';
	const first = (text.split('\n').find((l) => l.trim()) ?? '').trim();
	const cut = Array.from(first).slice(0, 100).join('');
	const quote = cut ? `: "${cut}${cut.length < first.length ? '...' : ''}"` : '';
	return `${edits ? 'Has' : 'Adds'} ${n} line${n === 1 ? '' : 's'} here${quote}.`;
}

// ── The merge, decided ────────────────────────────────────────────────────────

/** A value's JSON with its keys sorted, to compare two baselines' entries. */
const canon = (v) =>
	v && typeof v === 'object' && !Array.isArray(v)
		? `{${Object.keys(v)
				.sort()
				.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
				.join(',')}}`
		: JSON.stringify(v);

/** A JSON object, or null. */
export function jsonObject(text) {
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
}

/** "a, b and c", or "a, b … and 3 more": the files a reason names. */
export function names(paths, max = 8) {
	const listed = paths
		.slice(0, max)
		.map((p) => (PRINTABLE_PATH.test(p) ? p : '(a path outside printable ASCII)'));
	const rest = paths.length - listed.length;
	if (rest > 0) return `${listed.join(', ')} and ${rest} more`;
	return listed.length > 1 ? `${listed.slice(0, -1).join(', ')} and ${listed.at(-1)}` : listed[0];
}

/** main's newest commits on `path` since the merge base, `(#n)` read off each subject. */
function metOf(gitDir, base, main, path) {
	return git(gitDir, [
		'log',
		'-z',
		`--max-count=${MAX_MET}`,
		'--format=%s',
		`${base}..${main}`,
		'--',
		path,
	])
		.toString('utf8')
		.split('\0')
		.filter(Boolean)
		.map((subject) => {
			const m = /^(.*?)\s*\(#(\d{1,7})\)$/.exec(subject);
			const title = Array.from(m ? m[1] : subject)
				.slice(0, 200)
				.join('');
			return { pr: m ? Number(m[2]) : null, title };
		});
}

const commandText = (args) => args.join(' ');

/**
 * The commands that bring a build rule's file up to the merged tree: named in the record and the
 * proposal, run by a person or CI after Accept, never by this job. A ratchet with nothing to check
 * has none.
 */
export function followUp(plan) {
	if (plan.rule === 'runtime-bytes') {
		return [['pnpm', 'check:runtime-bytes', '--update', '--only', plan.runtime]];
	}
	if (plan.rule === 'vendored-bundle') {
		return [['pnpm', '--filter', 'launcher-api', `build:${plan.bundle}`]];
	}
	return RATCHETS[plan.path](plan.packages);
}

/** Refusals gathered as the merge is read: kind → sentence → paths. */
function refusals() {
	const by = { harness: new Map(), person: new Map(), protected: new Map(), large: new Map() };
	return {
		add: (kind, path, sentence) =>
			by[kind].set(sentence, [...(by[kind].get(sentence) ?? []), path]),
		/** The most binding outcome and its reason, or null. */
		decide() {
			const order = [
				['harness', 'harness_conflict'],
				['person', 'needs_person'],
				['protected', 'protected_conflict'],
				['large', 'too_large'],
			];
			const [kind, outcome] = order.find(([k]) => by[k].size) ?? [];
			if (!kind) return null;
			const reason = [...by[kind]]
				.map(([sentence, paths]) => {
					const named = names([...new Set(paths.filter(Boolean))]);
					return named ? `${named}: ${sentence}.` : `${sentence}.`;
				})
				.join(' ');
			return { outcome, reason };
		},
	};
}

/** A path's plan before it is merged. */
function planOf(path, entries) {
	return {
		path,
		status: 'clean',
		conflicted: false,
		kind: 'content',
		rule: null,
		pending: null,
		choice: null,
		mode: (entries.main ?? entries.change ?? entries.base).mode,
		content: null,
		entries,
		sides: {
			base: entries.base?.oid ?? null,
			change: entries.change?.oid ?? null,
			main: entries.main?.oid ?? null,
		},
		texts: { base: null, change: null, main: null },
		markerSize: 7,
		segments: null,
		hunks: [],
		lines: 0,
		met: [],
	};
}

/** Merge one path both sides changed: its kind, status, mode and content, or a refusal. */
function mergePath(plan, bytes, refuse) {
	const { entries } = plan;
	if (!PRINTABLE_PATH.test(plan.path))
		return refuse('person', plan.path, 'a path outside printable ASCII');
	if (Object.values(entries).some((e) => e && !REGULAR.includes(e.mode))) {
		return refuse('person', plan.path, 'a link or a submodule both sides changed');
	}
	for (const k of ['base', 'change', 'main']) {
		plan.texts[k] = entries[k] ? textOrNull(bytes.get(entries[k].oid)) : null;
		if (entries[k] && plan.texts[k] === null) {
			return refuse('person', plan.path, 'a binary file both sides changed');
		}
	}
	const { base, change, main } = plan.texts;
	plan.markerSize = markerSize([base, change, main]);
	if (sameEntry(entries.change, entries.main)) {
		return Object.assign(plan, { kind: 'identical', choice: 'main', content: main });
	}
	if (!entries.change || !entries.main) {
		const kept = entries.change ? 'change' : 'main';
		const lines = lineCount(plan.texts[kept]);
		return Object.assign(plan, {
			kind: 'modify/delete',
			status: 'conflict',
			conflicted: true,
			mode: entries[kept].mode,
			content: plan.texts[kept],
			hunks: [
				{
					index: 0,
					appendOnly: false,
					lines,
					change: entries.change ? 'Keeps the file, changed.' : 'Deletes the file.',
					main: entries.main ? 'Keeps the file, changed.' : 'Deletes the file.',
				},
			],
			lines,
		});
	}
	const [mb, mc, mm] = [entries.base?.mode, entries.change.mode, entries.main.mode];
	const mode = mc === mm ? mc : mc === mb ? mm : mm === mb ? mc : null;
	if (!mode) return refuse('person', plan.path, 'a file both sides gave a different mode');
	plan.mode = mode;
	const merged = mergeFile(change, base ?? '', main, plan.markerSize);
	plan.content = merged.text;
	if (merged.conflicts === 0) {
		plan.choice =
			merged.text === main && mode === mm
				? 'main'
				: merged.text === change && mode === mc
					? 'change'
					: 'both';
		return plan;
	}
	plan.status = 'conflict';
	plan.conflicted = true;
	plan.segments = segmentsOf(merged.text, plan.markerSize);
	plan.hunks = plan.segments
		.filter((s) => s.hunk)
		.map(({ hunk }, index) => ({
			index,
			appendOnly: hunk.base === '' && hunk.change !== '' && hunk.main !== '',
			lines: lineCount(hunk.change) + lineCount(hunk.base) + lineCount(hunk.main),
			change: summary(hunk.change, hunk.base !== ''),
			main: summary(hunk.main, hunk.base !== ''),
		}));
	plan.lines = plan.hunks.reduce((n, h) => n + h.lines, 0);
	return plan;
}

/** The docs-append rule on a conflicted plan: true when it applied. */
function docsAppend(plan, out) {
	const ends = Object.values(plan.texts).every((t) => !t || t.endsWith('\n'));
	if (!DOCS.test(plan.path) || !ends || !plan.hunks.every((h) => h.appendOnly)) return false;
	const twice = plan.segments.some((s) => s.hunk && sharedLines(s.hunk).length > 1);
	const text = plan.segments.map((s) => s.clean ?? s.hunk.change + s.hunk.main).join('');
	if (twice || markerLines(text, plan.markerSize).length) return false;
	Object.assign(plan, { status: 'mechanical', rule: 'docs-append', choice: 'both', content: text });
	out.checks.push({
		command: `docs-append ${plan.path}: each hunk keeps both sides' lines, no conflict marker left`,
		ok: true,
	});
	return true;
}

/** The long lines (DISTINCT_LINE or more) both sides added in one hunk. */
export function sharedLines(hunk) {
	const distinct = (l) => l.trim().length >= DISTINCT_LINE;
	const ours = new Set(hunk.change.split('\n').filter(distinct));
	return [...new Set(hunk.main.split('\n').filter((l) => distinct(l) && ours.has(l)))];
}

/** Which build rule a conflicted plan falls under, set on it; false when none applies. */
function buildRule(plan, rules) {
	if (plan.kind !== 'content') return false;
	const runtime = RUNTIME_BYTES.exec(plan.path)?.[1];
	if (runtime) Object.assign(plan, { rule: 'runtime-bytes', runtime });
	else if (rules.bundles.has(plan.path)) {
		Object.assign(plan, { rule: 'vendored-bundle', bundle: rules.bundles.get(plan.path) });
	} else if (Object.hasOwn(RATCHETS, plan.path)) {
		const sides = [plan.texts.base ?? '{}', plan.texts.change, plan.texts.main].map(jsonObject);
		if (!sides.every(Boolean)) return false;
		const keys = [...new Set(sides.flatMap((s) => Object.keys(s)))].sort();
		const packages = keys.filter((k) => new Set(sides.map((s) => canon(s[k]))).size > 1);
		Object.assign(plan, { rule: 'ratchet', packages });
	} else return false;
	const commands = followUp(plan).map(commandText).join(' && ');
	return Object.assign(plan, {
		status: 'mechanical',
		choice: 'main',
		pending: commands || null,
		content: plan.texts.main,
		mode: plan.entries.main.mode,
	});
}

/**
 * The merge of `main` into `head` in `gitDir`, decided: every path both sides changed with its
 * status, rule and content, the files left for the model, and the outcome the refusals give.
 * Plumbing only — it writes nothing and runs nothing of the branch — so collect.mjs redoes it
 * from main's git. A build rule takes main's file and is marked `pending`; `merged` is
 * the whole merged tree (path → tree entry, or the plan of a path both sides changed).
 */
export function analyse({ gitDir, head, main, rules = loadRules() }) {
	if (!SHA.test(head) || !SHA.test(main)) fail('The head and main commits are not 40 hex.');
	const bases = git(gitDir, ['merge-base', '--all', head, main], { codes: [0, 1] })
		.toString('utf8')
		.split('\n')
		.filter(Boolean);
	const out = {
		headSha: head,
		mainSha: main,
		baseSha: bases.length === 1 ? bases[0] : null,
		outcome: null,
		reason: null,
		paths: [],
		model: [],
		checks: [],
		merged: new Map(),
		mainListing: new Map(),
	};
	if (bases.length !== 1) {
		out.outcome = 'needs_person';
		out.reason = bases.length
			? 'The change and main have more than one merge base: a person merges them.'
			: 'The change and main share no history.';
		return out;
	}
	const base = bases[0];
	const [lb, lh, lm] = [base, head, main].map((c) => listing(gitDir, c));
	out.mainListing = lm;
	const at = (l, p) => l.get(p) ?? null;
	for (const p of [...new Set([...lb.keys(), ...lh.keys(), ...lm.keys()])].sort()) {
		const entries = { base: at(lb, p), change: at(lh, p), main: at(lm, p) };
		const byHead = !sameEntry(entries.base, entries.change);
		const byMain = !sameEntry(entries.base, entries.main);
		if (byHead && byMain) out.paths.push(planOf(p, entries));
		else if (byHead ? entries.change : entries.main) {
			out.merged.set(p, byHead ? entries.change : entries.main);
		}
	}
	const bytes = blobs(
		gitDir,
		out.paths.flatMap((p) =>
			Object.values(p.entries)
				.filter(Boolean)
				.map((e) => e.oid),
		),
	);
	const refused = refusals();
	let total = 0;
	for (const plan of out.paths) {
		mergePath(plan, bytes, refused.add);
		if (plan.content !== null) {
			out.merged.set(plan.path, plan);
			total += Buffer.byteLength(plan.content);
			if (Buffer.byteLength(plan.content) > MAX_FILE_BYTES) {
				refused.add('large', plan.path, 'a file over 2 MB');
			}
		}
		if (plan.conflicted) plan.met = metOf(gitDir, base, main, plan.path);
	}
	if (total > MAX_TOTAL_BYTES) refused.add('large', '', 'The merged files come to more than 4 MB');

	const conflicted = out.paths.filter((p) => p.conflicted);
	for (const plan of conflicted) {
		if (HARNESS.some((h) => plan.path.startsWith(h))) {
			refused.add('harness', plan.path, 'the harness, which the owner merges by hand (ADR-0004)');
		}
		if (rules.locks.includes(plan.path.toLowerCase().split('/').at(-1))) {
			refused.add('person', plan.path, "a lockfile: a dependency merge is a person's call");
		}
	}
	const migrations = (l) =>
		[...l]
			.filter(([p]) => !lb.has(p) && MIGRATION.test(p))
			.map(([p, e]) => ({ n: MIGRATION.exec(p)[1], key: `${p}\0${e.oid}`, path: p }));
	const [onHead, onMain] = [migrations(lh), migrations(lm)];
	for (const n of new Set(onHead.map((m) => m.n))) {
		const [h, m] = [onHead, onMain].map((list) => list.filter((x) => x.n === n));
		const same = h.length === m.length && h.every((x) => m.some((y) => y.key === x.key));
		if (m.length && !same) {
			for (const x of [...h, ...m])
				refused.add('person', x.path, 'a migration number both sides used');
		}
	}
	for (const [p, e] of out.merged) {
		if (!REGULAR.includes(e.mode)) refused.add('person', p, 'a link or a submodule in the merge');
		for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
			if (out.merged.has(p.slice(0, i))) {
				refused.add('person', p.slice(0, i), 'a file where the other side has a folder');
			}
		}
	}
	if (!conflicted.length) {
		refused.add(
			'person',
			'',
			'Nothing conflicts path by path: GitHub sees a rename or a folder clash',
		);
	}

	for (const plan of conflicted) {
		if (plan.kind === 'content' && docsAppend(plan, out)) continue;
		if (!buildRule(plan, rules)) out.model.push(plan.path);
	}
	const forModel = out.paths.filter((p) => out.model.includes(p.path));
	for (const plan of forModel) {
		const guarded = protectedEntry(rules, plan.path);
		if (guarded) refused.add('protected', plan.path, `protected (${guarded})`);
	}
	if (forModel.length > MAX_MODEL_FILES) {
		for (const p of forModel) {
			refused.add('large', p.path, `more than ${MAX_MODEL_FILES} files left for the model`);
		}
	}
	const lines = forModel.reduce((n, p) => n + p.lines, 0);
	if (lines > MAX_MODEL_LINES) {
		const sentence = `${lines} conflicting lines left for the model, past ${MAX_MODEL_LINES}`;
		for (const p of forModel) refused.add('large', p.path, sentence);
	}
	Object.assign(out, refused.decide());

	return out;
}

// ── The record ────────────────────────────────────────────────────────────────

/** The record as job `propose` reads it: `dir`/record.json, each content under `dir`/files/. */
function writeRecord(dir, analysis) {
	mkdirSync(join(dir, 'files'), { recursive: true });
	const paths = analysis.paths.map((p, i) => {
		const file = p.content === null ? null : `files/${i}`;
		if (file) writeFileSync(join(dir, file), p.content);
		return {
			path: p.path,
			status: p.status,
			conflicted: p.conflicted,
			kind: p.kind,
			rule: p.rule,
			pending: p.pending,
			choice: p.status === 'conflict' ? null : p.choice,
			mode: p.mode,
			file,
			sides: p.sides,
			markerSize: p.markerSize,
			hunks: p.hunks,
			lines: p.lines,
			met: p.met,
		};
	});
	const record = {
		version: 1,
		headSha: analysis.headSha,
		mainSha: analysis.mainSha,
		baseSha: analysis.baseSha,
		outcome: analysis.outcome,
		reason: analysis.reason,
		paths,
		model: analysis.model,
		checks: analysis.checks,
	};
	writeFileSync(join(dir, 'record.json'), `${JSON.stringify(record, null, '\t')}\n`);
	return record;
}

/**
 * Job `merge`, whole: decide the merge and write the record to `out`. Plumbing and text only: no
 * command of the branch runs.
 */
export function mergeMain({ repo, head, main, out, rules = loadRules() }) {
	const analysis = analyse({ gitDir: gitDirOf(repo), head, main, rules });
	mkdirSync(out);
	return writeRecord(out, analysis);
}

/** What the log shows of a record: the outcome, the counts and each conflicted path. */
export function recordSummary(record) {
	const conflicted = record.paths.filter((p) => p.conflicted);
	const byRule = conflicted.filter((p) => p.status === 'mechanical').length;
	return [
		`merge ${record.headSha.slice(0, 9)} with main ${record.mainSha.slice(0, 9)}: ` +
			`${record.outcome ?? 'ready'}, ${conflicted.length} conflicted, ${byRule} by rule, ` +
			`${record.model.length} for the model`,
		...conflicted
			.slice(0, 50)
			.map((p) => `  ${p.status.padEnd(10)} ${(p.rule ?? '-').padEnd(15)} ${shown(p.path)}`),
	].join('\n');
}

function cli(argv) {
	const got = {};
	for (let i = 0; i < argv.length; i += 2) {
		const m = /^--(repo|head|main|out)$/.exec(argv[i]);
		if (!m || argv[i + 1] === undefined) {
			fail('usage: merge.mjs --repo <checkout> --head <sha> --main <sha> --out <dir>');
		}
		got[m[1]] = argv[i + 1];
	}
	for (const k of ['repo', 'head', 'main', 'out']) if (!got[k]) fail(`--${k} is missing.`);
	return mergeMain({
		repo: resolve(got.repo),
		head: got.head,
		main: got.main,
		out: resolve(got.out),
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		printFenced(recordSummary(cli(process.argv.slice(2))));
	} catch (err) {
		const said = err instanceof JobError ? err.message : 'The merge failed (an unexpected error).';
		console.log(`::error title=merge-main::${said}`);
		process.exit(1);
	}
}
