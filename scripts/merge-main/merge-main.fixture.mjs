// check:merge-main — the Resolve conflict run's own code (ADR-0015 §3, §4, §10; card 15B1), offline:
// one case per rule and per refusal on scratch git repositories in a temporary folder (never the
// checkout), the guards `collect.mjs result` holds the model's resolution to, the §10 body's exact
// shape, and both job steps end to end against a loopback launcher and token service.
//
//   node scripts/merge-main/merge-main.fixture.mjs      (pnpm check:merge-main; check:all runs it)
//
// The builds a rule runs are faked: a stand-in runner records each command and writes what the
// real one would. What the real commands do on the real tree is CI's to prove on the pushed head.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
	AUDIENCE,
	EXPLANATION_CAP,
	LINES_CAP,
	LINES_TOTAL_CAP,
	NO_EXPLANATION,
	TAKES,
	TEXT_CAP,
	budgetOf,
	buildResult,
	clean,
	cleanLines,
	encodeBody,
	hunkResults,
	placeClean,
	logLine,
	measure,
	outsideEdited,
	paths,
	stage,
} from './collect.mjs';
import {
	RATCHETS,
	RUNTIME_BYTES,
	loadRules,
	mergeMain,
	protectedEntry,
	recordSummary,
	segmentsOf,
} from './merge.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const TMP = mkdtempSync(join(tmpdir(), 'merge-main-fixture-'));
const failures = [];
let passed = 0;
const check = (ok, message) => {
	if (ok) passed++;
	else failures.push(message);
};
const json = (v) => JSON.stringify(v);
const throws = (fn) => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};

// ── Scratch repositories ──────────────────────────────────────────────────────

const GIT_ENV = {
	PATH: process.env.PATH ?? '',
	HOME: TMP,
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_AUTHOR_NAME: 'fixture',
	GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
	GIT_COMMITTER_NAME: 'fixture',
	GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
	LANG: 'C',
};
function sh(cwd, ...args) {
	const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
}
let serial = 0;
const fresh = (name) => {
	const dir = join(TMP, `${String(++serial).padStart(3, '0')}-${name}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};
/** Write a side's files: text, a Buffer, `{ exec: text }`, or null to delete. */
function apply(dir, files) {
	for (const [path, v] of Object.entries(files)) {
		const file = join(dir, path);
		if (v === null) {
			rmSync(file, { force: true });
			continue;
		}
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, typeof v === 'object' && !Buffer.isBuffer(v) ? v.exec : v);
		chmodSync(file, typeof v === 'object' && !Buffer.isBuffer(v) ? 0o755 : 0o644);
	}
}
/**
 * A repository with a base commit, the change on its own branch and main moved on: each side's
 * `[commit subject, files]` in order. Answers its folder and the three commits.
 */
function scratch(name, { base, change = [], main = [] }) {
	const dir = fresh(name);
	sh(dir, 'init', '-q', '-b', 'main');
	apply(dir, base);
	sh(dir, 'add', '-A');
	sh(dir, 'commit', '-qm', 'base');
	const baseSha = sh(dir, 'rev-parse', 'HEAD');
	sh(dir, 'checkout', '-qb', 'change');
	for (const [subject, files] of change) {
		apply(dir, files);
		sh(dir, 'add', '-A');
		sh(dir, 'commit', '-qm', subject, '--allow-empty');
	}
	sh(dir, 'checkout', '-q', 'main');
	for (const [subject, files] of main) {
		apply(dir, files);
		sh(dir, 'add', '-A');
		sh(dir, 'commit', '-qm', subject, '--allow-empty');
	}
	return {
		dir,
		base: baseSha,
		head: sh(dir, 'rev-parse', 'change'),
		main: sh(dir, 'rev-parse', 'main'),
	};
}
/** Job merge on a clone checked out at the head: the record and its folder. */
function jobMerge(repo) {
	const jm = fresh('job-merge');
	sh(TMP, 'clone', '-q', repo.dir, jm);
	sh(jm, 'checkout', '-q', '--detach', repo.head);
	const out = join(fresh('artifact'), 'merge');
	const record = mergeMain({ repo: jm, head: repo.head, main: repo.main, out });
	return { record, out, jm };
}
/** Job propose's folders: the workspace (main), the pristine copy, the artifact in place. */
function propose(repo, artifact) {
	const rt = fresh('runner-temp');
	const ws = join(rt, 'ws');
	sh(TMP, 'clone', '-q', repo.dir, ws);
	sh(ws, 'checkout', '-q', '--detach', repo.main);
	const p = paths(rt, ws);
	cpSync(ws, p.main, { recursive: true });
	cpSync(artifact, p.record, { recursive: true });
	return { p, input: { mergeRun: '0123456789', head: repo.head, main: repo.main, budget: 6 } };
}
const read = (dir, path) => readFileSync(join(dir, path), 'utf8');
const pathOf = (record, path) => record.paths.find((x) => x.path === path);
const fileOf = (out, record, path) => read(out, pathOf(record, path).file);
const STREAM_OK =
	'{"type":"result","subtype":"success","modelUsage":{"claude-opus-5-5":{"inputTokens":120,"outputTokens":30,"cacheReadInputTokens":5,"cacheCreationInputTokens":7}}}\n';

// ── The lists the job reads, and the constants it keeps in step with ─────────

const rules = loadRules();
const changeSrc = read(ROOT, 'apps/launcher-api/src/lib/server/bugFixRunsChange.ts');
check(
	rules.paths.includes('scripts/bug-fix') && rules.names.includes('.github'),
	'protected lists read',
);
check(
	protectedEntry(rules, 'scripts/bug-fix/collect.mjs') === 'scripts/bug-fix' &&
		protectedEntry(rules, 'apps/launcher-api/src/lib/server/pipelineMerge.ts') ===
			"Invisible Pipeline Changes' server modules" &&
		protectedEntry(rules, 'apps/launcher-api/src/lib/server/githubApp.js') ===
			'apps/launcher-api/src/lib/server/githubapp.ts' &&
		protectedEntry(rules, 'services/x/Dockerfile') === 'a Dockerfile' &&
		protectedEntry(rules, 'packages/a/src/b.ts') === null,
	'protectedEntry reads bugFixRunsChange.ts as the launcher does (paths, names, rules, siblings)',
);
check(
	json(rules.locks) ===
		json(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'pnpm-workspace.yaml']),
	'LOCK_NAMES read',
);
const ratchetNames = /\nconst RATCHET_NAMES = \[([^\]]*)\];/
	.exec(changeSrc)?.[1]
	.match(/'[^']+'/g)
	?.map((s) => s.slice(1, -1));
check(
	json(Object.keys(RATCHETS).sort()) === json([...(ratchetNames ?? [])].sort()),
	'the ratchet rule covers bugFixRunsChange.ts RATCHET_NAMES',
);
check(
	read(ROOT, 'scripts/check-runtime-bytes.mjs').includes(
		"const MANIFEST_DIR = join(ROOT, 'scripts/runtime-bytes');",
	) && RUNTIME_BYTES.test('scripts/runtime-bytes/lines.json'),
	"the runtime-bytes rule's folder is check-runtime-bytes.mjs's",
);
const bundleCount = (
	read(ROOT, 'apps/launcher-api/scripts/check-vendored-bundles.mjs').match(/\{ name: '/g) ?? []
).length;
check(
	rules.bundles.size === bundleCount &&
		rules.bundles.get('apps/launcher-api/static/rigger/vendor/rigger-fx.js') === 'rigger-fx',
	'every vendored bundle read',
);
check(AUDIENCE === 'invisible-launcher-merge-main', "the OIDC audience is §10's");
check(
	read(ROOT, 'package.json').includes(
		'"check:merge-main": "node scripts/merge-main/merge-main.fixture.mjs"',
	),
	'check:merge-main is a root script',
);
{
	const bad = mkdtempSync(join(TMP, 'rules-'));
	mkdirSync(join(bad, 'apps/launcher-api/src/lib/server'), { recursive: true });
	mkdirSync(join(bad, 'apps/launcher-api/scripts'), { recursive: true });
	writeFileSync(
		join(bad, 'apps/launcher-api/src/lib/server/bugFixRunsChange.ts'),
		changeSrc.replace('const PROTECTED_PATHS = [', 'const PROTECTED_PATHS = [...OTHER, '),
	);
	writeFileSync(
		join(bad, 'apps/launcher-api/scripts/check-vendored-bundles.mjs'),
		read(ROOT, 'apps/launcher-api/scripts/check-vendored-bundles.mjs'),
	);
	let threw = false;
	try {
		loadRules(bad);
	} catch {
		threw = true;
	}
	check(threw, 'a protected list it cannot read stops the job rather than protect nothing');
}

// ── The rules ─────────────────────────────────────────────────────────────────

const STATUS = '# X — status\n\n## Recent changes\n\n- 2026-11-01 — old.\n';
const ENTRY = (who) => `- 2026-11-27 — ${who} entry.\n  More about it.\n`;
const withEntry = (who) => STATUS.replace('\n- 2026-11-01', `\n${ENTRY(who)}- 2026-11-01`);
const SHARED = '- 2026-11-27 — the same note, which both sides wrote word for word.\n';

{
	const repo = scratch('docs-append', {
		base: { 'docs/status/x.md': STATUS, 'docs/knowledge/lessons/a.md': STATUS },
		change: [
			[
				'docs: change',
				{
					'docs/status/x.md': withEntry('change'),
					'docs/knowledge/lessons/a.md': withEntry('change'),
				},
			],
		],
		main: [
			[
				'docs: main side (#1901)',
				{ 'docs/status/x.md': withEntry('main'), 'docs/knowledge/lessons/a.md': withEntry('main') },
			],
		],
	});
	const { record, out } = jobMerge(repo);
	const x = pathOf(record, 'docs/status/x.md');
	check(
		record.outcome === null &&
			x.status === 'mechanical' &&
			x.rule === 'docs-append' &&
			x.choice === 'both' &&
			fileOf(out, record, 'docs/status/x.md') ===
				STATUS.replace('\n- 2026-11-01', `\n${ENTRY('change')}${ENTRY('main')}- 2026-11-01`),
		'docs-append: both sides kept, this change above main',
	);
	check(
		pathOf(record, 'docs/knowledge/lessons/a.md').status === 'mechanical' && !record.model.length,
		'docs-append applies on a protected path (docs/knowledge)',
	);
	check(
		json(x.met) === json([{ pr: 1901, title: 'docs: main side' }]),
		'met: the commit on main it met, its (#n) read off',
	);
	check(
		record.checks.some((c) => c.command.startsWith('docs-append docs/status/x.md') && c.ok),
		'docs-append lists its check',
	);
	check(
		json(Object.keys(record).sort()) ===
			json([
				'baseSha',
				'checks',
				'headSha',
				'mainSha',
				'model',
				'outcome',
				'paths',
				'reason',
				'version',
			]),
		"the record's keys",
	);
	check(
		json(Object.keys(x).sort()) ===
			json([
				'choice',
				'conflicted',
				'file',
				'hunks',
				'kind',
				'lines',
				'markerSize',
				'met',
				'mode',
				'path',
				'pending',
				'rule',
				'sides',
				'status',
			]),
		"a record path's keys",
	);
	check(
		x.sides.base && x.sides.change && x.sides.main && x.markerSize === 7 && x.hunks[0].appendOnly,
		"a record path's sides, markers and hunks",
	);
}
{
	const twice = (name, shared) =>
		scratch(name, {
			base: { 'docs/status/x.md': STATUS },
			change: [
				[
					'docs: c',
					{
						'docs/status/x.md': STATUS.replace(
							'\n- 2026-11-01',
							`\n${shared}- change.\n- 2026-11-01`,
						),
					},
				],
			],
			main: [
				[
					'docs: m',
					{
						'docs/status/x.md': STATUS.replace(
							'\n- 2026-11-01',
							`\n- main.\n${shared}- 2026-11-01`,
						),
					},
				],
			],
		});
	const block = jobMerge(twice('docs-twice-block', `${SHARED}${SHARED.replace('note', 'line')}`));
	check(
		pathOf(block.record, 'docs/status/x.md').rule === null &&
			block.record.model.includes('docs/status/x.md'),
		"docs-append: a block both sides added would be written twice, so the file is the model's",
	);
	const line = twice('docs-twice-line', SHARED);
	const one = jobMerge(line);
	const lineJob = propose(line, one.out);
	stage(lineJob.p, lineJob.input);
	const lineBody = buildResult(lineJob.p, lineJob.input);
	check(
		pathOf(one.record, 'docs/status/x.md').rule === 'docs-append' &&
			lineBody.outcome === 'proposed' &&
			lineBody.explanation.risks.includes('which now appears twice'),
		'docs-append: one long line both sides added is kept, and the proposal names it as a risk',
	);
	const LONG = `${STATUS}\n## Open items\n\n- one.\n- two.\n- three.\n- four.\n`;
	const elsewhere = scratch('docs-append-elsewhere', {
		base: { 'docs/status/x.md': LONG },
		change: [
			[
				'docs: c',
				{
					'docs/status/x.md': withEntry('change')
						.concat(LONG.slice(STATUS.length))
						.replace('- three.', '- three, done.'),
				},
			],
		],
		main: [
			['docs: m', { 'docs/status/x.md': withEntry('main').concat(LONG.slice(STATUS.length)) }],
		],
	});
	const e = jobMerge(elsewhere);
	check(
		pathOf(e.record, 'docs/status/x.md').rule === 'docs-append' &&
			fileOf(e.out, e.record, 'docs/status/x.md').includes('- three, done.') &&
			fileOf(e.out, e.record, 'docs/status/x.md').includes(`${ENTRY('change')}${ENTRY('main')}`),
		'docs-append: a side that also edited a line elsewhere (git merged it) still appends',
	);
}
{
	const edit = scratch('docs-edit', {
		base: { 'docs/status/x.md': STATUS, 'docs/design/y.md': `${STATUS}\nend\n` },
		change: [
			[
				'docs',
				{
					'docs/status/x.md': STATUS.replace('old.', 'old, said one way.'),
					'docs/design/y.md': `${withEntry('change')}\nend, changed\n`,
				},
			],
		],
		main: [
			[
				'docs',
				{
					'docs/status/x.md': STATUS.replace('old.', 'old, said another.'),
					'docs/design/y.md': `${withEntry('main')}\nend, main\n`,
				},
			],
		],
	});
	const { record } = jobMerge(edit);
	check(
		pathOf(record, 'docs/status/x.md').status === 'conflict' &&
			pathOf(record, 'docs/status/x.md').rule === null &&
			pathOf(record, 'docs/design/y.md').status === 'conflict' &&
			pathOf(record, 'docs/design/y.md').hunks.length === 2 &&
			json(record.model) === json(['docs/design/y.md', 'docs/status/x.md']) &&
			record.outcome === null,
		"a docs hunk that edits lines is the model's, and a file with one goes whole",
	);
}

const MANIFEST = (id, n) => `{\n\t"runtime": "${id}",\n\t"files": {\n\t\t"a.js": ${n}\n\t}\n}\n`;
{
	const repo = scratch('runtime-bytes', {
		base: {
			'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1),
			'scripts/runtime-bytes/card.json': MANIFEST('card', 1),
		},
		change: [
			[
				'engine',
				{
					'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2),
					'scripts/runtime-bytes/card.json': MANIFEST('card', 2),
				},
			],
		],
		main: [
			[
				'engine',
				{
					'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3),
					'scripts/runtime-bytes/card.json': MANIFEST('card', 3),
				},
			],
		],
	});
	const { record, out } = jobMerge(repo);
	const lines = pathOf(record, 'scripts/runtime-bytes/lines.json');
	const card = pathOf(record, 'scripts/runtime-bytes/card.json');
	check(
		lines.status === 'mechanical' &&
			lines.rule === 'runtime-bytes' &&
			lines.choice === 'main' &&
			lines.pending === 'pnpm check:runtime-bytes --update --only lines' &&
			card.pending === 'pnpm check:runtime-bytes --update --only card' &&
			fileOf(out, record, 'scripts/runtime-bytes/lines.json') === MANIFEST('lines', 3),
		"runtime-bytes: main's, mechanical, pending with its own command; nothing re-recorded",
	);
	check(
		!record.outcome && !record.checks.length,
		'runtime-bytes: no command ran, so none is among the checks',
	);
}
{
	const bundle = 'apps/launcher-api/static/rigger/vendor/rigger-fx.js';
	const repo = scratch('vendored', {
		base: { [bundle]: 'var a=1;\n' },
		change: [['launcher', { [bundle]: 'var a=2;\n' }]],
		main: [['launcher', { [bundle]: 'var a=3;\n' }]],
	});
	const { record, out } = jobMerge(repo);
	const x = pathOf(record, bundle);
	check(
		x.rule === 'vendored-bundle' &&
			x.choice === 'main' &&
			x.pending === 'pnpm --filter launcher-api build:rigger-fx' &&
			fileOf(out, record, bundle) === 'var a=3;\n',
		"vendored-bundle: main's, pending pnpm --filter launcher-api build:<name>",
	);
}
const BASELINE = (a, b) =>
	`{\n\t"apps/a": { "errors": ${a} },\n\t"apps/b": { "errors": ${b} }\n}\n`;
{
	const repo = scratch('svelte-ratchet', {
		base: { 'svelte-check-baseline.json': BASELINE(3, 2) },
		change: [['fix', { 'svelte-check-baseline.json': BASELINE(1, 2) }]],
		main: [['fix', { 'svelte-check-baseline.json': BASELINE(3, 1) }]],
	});
	const checkCmd = 'pnpm check:svelte --only apps/a,apps/b';
	const { record, out } = jobMerge(repo);
	const x = pathOf(record, 'svelte-check-baseline.json');
	check(
		x.rule === 'ratchet' &&
			x.choice === 'main' &&
			x.pending === `${checkCmd} && ${checkCmd} --update` &&
			fileOf(out, record, 'svelte-check-baseline.json') === BASELINE(3, 1) &&
			!record.checks.length,
		"ratchet (svelte-check): main's, pending the check and update on the packages that differ",
	);
}
{
	const SUP = (n, m) =>
		`{\n  "a.ts": { "r": { "count": ${n} } },\n  "b.ts": { "r": { "count": ${m} } }\n}\n`;
	const repo = scratch('eslint-ratchet', {
		base: { 'eslint-suppressions.json': SUP(2, 2) },
		change: [['fix', { 'eslint-suppressions.json': SUP(1, 2) }]],
		main: [['fix', { 'eslint-suppressions.json': SUP(2, 1) }]],
	});
	const { record, out } = jobMerge(repo);
	check(
		pathOf(record, 'eslint-suppressions.json').pending === 'pnpm lint --prune-suppressions' &&
			fileOf(out, record, 'eslint-suppressions.json') === SUP(2, 1),
		"ratchet (eslint): main's, pending pnpm lint --prune-suppressions",
	);
	const broken = scratch('ratchet-not-json', {
		base: { 'eslint-suppressions.json': SUP(2, 2) },
		change: [['fix', { 'eslint-suppressions.json': SUP(1, 2).replace('{', '{,') }]],
		main: [['fix', { 'eslint-suppressions.json': SUP(2, 1) }]],
	});
	const b = jobMerge(broken).record;
	check(
		b.model.includes('eslint-suppressions.json') &&
			pathOf(b, 'eslint-suppressions.json').rule === null,
		'a rule that does not apply cleanly (a baseline that is not JSON) hands the file to the model',
	);
}
{
	const CODE = (x) => `export const a = ${x};\nexport const b = 1;\n`;
	const repo = scratch('pending', {
		base: { 'src/a.ts': CODE(1), 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1) },
		change: [
			['engine', { 'src/a.ts': CODE(2), 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2) }],
		],
		main: [
			['engine', { 'src/a.ts': CODE(3), 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3) }],
		],
	});
	const { record, out } = jobMerge(repo);
	const m = pathOf(record, 'scripts/runtime-bytes/lines.json');
	check(
		m.status === 'mechanical' &&
			m.choice === 'main' &&
			m.pending === 'pnpm check:runtime-bytes --update --only lines' &&
			fileOf(out, record, m.path) === MANIFEST('lines', 3) &&
			json(record.model) === json(['src/a.ts']),
		"a build rule beside code left for the model is main's and pending, as when nothing is left",
	);
}
{
	const repo = scratch('clean', {
		base: { 'src/c.ts': 'a\nb\nc\nd\ne\nf\n', 'src/same.ts': 'x\n' },
		change: [['c', { 'src/c.ts': 'A\nb\nc\nd\ne\nf\n', 'src/same.ts': 'y\n' }]],
		main: [
			['m', { 'src/c.ts': 'a\nb\nc\nd\ne\nF\n', 'src/same.ts': 'y\n', 'docs/status/x.md': STATUS }],
		],
	});
	const { record, out } = jobMerge(repo);
	const c = pathOf(record, 'src/c.ts');
	check(
		c.status === 'clean' &&
			c.choice === 'both' &&
			fileOf(out, record, 'src/c.ts') === 'A\nb\nc\nd\ne\nF\n',
		'a path both sides changed that git merges is clean, its merge recorded',
	);
	check(
		pathOf(record, 'src/same.ts').kind === 'identical' &&
			pathOf(record, 'src/same.ts').choice === 'main',
		"both sides making the same change is identical, main's",
	);
	check(
		record.outcome === 'needs_person' && record.reason.startsWith('Nothing conflicts path by path'),
		'nothing that conflicts: needs_person',
	);
	check(!pathOf(record, 'docs/status/x.md'), 'a path one side changed is not in the record');
}
{
	const repo = scratch('modify-delete', {
		base: { 'src/gone.ts': 'a\n', 'src/x.ts': '1\n' },
		change: [['c', { 'src/gone.ts': 'a, changed\n' }]],
		main: [['m', { 'src/gone.ts': null }]],
	});
	const { record } = jobMerge(repo);
	const g = pathOf(record, 'src/gone.ts');
	check(
		g.kind === 'modify/delete' &&
			g.status === 'conflict' &&
			g.hunks.length === 1 &&
			record.model.includes('src/gone.ts'),
		"modify/delete: the model's, as one hunk, holding the side that kept it",
	);
}

// ── The refusals ──────────────────────────────────────────────────────────────

const conflictOn = (path, extra = {}) =>
	scratch(`refuse-${path.replace(/\W+/g, '-')}`, {
		base: { [path]: 'one\n', ...extra.base },
		change: [['c', { [path]: 'one, change\n', ...extra.change }]],
		main: [['m', { [path]: 'one, main\n', ...extra.main }]],
	});
for (const path of ['.github/workflows/lint.yml', 'scripts/current-games/run.mjs']) {
	const { record } = jobMerge(
		conflictOn(path, {
			base: { 'svelte-check-baseline.json': BASELINE(1, 1) },
			change: { 'svelte-check-baseline.json': BASELINE(0, 1) },
			main: { 'svelte-check-baseline.json': BASELINE(1, 0) },
		}),
	);
	check(
		record.outcome === 'harness_conflict' && record.reason.includes(path),
		`harness_conflict: ${path}`,
	);
}
{
	const lock = jobMerge(conflictOn('pnpm-lock.yaml')).record;
	check(
		lock.outcome === 'needs_person' && lock.reason.includes('pnpm-lock.yaml: a lockfile'),
		'needs_person: the lockfile',
	);
	const migrations = scratch('migrations', {
		base: { 'apps/launcher-api/drizzle/0049_a.sql': 'a;\n', 'src/x.ts': '1\n' },
		change: [['c', { 'apps/launcher-api/drizzle/0050_mine.sql': 'b;\n', 'src/x.ts': '2\n' }]],
		main: [['m', { 'apps/launcher-api/drizzle/0050_theirs.sql': 'c;\n', 'src/x.ts': '3\n' }]],
	});
	const m = jobMerge(migrations).record;
	check(
		m.outcome === 'needs_person' &&
			m.reason.includes('0050_mine.sql') &&
			m.reason.includes('0050_theirs.sql'),
		'needs_person: a migration number both sides used, naming both',
	);
	const same = scratch('migrations-same', {
		base: { 'src/x.ts': '1\n' },
		change: [['c', { 'apps/launcher-api/drizzle/0050_one.sql': 'b;\n', 'src/x.ts': '2\n' }]],
		main: [['m', { 'apps/launcher-api/drizzle/0050_one.sql': 'b;\n', 'src/x.ts': '3\n' }]],
	});
	check(
		!/migration/.test(jobMerge(same).record.reason ?? ''),
		'the same migration on both sides is no collision',
	);
	const binary = jobMerge(
		scratch('binary', {
			base: { 'art/a.png': Buffer.from([0x89, 0x50, 0, 1]) },
			change: [['c', { 'art/a.png': Buffer.from([0x89, 0x50, 0, 2]) }]],
			main: [['m', { 'art/a.png': Buffer.from([0x89, 0x50, 0, 3]) }]],
		}),
	).record;
	check(
		binary.outcome === 'needs_person' && binary.reason.includes('art/a.png: a binary file'),
		'needs_person: a binary, naming it',
	);
	const clash = jobMerge(
		scratch('folder-clash', {
			base: { 'src/x.ts': '1\n' },
			change: [['c', { 'src/thing/a.ts': 'a\n', 'src/x.ts': '2\n' }]],
			main: [['m', { 'src/thing': 'file\n', 'src/x.ts': '3\n' }]],
		}),
	).record;
	check(
		clash.outcome === 'needs_person' &&
			clash.reason.includes('src/thing: a file where the other side has a folder'),
		'needs_person: a file and a folder at one path',
	);
}
{
	const guarded = jobMerge(conflictOn('scripts/bug-fix/collect.mjs')).record;
	check(
		guarded.outcome === 'protected_conflict' &&
			guarded.reason.includes('protected (scripts/bug-fix)'),
		'protected_conflict: a protected path left for the model',
	);
	const sibling = jobMerge(conflictOn('apps/launcher-api/src/lib/server/pipelineThing.js')).record;
	check(
		sibling.outcome === 'protected_conflict',
		'protected_conflict: a source file beside a protected .ts',
	);
}
{
	const many = {};
	for (let i = 0; i < 11; i++) many[`src/f${i}.ts`] = i;
	const repo = scratch('too-many', {
		base: Object.fromEntries(Object.keys(many).map((p) => [p, 'one\n'])),
		change: [['c', Object.fromEntries(Object.keys(many).map((p) => [p, 'one, change\n']))]],
		main: [['m', Object.fromEntries(Object.keys(many).map((p) => [p, 'one, main\n']))]],
	});
	const r = jobMerge(repo).record;
	check(
		r.outcome === 'too_large' && r.reason.includes('more than 10 files left for the model'),
		'too_large: more than 10 files for the model',
	);
	const long = (who) => Array.from({ length: 301 }, (_, i) => `${who} ${i}\n`).join('');
	const lines = jobMerge(
		scratch('too-long', {
			base: { 'src/a.ts': 'x\n' },
			change: [['c', { 'src/a.ts': long('c') }]],
			main: [['m', { 'src/a.ts': long('m') }]],
		}),
	).record;
	check(
		lines.outcome === 'too_large' && lines.reason.includes('past 600'),
		'too_large: more than 600 conflicting lines',
	);
	const ten = jobMerge(
		scratch('ten', {
			base: Object.fromEntries(
				Object.keys(many)
					.slice(0, 10)
					.map((p) => [p, 'one\n']),
			),
			change: [
				[
					'c',
					Object.fromEntries(
						Object.keys(many)
							.slice(0, 10)
							.map((p) => [p, 'one, change\n']),
					),
				],
			],
			main: [
				[
					'm',
					Object.fromEntries(
						Object.keys(many)
							.slice(0, 10)
							.map((p) => [p, 'one, main\n']),
					),
				],
			],
		}),
	).record;
	check(ten.outcome === null && ten.model.length === 10, 'ten files for the model are allowed');
}
{
	const order = jobMerge(
		scratch('order', {
			base: {
				'.github/workflows/a.yml': 'a\n',
				'pnpm-lock.yaml': 'a\n',
				'scripts/bug-fix/x.mjs': 'a\n',
			},
			change: [
				[
					'c',
					{
						'.github/workflows/a.yml': 'b\n',
						'pnpm-lock.yaml': 'b\n',
						'scripts/bug-fix/x.mjs': 'b\n',
					},
				],
			],
			main: [
				[
					'm',
					{
						'.github/workflows/a.yml': 'c\n',
						'pnpm-lock.yaml': 'c\n',
						'scripts/bug-fix/x.mjs': 'c\n',
					},
				],
			],
		}),
	).record;
	check(
		order.outcome === 'harness_conflict',
		'the most binding refusal wins: harness over needs_person over protected',
	);
}
{
	const shownSummary = recordSummary({
		headSha: 'a'.repeat(40),
		mainSha: 'b'.repeat(40),
		outcome: null,
		model: ['x'],
		paths: [
			{ path: 'docs/é.md', conflicted: true, status: 'conflict', rule: null },
			{ path: 'docs/a.md', conflicted: true, status: 'mechanical', rule: 'docs-append' },
		],
	});
	check(
		/^[\x20-\x7e\n]*$/.test(shownSummary) &&
			shownSummary.includes('a path outside printable ASCII') &&
			shownSummary.includes('docs/a.md'),
		"the merge job's log line: printable ASCII paths only",
	);
}

// ── collect: the §10 body ─────────────────────────────────────────────────────

const OUTCOMES = [
	'proposed',
	'needs_person',
	'harness_conflict',
	'protected_conflict',
	'too_large',
	'no_proposal',
];
const CHOICES = ['main', 'change', 'both', 'combined'];
const RULES = ['runtime-bytes', 'vendored-bundle', 'docs-append', 'ratchet'];
const keysAre = (o, keys) =>
	o && typeof o === 'object' && json(Object.keys(o).sort()) === json([...keys].sort());
const text = (v, cap = TEXT_CAP) => typeof v === 'string' && Array.from(v).length <= cap;
/** What §10 says a body is; the problems, or []. */
function shapeProblems(body) {
	const out = [];
	const head = [
		'mergeRun',
		'headSha',
		'mainSha',
		'baseSha',
		'reason',
		'files',
		'explanation',
		'usage',
	];
	const failed = 'failure' in body;
	if (!keysAre(body, [...head, failed ? 'failure' : 'outcome']))
		out.push(`keys ${json(Object.keys(body))}`);
	if (!/^[0-9a-f]{10}$/.test(body.mergeRun)) out.push('mergeRun');
	for (const k of ['headSha', 'mainSha']) if (!/^[0-9a-f]{40}$/.test(body[k])) out.push(k);
	if (body.baseSha !== null && !/^[0-9a-f]{40}$/.test(body.baseSha)) out.push('baseSha');
	if (!Array.isArray(body.usage)) out.push('usage');
	if (failed) {
		if (
			!text(body.failure) ||
			!body.failure ||
			body.reason !== null ||
			body.files.length ||
			body.explanation !== null
		)
			out.push('failure');
		return out;
	}
	if (!OUTCOMES.includes(body.outcome)) out.push('outcome');
	if (body.outcome !== 'proposed') {
		if (!text(body.reason) || !body.reason || body.files.length || body.explanation !== null)
			out.push('refusal');
		return out;
	}
	if (body.reason !== null) out.push('reason');
	let total = 0;
	for (const f of body.files) {
		if (!keysAre(f, ['path', 'choice', 'rule', 'content', 'mode'])) out.push(`file keys ${f.path}`);
		if (!CHOICES.includes(f.choice) || !(f.rule === null || RULES.includes(f.rule)))
			out.push(`file choice/rule ${f.path}`);
		if (
			!(f.content === null || typeof f.content === 'string') ||
			!['100644', '100755'].includes(f.mode)
		)
			out.push(`file content/mode ${f.path}`);
		total += f.content ? Buffer.byteLength(f.content) : 0;
	}
	if (total > 4 * 1024 * 1024) out.push('files over 4 MB');
	const e = body.explanation;
	if (!keysAre(e, ['conflicted', 'hunks', 'outside', 'checks', 'risks']))
		return [...out, 'explanation keys'];
	for (const c of e.conflicted) {
		if (
			!keysAre(c, ['path', 'met']) ||
			!c.met.every(
				(m) =>
					keysAre(m, ['pr', 'title']) && (m.pr === null || Number.isInteger(m.pr)) && text(m.title),
			)
		)
			out.push(`conflicted ${c.path}`);
	}
	for (const h of e.hunks) {
		const ok =
			keysAre(h, [
				'path',
				'index',
				'main',
				'change',
				'result',
				'resultCut',
				'kind',
				'takes',
				'why',
				'nowDoes',
				'otherwise',
			]) &&
			['lines', 'description'].includes(h.kind) &&
			Number.isInteger(h.index) &&
			TAKES.includes(h.takes) &&
			[h.main, h.change].every((t) => text(t, LINES_CAP) && t) &&
			(h.result === null || text(h.result, LINES_CAP)) &&
			Number.isInteger(h.resultCut) &&
			h.resultCut >= 0 &&
			(h.result !== null || h.resultCut === 0) &&
			text(h.why) &&
			h.why &&
			(h.nowDoes === null ? h.takes !== 'combined' : text(h.nowDoes)) &&
			(h.otherwise === null || text(h.otherwise));
		if (!ok) out.push(`hunk ${h.path}#${h.index}`);
	}
	if (!e.outside.every((o) => keysAre(o, ['path', 'what']) && text(o.what) && o.what))
		out.push('outside');
	if (
		!e.checks.length ||
		!e.checks.every(
			(c) => keysAre(c, ['command', 'ok']) && text(c.command) && typeof c.ok === 'boolean',
		)
	)
		out.push('checks');
	if (!text(e.risks) || !e.risks) out.push('risks');
	const prose = {
		...e,
		hunks: e.hunks.map((h) => [h.path, h.index, h.takes, h.why, h.nowDoes, h.otherwise]),
	};
	if (measure(prose) > EXPLANATION_CAP) out.push('explanation over 16,000');
	const lines = e.hunks.reduce((n, h) => n + measure([h.main, h.change, h.result ?? '']), 0);
	if (lines > LINES_TOTAL_CAP) out.push('hunk lines over their cap');
	return out;
}

const CODE2 = (x, y) => `// a\nexport const a = ${x};\n// b\n// c\n// d\nexport const b = ${y};\n`;
const SIDES = {
	base: {
		'src/a.ts': CODE2(1, 1),
		'src/c.ts': 'a\nb\nc\nd\ne\nf\n',
		'docs/status/x.md': STATUS,
		'src/main-only.ts': 'old\n',
		'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1),
		'svelte-check-baseline.json': BASELINE(3, 2),
	},
	change: [
		[
			'feat: the change',
			{
				'src/a.ts': CODE2(2, 2),
				'src/c.ts': 'A\nb\nc\nd\ne\nf\n',
				'docs/status/x.md': withEntry('change'),
				'src/head-only.ts': 'mine\n',
				'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2),
				'svelte-check-baseline.json': BASELINE(1, 2),
			},
		],
	],
	main: [
		['engine: a on main (#1924)', { 'src/a.ts': CODE2(3, 1), 'src/c.ts': 'a\nb\nc\nd\ne\nF\n' }],
		[
			'engine: b on main (#1926)',
			{
				'src/a.ts': CODE2(3, 3),
				'docs/status/x.md': withEntry('main'),
				'src/main-only.ts': null,
				'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3),
				'svelte-check-baseline.json': BASELINE(3, 1),
			},
		],
	],
};
const mixed = scratch('collect', SIDES);
const mixedMerge = jobMerge(mixed);
/** A fresh propose job for the mixed case, staged. */
function staged(budget = 6) {
	const job = propose(mixed, mixedMerge.out);
	job.input.budget = budget;
	const { model } = stage(job.p, job.input);
	return { ...job, model };
}
/** The model's work: resolve src/a.ts (both hunks), write its result and the CLI's stream. */
const RESOLVED = CODE2(23, 23);
const goodResult = () => ({
	hunks: [0, 1].map((index) => ({
		path: 'src/a.ts',
		index,
		main: "main's value",
		change: "this change's value",
		takes: 'combined',
		why: 'Both wanted a new value.',
		nowDoes: 'It is 23.',
		otherwise: null,
	})),
	outside: [],
	checks: [{ command: 'pnpm check:thing', ok: true }],
	risks: 'none found',
});
function model(
	job,
	{ files = { 'src/a.ts': RESOLVED }, result = goodResult(), stream = STREAM_OK } = {},
) {
	apply(job.p.workspace, files);
	mkdirSync(job.p.out, { recursive: true });
	if (result !== null)
		writeFileSync(
			join(job.p.out, 'result.json'),
			typeof result === 'string' ? result : json(result),
		);
	mkdirSync(job.p.claude, { recursive: true });
	if (stream !== null) writeFileSync(join(job.p.claude, 'stream.jsonl'), stream);
	return buildResult(job.p, job.input, 'sk-ant-fixture-key-0123456789');
}

{
	const job = staged();
	const ws = job.p.workspace;
	const conflicts = JSON.parse(read(job.p.conflicts, 'conflicts.json'));
	check(
		job.model === true,
		'stage: the model runs when files are left for it and the budget allows',
	);
	check(
		read(ws, 'src/head-only.ts') === 'mine\n' && !existsSync(join(ws, 'src/main-only.ts')),
		"stage: the workspace is the merged tree (the change's own files in, main's deletion kept)",
	);
	check(
		read(ws, 'src/a.ts').includes('<<<<<<< this change') &&
			read(ws, 'src/a.ts').includes('||||||| base') &&
			read(ws, 'src/a.ts').includes('>>>>>>> main'),
		'stage: a conflict for the model holds its markers',
	);
	check(
		read(ws, 'docs/status/x.md') ===
			STATUS.replace('\n- 2026-11-01', `\n${ENTRY('change')}${ENTRY('main')}- 2026-11-01`),
		'stage: what a rule cleared is in place',
	);
	check(
		read(ws, 'scripts/runtime-bytes/lines.json') === MANIFEST('lines', 3),
		"stage: a pending file holds main's",
	);
	check(
		json(conflicts.files.map((f) => [f.path, f.hunks.length])) === json([['src/a.ts', 2]]) &&
			json(conflicts.pending.map((x) => x.command)) ===
				json([
					'pnpm check:runtime-bytes --update --only lines',
					'pnpm check:svelte --only apps/a,apps/b && pnpm check:svelte --only apps/a,apps/b --update',
				]) &&
			conflicts.files[0].met.map((m) => m.pr).join() === '1926,1924',
		`stage: conflicts.json names the model's files, their hunks, what main met and the pending rules (${json(conflicts)})`,
	);
	const body = model(job);
	check(
		!shapeProblems(body).length && body.outcome === 'proposed',
		`result: a resolution is §10's body (${json(shapeProblems(body))})`,
	);
	const file = (path) => body.files.find((f) => f.path === path);
	check(
		json(body.files.map((f) => f.path)) ===
			json([
				'docs/status/x.md',
				'scripts/runtime-bytes/lines.json',
				'src/a.ts',
				'src/c.ts',
				'svelte-check-baseline.json',
			]),
		'result: files holds exactly the paths both sides changed',
	);
	check(
		file('src/a.ts').content === RESOLVED &&
			file('src/a.ts').choice === 'combined' &&
			file('src/c.ts').choice === 'both' &&
			file('docs/status/x.md').rule === 'docs-append' &&
			file('scripts/runtime-bytes/lines.json').choice === 'main',
		"result: each file's content and choice",
	);
	const e = body.explanation;
	check(
		json(e.conflicted.map((c) => c.path)) ===
			json([
				'docs/status/x.md',
				'scripts/runtime-bytes/lines.json',
				'src/a.ts',
				'svelte-check-baseline.json',
			]) &&
			json(e.conflicted.find((c) => c.path === 'src/a.ts').met) ===
				json([
					{ pr: 1926, title: 'engine: b on main' },
					{ pr: 1924, title: 'engine: a on main' },
				]),
		"result: what conflicted, and the changes on main it met, from main's git",
	);
	check(
		e.hunks.filter((h) => h.path === 'src/a.ts').length === 2 &&
			e.hunks.some((h) => h.path === 'docs/status/x.md' && h.takes === 'both'),
		"result: the model's hunks and the rules' together",
	);
	check(
		e.risks.includes("scripts/runtime-bytes/lines.json is main's") &&
			e.risks.includes('click **Re-record runtime bytes** on the change') &&
			e.risks.includes(
				"lower the baseline in the change's session if `check:svelte` or lint fails",
			),
		'result: what follows Accept for each pending build is a risk, in plain words',
	);
	check(
		json(body.usage) ===
			json([
				{
					model: 'claude-opus-5-5',
					inputTokens: 120,
					outputTokens: 30,
					cacheReadTokens: 5,
					cacheWriteTokens: 7,
				},
			]),
		"result: usage as a fix run's",
	);
}
check(
	(() => {
		const body = model(staged(), {
			files: { 'src/a.ts': RESOLVED, 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 99) },
		});
		return (
			body.outcome === 'no_proposal' && body.reason.includes('which is not one of the files left')
		);
	})(),
	"guard: the run may not rebuild a pending file: it stays main's, a person or CI follows up",
);
const refusedWith = (body, words) =>
	body.outcome === 'no_proposal' && body.reason.includes(words) && !shapeProblems(body).length;
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': RESOLVED, 'src/c.ts': 'edited\n' } }),
		'src/c.ts, which is not one of the files left for it',
	),
	'guard: a file git merged cleanly',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': RESOLVED, 'src/head-only.ts': 'edited\n' } }),
		'src/head-only.ts',
	),
	'guard: a file only one side changed',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': RESOLVED, 'src/new.ts': 'new\n' } }),
		'src/new.ts',
	),
	'guard: a new file',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': RESOLVED, 'src/main-only.ts': 'back\n' } }),
		'src/main-only.ts',
	),
	'guard: a file main deleted, brought back',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': RESOLVED, 'docs/status/x.md': 'mine\n' } }),
		'docs/status/x.md',
	),
	'guard: a file a rule cleared',
);
{
	const outside = RESOLVED.replace('// c', '// c, edited');
	check(
		refusedWith(
			model(staged(), { files: { 'src/a.ts': outside } }),
			'outside its conflicts and did not list it',
		),
		'guard: an edit outside a hunk, unlisted',
	);
	const listed = model(staged(), {
		files: { 'src/a.ts': outside },
		result: {
			...goodResult(),
			outside: [{ path: 'src/a.ts', what: 'A comment between the hunks.' }],
		},
	});
	check(
		listed.outcome === 'proposed' &&
			json(listed.explanation.outside) ===
				json([{ path: 'src/a.ts', what: 'A comment between the hunks.' }]),
		'guard: an edit outside a hunk, listed, is allowed and shown',
	);
}
{
	const lying = model(staged(), {
		result: {
			...goodResult(),
			hunks: goodResult().hunks.map((h) => ({
				...h,
				main: 'MODEL-MADE-UP MAIN',
				change: 'MODEL-MADE-UP CHANGE',
			})),
		},
	});
	const [h0, h1] = lying.explanation.hunks.filter((h) => h.path === 'src/a.ts');
	const docs = lying.explanation.hunks.find((h) => h.path === 'docs/status/x.md');
	check(
		lying.outcome === 'proposed' &&
			h0.main === 'export const a = 3;' &&
			h0.change === 'export const a = 2;' &&
			h1.change === 'export const b = 2;' &&
			h1.main === 'export const b = 3;' &&
			docs.main.includes('main entry') &&
			docs.change.includes('change entry') &&
			!JSON.stringify(lying.explanation).includes('MODEL-MADE-UP'),
		"proposal: a hunk's main and change are the sides' real lines from git, not the model's words",
	);
}
// Where git's clean pieces lie is one reading or none (`placeClean`, shared by outsideEdited and hunkResults)
{
	const seg = (A, P, Z) => [
		{ clean: A },
		{ hunk: { change: 'c1\n', base: 'b\n', main: 'm1\n' } },
		{ clean: P },
		{ hunk: { change: 'c2\n', base: 'b\n', main: 'm2\n' } },
		{ clean: Z },
	];
	// a lone "}" between the hunks that hunk 1's resolution also holds: two readings, so not guessed
	const s1 = seg('function a() {\n', '}\n', 'end\n');
	const f1 = 'function a() {\n\tif (x) {\n\t\ty();\n}\n\tz();\n}\nR2\nend\n';
	check(
		placeClean(s1, f1)?.ambiguous === true &&
			outsideEdited(s1, f1) === false &&
			hunkResults(s1, f1) === null,
		'placeClean: a clean piece the resolution also holds has two places → NOT an outside edit (the model could not know), and no result (never cut short and shown under the wrong hunk)',
	);
	// the same file with the piece in one place only
	const f1b = 'function a() {\n\tif (x) {\n\t\ty();\n\tz();\n}\nR2\nend\n';
	check(
		placeClean(s1, f1b)?.ambiguous === false &&
			outsideEdited(s1, f1b) === false &&
			json(hunkResults(s1, f1b)) === json(['\tif (x) {\n\t\ty();\n\tz();\n', 'R2\n']),
		'placeClean: a piece in one place gives both hunks their own lines',
	);
	const s2 = seg('head\n', '\tcheck(token);\n\treturn ok;\n', 'tail\n');
	// a copy of a clean piece next to the real one: two places, so the file is not trusted
	const copy2 =
		'head\nR1\n\tcheck(token);\n\treturn ok;\nR1b\n\tcheck(token);\n\treturn ok;\nR2\ntail\n';
	check(
		placeClean(s2, copy2)?.ambiguous === true &&
			outsideEdited(s2, copy2) === false &&
			hunkResults(s2, copy2) === null,
		'placeClean: a clean piece that is in the file twice has two places → no result: the card never shows text that differs from the file',
	);
	check(
		outsideEdited(s2, 'head\nR1\n\tcheck(token);\n\treturn ok;\nR2\ntail\n') === false &&
			outsideEdited(s2, 'head\nR1\n\tcheck(token);\n\treturn true;\nR2\ntail\n') === true,
		'outsideEdited: the clean piece intact is not an edit; rewritten is',
	);
}

// git's own --diff3 output: two hunks separated by one `\t}`, a resolution that wraps hunk 2 in its own braces
{
	const code = (x, y) => `function f() {\n\tx(${x});\n\t}\n\ty(${y});\n}\n`;
	const job = scratch('ambig', {
		base: { 'src/w.ts': code(1, 1) },
		change: [['c', { 'src/w.ts': code(2, 2) }]],
		main: [['m', { 'src/w.ts': code(3, 3) }]],
	});
	const j = propose(job, jobMerge(job).out);
	j.input.budget = 6;
	stage(j.p, j.input);
	const merged = readFileSync(join(j.p.workspace, 'src/w.ts'), 'utf8');
	const segs = segmentsOf(merged, 7);
	const wrapped = 'function f() {\n\tx(23);\n\t}\n\tif (c) {\n\t\ty(23);\n\t}\n}\n';
	check(
		segs.filter((x) => x.hunk).length === 2 &&
			json(segs.filter((x) => x.clean !== undefined).map((x) => x.clean)) ===
				json(['function f() {\n', '\t}\n', '}\n']),
		'ambig: git really leaves two hunks with one `\\t}` between them',
	);
	check(
		placeClean(segs, wrapped)?.ambiguous === true &&
			outsideEdited(segs, wrapped) === false &&
			hunkResults(segs, wrapped) === null,
		'ambig: the wrapped resolution has two places for the `\\t}` piece, is not an outside edit and gets no result',
	);
	apply(j.p.workspace, { 'src/w.ts': wrapped });
	mkdirSync(j.p.out, { recursive: true });
	const hunk = (index) => ({
		path: 'src/w.ts',
		index,
		takes: 'combined',
		why: 'Both.',
		nowDoes: `It is 23 (${index}).`,
		otherwise: null,
	});
	writeFileSync(
		join(j.p.out, 'result.json'),
		json({
			hunks: [hunk(0), hunk(1)],
			outside: [],
			checks: [{ command: 'pnpm check:thing', ok: true }],
			risks: 'none',
		}),
	);
	mkdirSync(j.p.claude, { recursive: true });
	writeFileSync(join(j.p.claude, 'stream.jsonl'), STREAM_OK);
	const body = buildResult(j.p, j.input, 'sk-ant-fixture-key-0123456789');
	const hs = body.explanation?.hunks.filter((h) => h.path === 'src/w.ts');
	check(
		body.outcome === 'proposed' &&
			hs.length === 2 &&
			hs.every((h) => h.kind === 'lines' && h.result === null && h.resultCut === 0) &&
			hs[0].main === '\tx(3);' &&
			hs[1].change === '\ty(2);',
		'ambig: an honest wrapped resolution is PROPOSED (not "changed outside its conflicts"), its sides real and its results "not located"',
	);
}
{
	// a result past the cap is cut, and says by how many lines: a long result made of lines the sides hold
	const fill = (tag) =>
		Array.from({ length: 250 }, (_, i) => `${tag}${i}`.padEnd(39, '.') + '\n').join('');
	const long = (x) => `${fill('c')}${fill('m')}v = ${x};\n`;
	const job = scratch('cut', {
		base: { 'src/c.ts': 'head\nv = 1;\ntail\n' },
		change: [['c', { 'src/c.ts': `head\n${fill('c')}v = 2;\ntail\n` }]],
		main: [['m', { 'src/c.ts': `head\n${fill('m')}v = 3;\ntail\n` }]],
	});
	const j = propose(job, jobMerge(job).out);
	j.input.budget = 6;
	stage(j.p, j.input);
	apply(j.p.workspace, { 'src/c.ts': `head\n${long(23)}tail\n` });
	mkdirSync(j.p.out, { recursive: true });
	writeFileSync(
		join(j.p.out, 'result.json'),
		json({
			hunks: [
				{
					path: 'src/c.ts',
					index: 0,
					takes: 'combined',
					why: 'Both.',
					nowDoes: 'x',
					otherwise: null,
				},
			],
			outside: [],
			checks: [{ command: 'pnpm check:thing', ok: true }],
			risks: 'none',
		}),
	);
	mkdirSync(j.p.claude, { recursive: true });
	writeFileSync(join(j.p.claude, 'stream.jsonl'), STREAM_OK);
	const body = buildResult(j.p, j.input, 'sk-ant-fixture-key-0123456789');
	const h = body.explanation?.hunks[0];
	check(
		body.outcome === 'proposed' &&
			h.result.endsWith('…') &&
			Array.from(h.result).length === LINES_CAP &&
			h.resultCut > 200 &&
			h.resultCut < 300,
		`result: a result past the cap is cut with a trailing … and resultCut counts the lines not shown (${h?.resultCut} ${body.reason})`,
	);
}
// the hunk's real lines and its result, from git and the final file (§10)
{
	const tabs = (x) =>
		`function f() {\n\tif (a) {\n\t\tconst v = ${x};\n\t\treturn v;\n\t}\n\treturn 0;\n}\n`;
	const gitText = '\t\tconst v = 2;\n\t\treturn v;\n';
	check(
		cleanLines(gitText) === '\t\tconst v = 2;\n\t\treturn v;' &&
			cleanLines('a\r\nb\n') === 'a\nb' &&
			cleanLines('‮x\u0007y') === 'xy' &&
			cleanLines('a\rb') === 'a\rb' &&
			Array.from(cleanLines('z'.repeat(LINES_CAP + 5))).length === LINES_CAP,
		'cleanLines: indentation kept, only the last line break dropped, hidden and control characters gone, capped',
	);
	// hunkResults: the text between git's clean pieces, whatever the hunk text repeats elsewhere
	const segs = [
		{ clean: '}\nfoo\n}\n' },
		{ hunk: { change: '}\nconst a = 2;\n', base: '', main: '}\nconst a = 3;\n' } },
		{ clean: 'tail\n' },
	];
	check(
		json(hunkResults(segs, '}\nfoo\n}\nconst a = 5;\ntail\n')) === json(['const a = 5;\n']) &&
			hunkResults(segs, 'gone\n') === null &&
			json(hunkResults([{ clean: 'a\n' }, { hunk: {} }, { clean: 'b\n' }], 'a\nb\n')) ===
				json(['']),
		'hunkResults: the text between the clean pieces around a hunk (a repeated "}" does not mislead it); null when they are not there; empty when the hunk was resolved to nothing',
	);
	const job = scratch('tabs', {
		base: { 'src/t.ts': tabs(1), 'docs/status/x.md': STATUS },
		change: [['change', { 'src/t.ts': tabs(2), 'docs/status/x.md': withEntry('change') }]],
		main: [['main', { 'src/t.ts': tabs(3), 'docs/status/x.md': withEntry('main') }]],
	});
	const m = jobMerge(job);
	const j = propose(job, m.out);
	j.input.budget = 6;
	const { model: ran } = stage(j.p, j.input);
	const out = (body) => body.explanation.hunks.find((h) => h.path === 'src/t.ts');
	apply(j.p.workspace, { 'src/t.ts': tabs('2 + 3') });
	mkdirSync(j.p.out, { recursive: true });
	writeFileSync(
		join(j.p.out, 'result.json'),
		json({
			hunks: [
				{
					path: 'src/t.ts',
					index: 0,
					main: 'LIE',
					change: 'LIE',
					result: 'LIE',
					takes: 'combined',
					why: 'Both.',
					nowDoes: 'Adds them.',
					otherwise: null,
				},
			],
			outside: [],
			checks: [{ command: 'pnpm check:thing', ok: true }],
			risks: 'none',
		}),
	);
	mkdirSync(j.p.claude, { recursive: true });
	writeFileSync(join(j.p.claude, 'stream.jsonl'), STREAM_OK);
	const body = buildResult(j.p, j.input, 'sk-ant-fixture-key-0123456789');
	const h = body.explanation?.hunks && out(body);
	check(
		ran === true &&
			body.outcome === 'proposed' &&
			h.change === '\t\tconst v = 2;' &&
			h.main === '\t\tconst v = 3;' &&
			h.result === '\t\tconst v = 2 + 3;' &&
			!JSON.stringify(body.explanation).includes('LIE'),
		'result: a tab-indented hunk keeps its indentation on both sides, and its result is the final file’s own line (never the model’s)',
	);
	const docs = body.explanation.hunks.find((x) => x.path === 'docs/status/x.md');
	check(
		docs.result === null && docs.main.includes('main entry'),
		'result: a rule hunk keeps its old wording (no result), with real sides',
	);
	check(
		json(Object.keys(h).sort()) ===
			json([
				'change',
				'index',
				'kind',
				'main',
				'nowDoes',
				'otherwise',
				'path',
				'result',
				'resultCut',
				'takes',
				'why',
			]),
		'result: a hunk carries exactly the §10 fields, result included',
	);
}
{
	// a modify/delete has no lines to find: its hunk keeps the description and no result
	const job = scratch('gone', {
		base: { 'src/gone.ts': 'a\n' },
		change: [['c', { 'src/gone.ts': 'a, changed\n' }]],
		main: [['m', { 'src/gone.ts': null }]],
	});
	const j = propose(job, jobMerge(job).out);
	j.input.budget = 6;
	stage(j.p, j.input);
	apply(j.p.workspace, { 'src/gone.ts': 'a, changed\n' });
	mkdirSync(j.p.out, { recursive: true });
	writeFileSync(
		join(j.p.out, 'result.json'),
		json({
			hunks: [
				{
					path: 'src/gone.ts',
					index: 0,
					takes: 'change',
					why: 'Keep it.',
					nowDoes: null,
					otherwise: null,
				},
			],
			outside: [],
			checks: [{ command: 'pnpm check:thing', ok: true }],
			risks: 'none',
		}),
	);
	mkdirSync(j.p.claude, { recursive: true });
	writeFileSync(join(j.p.claude, 'stream.jsonl'), STREAM_OK);
	const body = buildResult(j.p, j.input, 'sk-ant-fixture-key-0123456789');
	const h = body.explanation?.hunks[0];
	check(
		body.outcome === 'proposed' &&
			h.result === null &&
			h.change === 'Keeps the file, changed.' &&
			h.main === 'Deletes the file.',
		'result: a modify/delete hunk keeps its description and has no result',
	);
}
{
	// a file over 200 KB: the hunk's result is still its own lines, within the cap, not cut by the page
	const big = (x) =>
		`${'filler line\n'.repeat(20_000)}const a = ${x};\n${'more filler\n'.repeat(20_000)}`;
	const job = scratch('big', {
		base: { 'src/big.ts': big(1) },
		change: [['c', { 'src/big.ts': big(2) }]],
		main: [['m', { 'src/big.ts': big(3) }]],
	});
	const j = propose(job, jobMerge(job).out);
	j.input.budget = 6;
	stage(j.p, j.input);
	apply(j.p.workspace, { 'src/big.ts': big(23) });
	mkdirSync(j.p.out, { recursive: true });
	writeFileSync(
		join(j.p.out, 'result.json'),
		json({
			hunks: [
				{
					path: 'src/big.ts',
					index: 0,
					takes: 'combined',
					why: 'Both.',
					nowDoes: 'It is 23.',
					otherwise: null,
				},
			],
			outside: [],
			checks: [{ command: 'pnpm check:thing', ok: true }],
			risks: 'none',
		}),
	);
	mkdirSync(j.p.claude, { recursive: true });
	writeFileSync(join(j.p.claude, 'stream.jsonl'), STREAM_OK);
	const body = buildResult(j.p, j.input, 'sk-ant-fixture-key-0123456789');
	const h = body.explanation?.hunks[0];
	check(
		body.outcome === 'proposed' &&
			h.result === 'const a = 23;' &&
			h.main === 'const a = 3;' &&
			Buffer.byteLength(body.files[0].content) > 200_000,
		'result: a file over 200 KB gives its hunk’s own lines, never a "not found"',
	);
}
check(
	refusedWith(model(staged(), { files: {} }), 'conflict marker in src/a.ts'),
	'guard: a marker left',
);
check(
	refusedWith(model(staged(), { result: null }), NO_EXPLANATION),
	'guard: no result.json is "the run did not explain its resolution"',
);
check(
	refusedWith(model(staged(), { result: '{not json' }), NO_EXPLANATION),
	'guard: a result.json that is not JSON',
);
check(
	refusedWith(
		model(staged(), { result: { ...goodResult(), hunks: goodResult().hunks.slice(0, 1) } }),
		NO_EXPLANATION,
	),
	'guard: a hunk left unexplained',
);
check(
	refusedWith(model(staged(), { result: { ...goodResult(), risks: '  ' } }), NO_EXPLANATION),
	'guard: empty risks',
);
check(
	refusedWith(
		model(staged(), {
			result: { ...goodResult(), hunks: goodResult().hunks.map((h) => ({ ...h, nowDoes: null })) },
		}),
		NO_EXPLANATION,
	),
	'guard: a combined hunk that does not say what the code now does',
);
check(
	refusedWith(
		model(staged(), {
			result: {
				...goodResult(),
				hunks: [...goodResult().hunks, { ...goodResult().hunks[0], index: 2 }],
			},
		}),
		'not one of its conflicts',
	),
	'guard: a hunk that does not exist',
);
check(
	refusedWith(
		model(staged(), {
			result: { ...goodResult(), hunks: goodResult().hunks.map((h) => ({ ...h, takes: 'mine' })) },
		}),
		NO_EXPLANATION,
	),
	'guard: a takes §10 does not know',
);
check(
	refusedWith(model(staged(), { files: { 'src/a.ts': 'a\u0000b\n' } }), 'NUL byte'),
	'guard: a NUL byte',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': Buffer.from([0xff, 0xfe, 0x0a]) } }),
		'not UTF-8',
	),
	'guard: not UTF-8',
);
check(
	refusedWith(
		model(staged(), { files: { 'src/a.ts': 'x'.repeat(2 * 1024 * 1024 + 1) } }),
		'larger than 2 MB',
	),
	'guard: a file over 2 MB',
);
check(
	refusedWith(model(staged(), { files: { 'src/a.ts': null } }), 'which both sides kept'),
	'guard: deleting a file both sides kept',
);
{
	const job = staged();
	rmSync(join(job.p.workspace, 'src/a.ts'));
	symlinkSync('/etc/hostname', join(job.p.workspace, 'src/a.ts'));
	check(
		refusedWith(model(job, { files: {} }), 'something other than a file'),
		'guard: a link in place of a file',
	);
}
{
	const long = 'x'.repeat(TEXT_CAP + 500);
	const body = model(staged(), { result: { ...goodResult(), risks: `\u202Erisky\u0007 ${long}` } });
	check(
		body.outcome === 'proposed' &&
			Array.from(body.explanation.risks).length === TEXT_CAP &&
			!body.explanation.risks.includes('\u202E') &&
			!body.explanation.risks.includes('\u0007'),
		'caps: a text field is cleaned and cut to 3,000',
	);
	const huge = model(staged(), {
		result: {
			...goodResult(),
			hunks: goodResult().hunks.map((h) => ({
				...h,
				why: long,
				nowDoes: long,
				otherwise: long,
			})),
		},
	});
	check(
		refusedWith(huge, 'longer than 16,000'),
		`caps: an explanation over 16,000 characters (${huge.outcome})`,
	);
}
{
	const person = model(staged(), {
		result: { outcome: 'needs_person', reason: 'The two changes want different things.' },
	});
	check(
		person.outcome === 'needs_person' &&
			person.reason === 'The two changes want different things.' &&
			!shapeProblems(person).length,
		'the model may hand it to a person, with a reason',
	);
	const cli = model(staged(), { stream: '{"type":"result","subtype":"error_max_turns"}\n' });
	check(
		cli.failure === 'The run reached its turn cap before it finished.' &&
			!shapeProblems(cli).length,
		"the CLI's own failure is a `failure`",
	);
	check(
		model(staged(), { stream: null }).failure?.includes('never started'),
		'no CLI output: a failure',
	);
	const key = model(staged(), {
		files: { 'src/a.ts': `${RESOLVED}// sk-ant-fixture-key-0123456789\n` },
		result: { ...goodResult(), outside: [{ path: 'src/a.ts', what: 'x' }] },
	});
	check(
		key.failure === "The result held the run's API key.",
		"the run's key in the result: a failure",
	);
	const broke = staged(0);
	const spent = buildResult(broke.p, broke.input);
	check(
		broke.model === false &&
			spent.outcome === 'needs_person' &&
			spent.reason ===
				"This month's budget for fix and merge runs is spent, so the model did not run: a person resolves src/a.ts." &&
			!shapeProblems(spent).length,
		'budget_usd 0: the model does not run, and a real conflict ends needs_person saying why',
	);
}
{
	const job = staged();
	const record = JSON.parse(read(job.p.record, 'record.json'));
	const c = record.paths.find((x) => x.path === 'src/c.ts');
	writeFileSync(join(job.p.record, c.file), 'tampered\n');
	check(
		model(job).failure?.includes('does not match the merge'),
		"a record whose clean merge differs from main's git: a failure",
	);
}
{
	const repo = scratch('mechanical-only', {
		base: { 'docs/status/x.md': STATUS, 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1) },
		change: [
			[
				'c',
				{
					'docs/status/x.md': withEntry('change'),
					'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2),
				},
			],
		],
		main: [
			[
				'm (#7)',
				{
					'docs/status/x.md': withEntry('main'),
					'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3),
				},
			],
		],
	});
	const { out } = jobMerge(repo);
	const zero = propose(repo, out);
	zero.input.budget = 0;
	stage(zero.p, zero.input);
	check(
		buildResult(zero.p, zero.input).outcome === 'proposed',
		'budget_usd 0: the mechanical part still runs and is proposed',
	);
	const job = propose(repo, out);
	check(stage(job.p, job.input).model === false, 'mechanical-only: the model does not run');
	const body = buildResult(job.p, job.input);
	const e = body.explanation;
	check(
		!shapeProblems(body).length && body.outcome === 'proposed' && json(body.usage) === '[]',
		`mechanical-only: a proposal (${json(shapeProblems(body))})`,
	);
	check(
		e.hunks.length === 2 &&
			e.hunks.every((h) => h.why) &&
			json(e.checks.map((c) => c.command)) ===
				json([
					"docs-append docs/status/x.md: each hunk keeps both sides' lines, no conflict marker left",
				]) &&
			e.risks.includes('Re-record runtime bytes') &&
			e.hunks.some((h) => h.path === 'scripts/runtime-bytes/lines.json' && h.takes === 'main'),
		'mechanical-only: collect fills the explanation from the rules, and says what follows Accept',
	);
	const pending = body.files.find((f) => f.path === 'scripts/runtime-bytes/lines.json');
	check(
		pending.content === MANIFEST('lines', 3) &&
			pending.choice === 'main' &&
			pending.rule === 'runtime-bytes',
		"mechanical-only: a build rule's file is main's, choice main, with its rule (pending)",
	);
	const forged = propose(repo, out);
	const record = JSON.parse(read(forged.p.record, 'record.json'));
	record.paths.find((x) => x.rule === 'runtime-bytes').pending = 'echo trust me';
	writeFileSync(join(forged.p.record, 'record.json'), json(record));
	check(
		buildResult(forged.p, forged.input).failure?.includes('does not match the merge'),
		"a record whose pending command is not the rule's: a failure",
	);
}
{
	const { out } = jobMerge(conflictOn('.github/workflows/x.yml'));
	const job = propose(conflictOn('.github/workflows/z.yml'), out);
	const body = buildResult(job.p, job.input);
	check(
		body.failure === "The merge record is not this run's.",
		'a record from another merge: a failure',
	);
	const same = conflictOn('.github/workflows/y.yml');
	const job2 = propose(same, jobMerge(same).out);
	const refused = buildResult(job2.p, job2.input);
	check(
		refused.outcome === 'harness_conflict' &&
			!shapeProblems(refused).length &&
			refused.reason.includes('.github/workflows/y.yml'),
		'a refusal is posted as its outcome, with its reason',
	);
}
check(
	outsideEdited(
		segmentsOf('a\n<<<<<<< this change\nb\n||||||| base\n=======\nc\n>>>>>>> main\nd\n', 7),
		'a\nbc\nd\n',
	) === false,
	'outsideEdited: a resolution inside the hunk',
);
check(
	outsideEdited(
		segmentsOf('a\n<<<<<<< this change\nb\n||||||| base\n=======\nc\n>>>>>>> main\nd\n', 7),
		'a\nbc\nD\n',
	) === true,
	'outsideEdited: an edit after it',
);
check(
	clean('a\r\nb\u0000\u{E0041}') === 'a\nb' &&
		budgetOf('0') === 0 &&
		budgetOf('6.5') === 6.5 &&
		['', '1.234', '101', '-1', '6e1', undefined].every((v) => throws(() => budgetOf(v))),
	'clean(), and budget_usd: required, two places at most, 0 to 100',
);
check(
	encodeBody({ x: 'y'.repeat(500 * 1024) }).headers['content-encoding'] === 'gzip' &&
		encodeBody({ x: 'y'.repeat(9 * 1024 * 1024) }) === null,
	'a body past 400 KB goes gzipped; past 8 MB it is not sent',
);
check(
	/^[\x20-\x7e]+$/.test(
		logLine('0123456789', { outcome: 'proposed' }, 200, {
			status: 'proposed',
			spendUsd: 1.5,
			extra: '::error::x',
		}),
	),
	'the log line is printable ASCII and carries nothing of the answer but its status and spend',
);

// ── Both steps, end to end: the CLI, the token service and the launcher ───────

async function endToEnd() {
	const job = propose(mixed, mixedMerge.out);
	const seen = [];
	const server = createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const url = new URL(req.url, 'http://127.0.0.1');
			seen.push({
				method: req.method,
				path: url.pathname,
				query: url.searchParams,
				headers: req.headers,
				body: Buffer.concat(chunks),
			});
			res.setHeader('content-type', 'application/json');
			// the launcher answers the first post with a 502 (a read of main's tree failed): the job sends it again
			if (req.method === 'POST' && !seen.some((x) => x.method === 'POST' && x !== seen.at(-1))) {
				res.statusCode = 502;
				res.end(json({ message: 'bad gateway' }));
				return;
			}
			res.end(
				url.pathname === '/token'
					? json({ value: `oidc-for-${url.searchParams.get('audience')}` })
					: json({ status: 'proposed', spendUsd: 2.5 }),
			);
		});
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const output = join(job.p.out, '..', 'github-output');
	const envFor = {
		PATH: process.env.PATH ?? '',
		MERGE_RUN: job.input.mergeRun,
		HEAD_SHA: job.input.head,
		MAIN_SHA: job.input.main,
		RUNNER_TEMP: dirname(job.p.main),
		GITHUB_WORKSPACE: job.p.workspace,
		GITHUB_OUTPUT: output,
		LAUNCHER_URL: origin,
		ACTIONS_ID_TOKEN_REQUEST_URL: `${origin}/token?api-version=2.0`,
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
		BUDGET_USD: '6',
	};
	const cli = (step) =>
		new Promise((done) => {
			const child = spawn(process.execPath, [join(import.meta.dirname, 'collect.mjs'), step], {
				env: envFor,
			});
			let stdout = '';
			child.stdout.on('data', (c) => (stdout += c));
			child.on('close', (code) => done({ code, stdout }));
		});
	const staging = await cli('stage');
	check(
		staging.code === 0 && read(dirname(output), 'github-output') === 'model=true\n',
		`stage CLI: exits 0 and tells the workflow to run the model (${staging.stdout})`,
	);
	apply(job.p.workspace, { 'src/a.ts': RESOLVED });
	writeFileSync(join(job.p.out, 'result.json'), json(goodResult()));
	mkdirSync(job.p.claude, { recursive: true });
	writeFileSync(join(job.p.claude, 'stream.jsonl'), STREAM_OK);
	const posting = await cli('result');
	server.close();
	const token = seen.find((s) => s.path === '/token');
	const posts = seen.filter((s) => s.method === 'POST');
	const post = posts.at(-1);
	check(
		posts.length === 2 && posting.code === 0,
		'result CLI: a 5xx from the launcher is sent again (up to 3 tries) and the second answer counts',
	);
	const body =
		post &&
		JSON.parse(
			(post.headers['content-encoding'] === 'gzip' ? gunzipSync(post.body) : post.body).toString(
				'utf8',
			),
		);
	check(
		token?.query.get('audience') === 'invisible-launcher-merge-main' &&
			token.headers.authorization === 'bearer request-token',
		'result CLI: an OIDC token for audience invisible-launcher-merge-main',
	);
	check(
		post?.path === `/api/pipeline/merge-runs/${job.input.mergeRun}/result` &&
			post.headers.authorization === 'Bearer oidc-for-invisible-launcher-merge-main',
		'result CLI: POST /api/pipeline/merge-runs/<id>/result with the token',
	);
	check(
		body?.outcome === 'proposed' && !shapeProblems(body).length,
		"result CLI: the posted body is §10's",
	);
	const lines = posting.stdout.trim().split('\n');
	check(
		posting.code === 0 &&
			lines.length === 3 &&
			/^::stop-commands::[0-9a-f]{24}$/.test(lines[0]) &&
			lines[1] ===
				`merge run ${job.input.mergeRun}: proposed, the launcher answered 200, proposed, $2.50` &&
			lines[2] === `::${lines[0].slice(17)}::`,
		`result CLI: one line in the log, fenced (${posting.stdout})`,
	);
}
await endToEnd();

// `collect.mjs prepare`: the CLI's settings, agents and prompt, rendered with no placeholder left.
{
	const rt = fresh('prepare-runner');
	const main = join(rt, 'main');
	const ws = join(rt, 'ws');
	mkdirSync(join(main, 'scripts/merge-main'), { recursive: true });
	mkdirSync(ws, { recursive: true });
	cpSync(join(ROOT, 'scripts/bug-fix'), join(main, 'scripts/bug-fix'), { recursive: true });
	cpSync(join(ROOT, '.claude/agents'), join(main, '.claude/agents'), { recursive: true });
	const envFor = {
		PATH: process.env.PATH ?? '',
		MERGE_RUN: '0123456789',
		HEAD_SHA: 'a'.repeat(40),
		MAIN_SHA: 'b'.repeat(40),
		RUNNER_TEMP: rt,
		GITHUB_WORKSPACE: ws,
		BUDGET_USD: '6',
	};
	const prepare = () =>
		spawnSync(process.execPath, [join(import.meta.dirname, 'collect.mjs'), 'prepare'], {
			env: envFor,
			encoding: 'utf8',
		});
	const missing = prepare();
	check(
		missing.status === 1 && missing.stdout.includes('scripts/merge-main/coordinator.md'),
		`prepare: without coordinator.md it fails and says so (${missing.stdout})`,
	);
	writeFileSync(
		join(main, 'scripts/merge-main/coordinator.md'),
		'Read {{CONFLICTS}} in {{WORKSPACE}}; write {{RESULT}} under {{OUT}}.\n',
	);
	const ok = prepare();
	const conf = join(rt, 'claude/conf');
	check(ok.status === 0, `prepare: exits 0 once coordinator.md exists (${ok.stdout}${ok.stderr})`);
	const rendered = ['settings.json', 'prompt.md', 'agents.json'].map((f) => read(conf, f));
	check(
		rendered.every((t) => !/\{\{[A-Z_]+\}\}/.test(t)),
		'prepare: no {{...}} placeholder is left in the settings, prompt or agents',
	);
	const settings = JSON.parse(read(conf, 'settings.json'));
	check(
		settings.permissions.deny.includes(`Edit(/${join(rt, 'conflicts')}/**)`) &&
			settings.permissions.allow.includes(`Read(/${join(rt, 'conflicts')}/**)`) &&
			!settings.permissions.allow.some((a) => a.startsWith('Edit(') && a.includes('conflicts')),
		'prepare: the conflicts folder is readable and never writable',
	);
	check(
		read(conf, 'prompt.md') ===
			`Read ${join(rt, 'conflicts/conflicts.json')} in ${ws}; write ${join(rt, 'out/result.json')} under ${join(rt, 'out')}.\n` &&
			Object.keys(JSON.parse(read(conf, 'agents.json'))).length > 0 &&
			existsSync(join(rt, 'tsx-shim/tsx.mjs')),
		"prepare: the prompt is coordinator.md rendered, the agents are main's, the tsx shim is in place",
	);
}

// Job merge runs no branch code (ADR-0015 §2): stub every spawner it could use and see none called.
{
	const bin = fresh('fake-bin');
	const log = join(bin, 'calls.log');
	for (const name of ['pnpm', 'node', 'npm', 'npx', 'corepack']) {
		const file = join(bin, name);
		writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
		chmodSync(file, 0o755);
	}
	const SUPP = (n) => `{\n  "a.ts": { "r": { "count": ${n} } }\n}\n`;
	const bundle = 'apps/launcher-api/static/rigger/vendor/rigger-fx.js';
	const set = (a, b, c, d) => ({
		'scripts/runtime-bytes/lines.json': MANIFEST('lines', a),
		'svelte-check-baseline.json': BASELINE(b, a),
		'eslint-suppressions.json': SUPP(c),
		[bundle]: `var a=${d};\n`,
	});
	const repo = scratch('no-build', {
		base: set(1, 3, 2, 1),
		change: [['x', set(2, 1, 1, 2)]],
		main: [['x', set(3, 3, 3, 3)]],
	});
	const jm = fresh('no-build-merge');
	sh(TMP, 'clone', '-q', repo.dir, jm);
	sh(jm, 'checkout', '-q', '--detach', repo.head);
	let stubbed = 0;
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	let record;
	try {
		record = mergeMain({
			repo: jm,
			head: repo.head,
			main: repo.main,
			out: join(fresh('no-build-out'), 'merge'),
			run: () => stubbed++,
		});
	} finally {
		process.env.PATH = path;
	}
	check(
		!stubbed && !existsSync(log),
		`merge.mjs spawns no pnpm, node, install or build: the stubbed spawner and the PATH shims saw nothing (${existsSync(log) ? read(bin, 'calls.log') : ''})`,
	);
	check(
		record.paths.length === 4 &&
			record.paths.every((x) => x.rule && x.choice === 'main' && x.status === 'mechanical') &&
			record.paths.every((x) => x.pending?.startsWith('pnpm ')) &&
			!existsSync(join(jm, 'node_modules')) &&
			sh(jm, 'status', '--porcelain') === '',
		"every build rule is main's and pending, and the checkout is untouched",
	);
	check(
		!/pnpm install|INSTALL|runBuilds|spawnRun/.test(
			readFileSync(join(import.meta.dirname, 'merge.mjs'), 'utf8').replace(/\/\/.*$/gm, ''),
		),
		'merge.mjs holds no install or build code path',
	);
}

// A raw NUL in a tracked text file is a "binary" to §10, so any merge touching it ends needs_person.
{
	const TEXT = /\.(?:html?|m?[jt]s|[cm]?js|svelte|css|json|md|ya?ml|sql|txt|svg|py|toml|glsl|sh)$/i;
	const listed = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer' });
	const withNul = listed.stdout
		.toString('utf8')
		.split('\0')
		.filter((f) => f && TEXT.test(f) && existsSync(join(ROOT, f)))
		.filter((f) => readFileSync(join(ROOT, f)).includes(0));
	check(
		listed.status === 0 && !withNul.length,
		`no tracked text file holds a raw NUL (write \\u0000): ${withNul.join(', ')}`,
	);
}

rmSync(TMP, { recursive: true, force: true });
if (failures.length) {
	console.error(
		`check:merge-main — ${failures.length} failed:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`,
	);
	process.exit(1);
}
console.log(
	`check:merge-main — ok: ${passed} checks (every rule, every refusal, collect's guards and the §10 body).`,
);
