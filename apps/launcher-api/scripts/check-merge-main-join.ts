/**
 * Cross-check of Resolve conflict's two halves (ADR-0015 §10: "the last of the two to land adds a
 * cross-check that feeds 15B1's `collect` output to 15C's parser"):
 *   pnpm --filter launcher-api check:merge-main-join
 *
 * Real scratch git repositories in a temporary folder. For each case the JOB's own code runs
 * (`merge.mjs` `mergeMain`, then `collect.mjs` `stage` and `buildResult`, the body as `encodeBody`
 * would send it, gunzipped when it was gzipped); the launcher's parser (`parseMergeResult`) and
 * its rules on the result (`filesProblem`, `cleanExplanation`, `isExplainedMerge`) read that exact
 * JSON; and Accept's three-tree plan (`planMerge`, `contentProblem`) is run over the same repos.
 * The tree Accept would write must equal what git's own merge gives with the run's resolution
 * applied to the paths git could not merge; a build rule's file is main's, pending. Any drift between the
 * two halves fails here.
 *
 * Cases: docs append only (no model); a runtime-bytes file left main's and pending (no job builds); a mixed run
 * with a model resolution by hand, a pending runtime-bytes and ratchet left unbuilt, paths both
 * sides changed identically and paths both sides deleted; a harness refusal; a spent budget with a
 * real conflict; a binary.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildResult, encodeBody, paths, stage } from '../../../scripts/merge-main/collect.mjs';
import { mergeMain } from '../../../scripts/merge-main/merge.mjs';
import { MERGE_CAPS } from '../src/lib/mergeMainRuns.ts';
import {
	cleanExplanation,
	explanationSize,
	filesProblem,
	isExplainedMerge,
	parseMergeResult,
} from '../src/lib/server/pipelineMergeRunsResult.ts';
import {
	blobSha,
	contentProblem,
	planMerge,
	type Files,
} from '../src/lib/server/pipelineMergeRunsBuild.ts';

const TMP = mkdtempSync(join(tmpdir(), 'merge-main-join-'));
let checks = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (!ok) failures.push(`${label}${detail ? `\n        ${detail}` : ''}`);
}

// ── Scratch repositories (as merge-main.fixture.mjs builds them) ──────────────

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
function git(cwd: string, ...args: string[]): string {
	const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
}
function gitTry(cwd: string, ...args: string[]): void {
	spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}
let serial = 0;
const fresh = (name: string): string => {
	const dir = join(TMP, `${String(++serial).padStart(3, '0')}-${name}`);
	mkdirSync(dir, { recursive: true });
	return dir;
};

type Side = Record<string, string | Buffer | { exec: string } | null>;
function apply(dir: string, files: Side): void {
	for (const [path, v] of Object.entries(files)) {
		const file = join(dir, path);
		if (v === null) {
			rmSync(file, { force: true });
			continue;
		}
		mkdirSync(dirname(file), { recursive: true });
		const exec = typeof v === 'object' && !Buffer.isBuffer(v);
		writeFileSync(file, exec ? v.exec : v);
		chmodSync(file, exec ? 0o755 : 0o644);
	}
}
interface Repo {
	dir: string;
	base: string;
	head: string;
	main: string;
}
function scratch(
	name: string,
	{
		base,
		change = [],
		main = [],
	}: { base: Side; change?: [string, Side][]; main?: [string, Side][] },
): Repo {
	const dir = fresh(name);
	git(dir, 'init', '-q', '-b', 'main');
	apply(dir, base);
	git(dir, 'add', '-A');
	git(dir, 'commit', '-qm', 'base');
	const baseSha = git(dir, 'rev-parse', 'HEAD');
	git(dir, 'checkout', '-qb', 'change');
	for (const [subject, files] of change) {
		apply(dir, files);
		git(dir, 'add', '-A');
		git(dir, 'commit', '-qm', subject, '--allow-empty');
	}
	git(dir, 'checkout', '-q', 'main');
	for (const [subject, files] of main) {
		apply(dir, files);
		git(dir, 'add', '-A');
		git(dir, 'commit', '-qm', subject, '--allow-empty');
	}
	return {
		dir,
		base: baseSha,
		head: git(dir, 'rev-parse', 'change'),
		main: git(dir, 'rev-parse', 'main'),
	};
}

// ── The job's code, then the launcher's ───────────────────────────────────────

const STREAM_OK =
	'{"type":"result","subtype":"success","modelUsage":{"claude-opus-5-5":{"inputTokens":120,"outputTokens":30,"cacheReadInputTokens":5,"cacheCreationInputTokens":7}}}\n';

interface Job {
	body: Record<string, unknown>;
	wire: Record<string, unknown>;
	gzipped: boolean;
}

/** Job `merge` on a clone at the head, then job `propose`: stage, the model's work, the result. */
function runJob(
	repo: Repo,
	opts: {
		budget?: number;
		model?: { files: Side; result: unknown } | null;
	} = {},
): Job {
	const jm = fresh('job-merge');
	git(TMP, 'clone', '-q', repo.dir, jm);
	git(jm, 'checkout', '-q', '--detach', repo.head);
	const out = join(fresh('artifact'), 'merge');
	mergeMain({ repo: jm, head: repo.head, main: repo.main, out });
	const rt = fresh('runner-temp');
	const ws = join(rt, 'ws');
	git(TMP, 'clone', '-q', repo.dir, ws);
	git(ws, 'checkout', '-q', '--detach', repo.main);
	const p = paths(rt, ws);
	cpSync(ws, p.main, { recursive: true });
	cpSync(out, p.record, { recursive: true });
	const input = {
		mergeRun: '0123456789',
		head: repo.head,
		main: repo.main,
		budget: opts.budget ?? 6,
	};
	stage(p, input);
	if (opts.model) {
		apply(p.workspace, opts.model.files);
		mkdirSync(p.out, { recursive: true });
		writeFileSync(join(p.out, 'result.json'), JSON.stringify(opts.model.result));
		mkdirSync(p.claude, { recursive: true });
		writeFileSync(join(p.claude, 'stream.jsonl'), STREAM_OK);
	}
	const body = buildResult(p, input, 'sk-ant-fixture-key-0123456789') as Record<string, unknown>;
	const sent = encodeBody(body);
	if (!sent) throw new Error('the body was too large to send');
	const gzipped = sent.headers['content-encoding'] === 'gzip';
	const raw = gzipped ? gunzipSync(sent.bytes) : sent.bytes;
	return { body, wire: JSON.parse(raw.toString('utf8')), gzipped };
}

function treeOf(dir: string, rev: string): Files {
	const r = spawnSync('git', ['ls-tree', '-r', '-z', rev], { cwd: dir, env: GIT_ENV });
	const files: Files = new Map();
	for (const entry of r.stdout.toString('utf8').split('\0')) {
		if (!entry) continue;
		const [meta, path] = entry.split('\t');
		const [mode, type, sha] = meta.split(' ');
		files.set(path, { mode, type, sha });
	}
	return files;
}
const show = (dir: string, rev: string, path: string): string | null => {
	const r = spawnSync('git', ['show', `${rev}:${path}`], {
		cwd: dir,
		env: GIT_ENV,
		encoding: 'utf8',
	});
	return r.status === 0 ? r.stdout : null;
};
const flat = (files: Files): string =>
	JSON.stringify(
		[...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, e]) => [p, e.mode, e.sha]),
	);

/** What git's own merge gives, with the run's resolution put on the paths git left conflicted and on the rules' files. */
function expectedTree(
	repo: Repo,
	files: { path: string; content: string | null; mode: string; rule: string | null }[],
): { tree: Files; unresolved: string[] } {
	const dir = fresh('expected');
	git(TMP, 'clone', '-q', repo.dir, dir);
	git(dir, 'checkout', '-q', '--detach', repo.head);
	gitTry(dir, 'merge', '--no-commit', '--no-ff', '-X', 'no-renames', repo.main);
	const unmerged = new Set(
		git(dir, 'ls-files', '-u')
			.split('\n')
			.filter(Boolean)
			.map((l) => l.split('\t')[1]),
	);
	for (const f of files) {
		if (!unmerged.has(f.path) && f.rule === null) continue;
		if (f.content === null) rmSync(join(dir, f.path), { force: true });
		else apply(dir, { [f.path]: f.mode === '100755' ? { exec: f.content } : f.content });
		unmerged.delete(f.path);
	}
	git(dir, 'add', '-A');
	const tree = git(dir, 'write-tree');
	return { tree: treeOf(dir, tree), unresolved: [...unmerged] };
}

/** The launcher's reading of a job's result, then Accept's plan: the tree it would write. */
function launcherSide(label: string, repo: Repo, job: Job): void {
	let parsed: ReturnType<typeof parseMergeResult>;
	try {
		parsed = parseMergeResult(job.wire);
	} catch (err) {
		check(`${label}: parseMergeResult accepts the job's exact JSON`, false, String(err));
		return;
	}
	check(`${label}: parseMergeResult accepts the job's exact JSON`, true);
	check(
		`${label}: the parsed outcome is the job's`,
		parsed.outcome === (job.body.outcome ?? null) && parsed.failure === (job.body.failure ?? null),
	);
	check(
		`${label}: head, main and merge base are the run's`,
		parsed.headSha === repo.head &&
			parsed.mainSha === repo.main &&
			(parsed.baseSha === null || parsed.baseSha === repo.base),
	);
	if (parsed.outcome !== 'proposed') return;
	const explanation = parsed.explanation && cleanExplanation(parsed.explanation);
	check(
		`${label}: the explanation is explained and within its cap`,
		isExplainedMerge(explanation) && explanationSize(explanation) <= MERGE_CAPS.explanation,
	);
	const hunkPaths = new Set((explanation?.hunks ?? []).map((h) => h.path));
	const problem = filesProblem(parsed.files, hunkPaths);
	check(
		`${label}: filesProblem finds nothing in the job's files`,
		problem === null,
		String(problem),
	);
	const baseSha = git(repo.dir, 'merge-base', repo.head, repo.main);
	const base = treeOf(repo.dir, baseSha);
	const head = treeOf(repo.dir, repo.head);
	const main = treeOf(repo.dir, repo.main);
	const planned = planMerge(base, head, main, parsed.files);
	if ('problem' in planned) {
		check(`${label}: Accept's three-tree plan takes the files`, false, planned.problem);
		return;
	}
	check(`${label}: Accept's three-tree plan takes the files`, true);
	for (const file of planned.plan.resolved) {
		const content = contentProblem(file, {
			main: show(repo.dir, repo.main, file.path),
			head: show(repo.dir, repo.head, file.path),
		});
		check(`${label}: contentProblem on ${file.path}`, content === null, String(content));
	}
	const accepted: Files = new Map(main);
	for (const w of planned.plan.writes) {
		if (w.sha === null && w.content === null) accepted.delete(w.path);
		else
			accepted.set(w.path, { mode: w.mode, type: w.type, sha: w.sha ?? blobSha(w.content ?? '') });
	}
	const expected = expectedTree(repo, parsed.files);
	check(
		`${label}: git left nothing unresolved that the run did not resolve`,
		!expected.unresolved.length,
		expected.unresolved.join(', '),
	);
	check(
		`${label}: the tree Accept writes equals git's merge with the resolution`,
		flat(accepted) === flat(expected.tree),
		`accept ${flat(accepted)}\n        git    ${flat(expected.tree)}`,
	);
}

const refusalOk = (label: string, job: Job, outcome: string): void => {
	check(
		`${label}: the job sent ${outcome}`,
		job.body.outcome === outcome,
		JSON.stringify(job.body),
	);
};

// ── Cases ─────────────────────────────────────────────────────────────────────

const STATUS = '# X — status\n\n## Recent changes\n\n- 2026-11-01 — old.\n';
const ENTRY = (who: string): string => `- 2026-11-27 — ${who} entry.\n  More about it.\n`;
const withEntry = (who: string): string =>
	STATUS.replace('\n- 2026-11-01', `\n${ENTRY(who)}- 2026-11-01`);
const MANIFEST = (id: string, n: number): string =>
	`{\n\t"runtime": "${id}",\n\t"files": {\n\t\t"a.js": ${n}\n\t}\n}\n`;
const BASELINE = (a: number, b: number): string =>
	`{\n\t"apps/a": { "errors": ${a} },\n\t"apps/b": { "errors": ${b} }\n}\n`;
const CODE2 = (x: number, y: number): string =>
	`// a\nexport const a = ${x};\n// b\n// c\n// d\nexport const b = ${y};\n`;

// 1. Docs append only: nothing for the model.
{
	const repo = scratch('docs-append', {
		base: { 'docs/status/x.md': STATUS },
		change: [['docs', { 'docs/status/x.md': withEntry('change') }]],
		main: [['docs', { 'docs/status/x.md': withEntry('main') }]],
	});
	const job = runJob(repo);
	check(
		'docs append: a mechanical-only proposal with no usage',
		job.body.outcome === 'proposed' && JSON.stringify(job.body.usage) === '[]',
	);
	launcherSide('docs append', repo, job);
}

// 2. A runtime-bytes file: main's and pending, nothing built (no job runs branch code).
{
	const repo = scratch('runtime-bytes', {
		base: { 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 1) },
		change: [['engine', { 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 2) }]],
		main: [['engine', { 'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3) }]],
	});
	const job = runJob(repo);
	const files = job.body.files as { path: string; choice: string; rule: string; content: string }[];
	check(
		"runtime-bytes: main's, pending, with its rule",
		job.body.outcome === 'proposed' &&
			files[0]?.choice === 'main' &&
			files[0].rule === 'runtime-bytes' &&
			files[0].content === MANIFEST('lines', 3),
	);
	launcherSide('runtime-bytes', repo, job);
}

// 3. Mixed: a model resolution, a pending runtime-bytes and ratchet, identical changes, both deleted.
const MIXED: Parameters<typeof scratch>[1] = {
	base: {
		'src/a.ts': CODE2(1, 1),
		'src/c.ts': 'a\nb\nc\nd\ne\nf\n',
		'docs/status/x.md': STATUS,
		'src/main-only.ts': 'old\n',
		'src/gone.ts': 'gone\n',
		'src/same.ts': 'before\n',
		'scripts/bug-fix/shared.mjs': 'one\n',
		'pnpm-lock.yaml': 'lock: 1\n',
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
				'src/gone.ts': null,
				'src/same.ts': 'after\n',
				'scripts/bug-fix/shared.mjs': 'two\n',
				'pnpm-lock.yaml': 'lock: 2\n',
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
				'src/gone.ts': null,
				'src/same.ts': 'after\n',
				'scripts/bug-fix/shared.mjs': 'two\n',
				'pnpm-lock.yaml': 'lock: 2\n',
				'scripts/runtime-bytes/lines.json': MANIFEST('lines', 3),
				'svelte-check-baseline.json': BASELINE(3, 1),
			},
		],
	],
};
const mixed = scratch('mixed', MIXED);
{
	const RESOLVED = CODE2(23, 23);
	const job = runJob(mixed, {
		model: {
			files: { 'src/a.ts': RESOLVED },
			result: {
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
				checks: [{ command: 'Read the diff of src/a.ts and compare the two constants', ok: true }],
				risks: 'none found',
			},
		},
	});
	check('mixed: the model-resolved run is a proposal', job.body.outcome === 'proposed');
	const files = job.body.files as { path: string; choice: string; content: string | null }[];
	const choice = (p: string) => files.find((f) => f.path === p);
	check(
		'mixed: paths both sides changed identically or deleted are listed',
		choice('src/same.ts')?.choice === 'main' &&
			choice('src/gone.ts')?.content === null &&
			choice('pnpm-lock.yaml') !== undefined &&
			choice('scripts/bug-fix/shared.mjs') !== undefined,
		JSON.stringify(files.map((f) => [f.path, f.choice])),
	);
	check(
		'mixed: usage is the fix-run shape (tokens per model, no cost)',
		JSON.stringify(job.body.usage) ===
			JSON.stringify([
				{
					model: 'claude-opus-5-5',
					inputTokens: 120,
					outputTokens: 30,
					cacheReadTokens: 5,
					cacheWriteTokens: 7,
				},
			]),
	);
	const sentence = (job.body.explanation as { checks: { command: string }[] }).checks[0];
	check('mixed: a sentence as a check command is sent as text', sentence.command.includes(' '));
	launcherSide('mixed', mixed, job);
}

// 4. A harness refusal.
{
	const repo = scratch('harness', {
		base: { '.github/workflows/lint.yml': 'one\n' },
		change: [['c', { '.github/workflows/lint.yml': 'one, change\n' }]],
		main: [['m', { '.github/workflows/lint.yml': 'one, main\n' }]],
	});
	const job = runJob(repo);
	refusalOk('harness', job, 'harness_conflict');
	launcherSide('harness', repo, job);
}

// 5. A spent budget with a real conflict: the model does not run.
{
	const job = runJob(mixed, { budget: 0 });
	refusalOk('budget 0', job, 'needs_person');
	launcherSide('budget 0', mixed, job);
}

// 6. A binary conflict.
{
	const repo = scratch('binary', {
		base: { 'a.bin': Buffer.from([0, 1, 2]) },
		change: [['c', { 'a.bin': Buffer.from([0, 1, 3]) }]],
		main: [['m', { 'a.bin': Buffer.from([0, 1, 4]) }]],
	});
	const job = runJob(repo);
	refusalOk('binary', job, 'needs_person');
	launcherSide('binary', repo, job);
}

rmSync(TMP, { recursive: true, force: true });
if (failures.length) {
	console.error(`check:merge-main-join — ${failures.length} of ${checks} failed:`);
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log(
	`check:merge-main-join — ok: ${checks} checks (the job's JSON through the launcher's parser and Accept's plan).`,
);
