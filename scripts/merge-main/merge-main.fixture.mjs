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
	NO_EXPLANATION,
	TAKES,
	TEXT_CAP,
	budgetOf,
	buildResult,
	clean,
	encodeBody,
	logLine,
	measure,
	outsideEdited,
	paths,
	stage,
} from './collect.mjs';
import {
	INSTALL,
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
/** A runner that answers from `script` (command text → (cwd) => pass?) and records each call. */
function fakeRun(script = {}) {
	const calls = [];
	const run = (args, { cwd }) => {
		const text = args.join(' ');
		calls.push(text);
		const step = script[text];
		return step ? step(cwd) !== false : text === INSTALL.join(' ');
	};
	return { run, calls };
}
/** Job merge on a clone checked out at the head: the record and its folder. */
function jobMerge(repo, run = fakeRun().run) {
	const jm = fresh('job-merge');
	sh(TMP, 'clone', '-q', repo.dir, jm);
	sh(jm, 'checkout', '-q', '--detach', repo.head);
	const out = join(fresh('artifact'), 'merge');
	const record = mergeMain({ repo: jm, head: repo.head, main: repo.main, out, run });
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
	const command = 'pnpm check:runtime-bytes --update --only card,lines';
	const fake = fakeRun({
		[command]: (cwd) => {
			for (const id of ['card', 'lines'])
				writeFileSync(join(cwd, `scripts/runtime-bytes/${id}.json`), MANIFEST(id, 23));
		},
	});
	const { record, out } = jobMerge(repo, fake.run);
	const lines = pathOf(record, 'scripts/runtime-bytes/lines.json');
	check(
		json(fake.calls) === json([INSTALL.join(' '), command]),
		`runtime-bytes: install, then one --update --only for every conflicted id (${json(fake.calls)})`,
	);
	check(
		lines.status === 'mechanical' &&
			lines.rule === 'runtime-bytes' &&
			lines.choice === 'regenerated' &&
			fileOf(out, record, 'scripts/runtime-bytes/lines.json') === MANIFEST('lines', 23),
		"runtime-bytes: main's, then re-recorded on the merged tree",
	);
	check(
		record.checks.map((c) => c.command).includes(command) && record.checks.every((c) => c.ok),
		"runtime-bytes: the commands are the record's checks",
	);
	const failing = jobMerge(repo, fakeRun({ [command]: () => false }).run).record;
	check(
		failing.outcome === 'needs_person' &&
			failing.reason.includes('the merged tree needs a person') &&
			failing.reason.includes('lines.json'),
		'a build that fails on a resolved tree: needs_person, naming the file',
	);
}
{
	const bundle = 'apps/launcher-api/static/rigger/vendor/rigger-fx.js';
	const repo = scratch('vendored', {
		base: { [bundle]: 'var a=1;\n' },
		change: [['launcher', { [bundle]: 'var a=2;\n' }]],
		main: [['launcher', { [bundle]: 'var a=3;\n' }]],
	});
	const command = 'pnpm --filter launcher-api build:rigger-fx';
	const fake = fakeRun({ [command]: (cwd) => writeFileSync(join(cwd, bundle), 'var a=23;\n') });
	const { record, out } = jobMerge(repo, fake.run);
	check(
		json(fake.calls) === json([INSTALL.join(' '), command]) &&
			pathOf(record, bundle).rule === 'vendored-bundle' &&
			pathOf(record, bundle).choice === 'regenerated' &&
			fileOf(out, record, bundle) === 'var a=23;\n',
		"vendored-bundle: main's, then pnpm --filter launcher-api build:<name>",
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
	const update = `${checkCmd} --update`;
	const fake = fakeRun({
		[checkCmd]: () => true,
		[update]: (cwd) => writeFileSync(join(cwd, 'svelte-check-baseline.json'), BASELINE(1, 1)),
	});
	const { record, out } = jobMerge(repo, fake.run);
	const x = pathOf(record, 'svelte-check-baseline.json');
	check(
		json(fake.calls) === json([INSTALL.join(' '), checkCmd, update]) &&
			x.rule === 'ratchet' &&
			x.choice === 'regenerated' &&
			fileOf(out, record, 'svelte-check-baseline.json') === BASELINE(1, 1),
		`ratchet (svelte-check): main's, checked on the packages that differ, lowered by its update (${json(fake.calls)})`,
	);
	const fails = jobMerge(repo, fakeRun({ [checkCmd]: () => false }).run).record;
	check(
		fails.outcome === 'needs_person' &&
			fails.reason.includes('the merge adds errors, and a person decides'),
		"ratchet: a failing check is a person's decision",
	);
	const raised = jobMerge(
		repo,
		fakeRun({
			[checkCmd]: () => true,
			[update]: (cwd) => writeFileSync(join(cwd, 'svelte-check-baseline.json'), BASELINE(4, 1)),
		}).run,
	).record;
	check(
		raised.outcome === 'needs_person' && raised.reason.includes("raised it above main's"),
		"ratchet: an update that would raise main's baseline is a person's decision",
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
	const prune = 'pnpm lint --prune-suppressions';
	const fake = fakeRun({
		[prune]: (cwd) => writeFileSync(join(cwd, 'eslint-suppressions.json'), SUP(1, 1)),
	});
	const { record, out } = jobMerge(repo, fake.run);
	check(
		json(fake.calls) === json([INSTALL.join(' '), prune]) &&
			fileOf(out, record, 'eslint-suppressions.json') === SUP(1, 1),
		"ratchet (eslint): main's, pnpm lint --prune-suppressions lowers it",
	);
	check(
		jobMerge(repo, fakeRun({ [prune]: () => false }).run).record.outcome === 'needs_person',
		"ratchet (eslint): new violations are a person's decision",
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
	const fake = fakeRun();
	const { record, out } = jobMerge(repo, fake.run);
	const m = pathOf(record, 'scripts/runtime-bytes/lines.json');
	check(
		!fake.calls.length &&
			m.status === 'conflict' &&
			m.pending === 'pnpm check:runtime-bytes --update --only lines' &&
			fileOf(out, record, m.path) === MANIFEST('lines', 3) &&
			json(record.model) === json(['src/a.ts']),
		"with code left to resolve, a build rule is pending: main's, its command named, nothing built",
	);
	const md = scratch('pending-markdown', {
		base: { 'docs/a.md': 'one\n', 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1) },
		change: [
			[
				'x',
				{ 'docs/a.md': 'one, change\n', 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2) },
			],
		],
		main: [
			[
				'x',
				{ 'docs/a.md': 'one, main\n', 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3) },
			],
		],
	});
	const builds = fakeRun({ 'pnpm check:runtime-bytes --update --only lines': () => true });
	const mdRecord = jobMerge(md, builds.run).record;
	check(
		builds.calls.length === 2 &&
			pathOf(mdRecord, 'scripts/runtime-bytes/lines.json').status === 'mechanical',
		'a conflict left only in Markdown does not hold the builds back',
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
	const fake = fakeRun();
	const { record } = jobMerge(
		conflictOn(path, {
			base: { 'svelte-check-baseline.json': BASELINE(1, 1) },
			change: { 'svelte-check-baseline.json': BASELINE(0, 1) },
			main: { 'svelte-check-baseline.json': BASELINE(1, 0) },
		}),
		fake.run,
	);
	check(
		record.outcome === 'harness_conflict' && record.reason.includes(path) && !fake.calls.length,
		`harness_conflict: ${path}, and nothing built`,
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
const CHOICES = ['main', 'change', 'both', 'combined', 'regenerated'];
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
			keysAre(h, ['path', 'index', 'main', 'change', 'takes', 'why', 'nowDoes', 'otherwise']) &&
			Number.isInteger(h.index) &&
			TAKES.includes(h.takes) &&
			[h.main, h.change, h.why].every((t) => text(t) && t) &&
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
	if (measure(e) > EXPLANATION_CAP) out.push('explanation over 16,000');
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
		e.risks.includes('pnpm check:runtime-bytes --update --only lines') &&
			e.risks.includes('was not run'),
		'result: a pending build left undone is a risk',
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
{
	const job = staged();
	const body = model(job, {
		files: { 'src/a.ts': RESOLVED, 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 99) },
	});
	const m = body.files.find((f) => f.path === 'scripts/runtime-bytes/lines.json');
	check(
		body.outcome === 'proposed' &&
			m.choice === 'regenerated' &&
			body.explanation.hunks.some((h) => h.path === m.path && h.takes === 'combined' && h.nowDoes),
		'result: a pending file the run rebuilt is regenerated',
	);
}
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
	const ratchet = staged();
	check(
		refusedWith(
			model(ratchet, {
				files: { 'src/a.ts': RESOLVED, 'svelte-check-baseline.json': BASELINE(9, 9) },
			}),
			"above main's",
		),
		"guard: a pending ratchet raised above main's",
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
			hunks: goodResult().hunks.map((h) => ({ ...h, why: long, main: long, change: long })),
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
	const command = 'pnpm check:runtime-bytes --update --only lines';
	const { out } = jobMerge(
		repo,
		fakeRun({
			[command]: (cwd) =>
				writeFileSync(join(cwd, 'scripts/runtime-bytes/lines.json'), MANIFEST('lines', 23)),
		}).run,
	);
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
					INSTALL.join(' '),
					command,
				]) &&
			e.risks === 'none found',
		'mechanical-only: collect fills the explanation from the rules, the checks are the regeneration commands',
	);
	check(
		body.files.find((f) => f.path === 'scripts/runtime-bytes/lines.json').content ===
			MANIFEST('lines', 23),
		"mechanical-only: the regenerated content is the build's",
	);
	const forged = propose(repo, out);
	const record = JSON.parse(read(forged.p.record, 'record.json'));
	record.checks[2].command = 'echo trust me';
	writeFileSync(join(forged.p.record, 'record.json'), json(record));
	check(
		buildResult(forged.p, forged.input).failure?.includes('the builds'),
		"a record whose builds are not the rule's commands: a failure",
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
	const post = seen.find((s) => s.method === 'POST');
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
