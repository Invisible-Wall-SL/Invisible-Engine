// `current-games.yml` skips the build and every render when a change cannot reach a game. That is
// only safe while "cannot reach" is computed from the real workspace graph and the real gates, so
// this proves the closure agrees with pnpm's, that every gate reads only runtime inputs, and that
// the classifier skips exactly the launcher/service/other-app changes and nothing engine-side.
//
//   node scripts/current-games/touched.fixture.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { BUILTIN_DEFS_SOURCE } from './lib/builtins.mjs';
import { ALL_GATES } from './lib/gates.mjs';
import {
	bakeInputs,
	changedFiles,
	classifyChange,
	describe,
	inDir,
	isDoc,
	runtimeClosure,
	runtimeInputs,
	RUNTIME_APP,
	valueImports,
} from './lib/touched.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const TOUCHED = 'scripts/current-games/lib/touched.mjs';

// 1. The closure is pnpm's graph: `lines` and what `pnpm --filter 'lines^...' build` builds.
{
	const r = spawnSync(
		'pnpm',
		['--filter', `${RUNTIME_APP.split('/').pop()}...`, 'ls', '--depth', '-1', '--json'],
		{
			cwd: ROOT,
			encoding: 'utf8',
			shell: process.platform === 'win32',
		},
	);
	assert.equal(r.status, 0, `pnpm ls failed: ${r.stderr}`);
	const pnpmDirs = JSON.parse(r.stdout)
		.map((p) => relative(ROOT, p.path).split('\\').join('/'))
		.sort();
	assert.deepEqual(runtimeClosure(), pnpmDirs, "the computed closure differs from pnpm's graph");
	for (const dir of [
		'apps/lines',
		'packages/pixi-svelte',
		'packages/engine-game',
		'packages/config-vite',
	])
		assert.ok(pnpmDirs.includes(dir), `${dir} is in the closure`);
	for (const dir of ['apps/launcher-api', 'services/atlas-tool', 'services/director-worker'])
		assert.ok(!pnpmDirs.includes(dir), `${dir} is not in the closure`);
}

const inputs = runtimeInputs();
const isInput = (file) => inputs.files.includes(file) || inputs.dirs.some((d) => inDir(file, d));

// 2. Every gate's command line names only files inside the inputs: a gate that moved to launcher
//    code would otherwise run against stale results on a launcher-only PR. What a gate then reads
//    is covered by GATE_DIRS by construction (`scripts/`, the test server, the game-config
//    defaults), bar the accepted `check:undefined-names` exception noted in touched.mjs.
{
	const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
	for (const gate of ALL_GATES) {
		assert.ok(scripts[gate], `${gate} is a root script`);
		const paths = scripts[gate]
			.split(/\s+/)
			.map((t) => t.replace(/^\.\//, ''))
			.filter((t) => /^(apps|packages|services|scripts)\//.test(t));
		assert.ok(paths.length, `${gate} runs at least one file`);
		for (const p of paths) assert.ok(isInput(p), `${gate} reads ${p}, outside the runtime inputs`);
	}
}

// 3. The classifier.
const kind = (files) => classifyChange(files, inputs).kind;
assert.equal(kind([]), 'docs');
assert.equal(
	kind(['docs/STATUS.md', 'packages/pixi-svelte/README.md', '.claude/agents/x.md']),
	'docs',
);
assert.equal(isDoc('apps/lines/src/x.md'), true);
assert.equal(isDoc('apps/lines/src/x.ts'), false);

for (const file of [
	'apps/launcher-api/src/routes/director/+page.svelte',
	'apps/launcher-api/src/lib/server/director/gate.ts',
	'apps/launcher-api/static/brand/iw-emblem.svg',
	'services/atlas-tool/ui_server.py',
	'services/director-worker/src/index.ts',
	'apps/cluster/src/game/config.ts',
	'packages/game-spec/src/index.ts',
	'tools/flow-spike/index.mjs',
	'.github/workflows/lint.yml',
	'.github/actions/code-changed/action.yml',
])
	assert.equal(kind([file]), 'untouched', `${file} cannot reach a game`);

for (const file of [
	'apps/lines/src/game/config.ts',
	'apps/lines/static/assets/x.png',
	'packages/pixi-svelte/src/index.ts',
	'packages/engine-layout/src/builtinComponents.ts',
	'packages/config-vite/index.js',
	'packages/rgs-translator-eagaming/src/engineFacade.ts',
	'package.json',
	'pnpm-lock.yaml',
	'pnpm-workspace.yaml',
	'turbo.json',
	'scripts/mock-rgs-server.mjs',
	'scripts/ts-loader.mjs',
	'scripts/current-games/tolerance.json',
	'scripts/current-games/screens/lines.json',
	'services/test-server/server.mjs',
	'apps/launcher-api/src/lib/data/gameConfig/lines.json',
	'.github/workflows/current-games.yml',
])
	assert.equal(kind([file]), 'touched', `${file} can reach a game`);

{
	const mixed = classifyChange(
		[
			'docs/a.md',
			'apps/launcher-api/src/x.ts',
			'apps/lines/src/x.ts',
			'packages/engine-fx/src/y.ts',
		],
		inputs,
	);
	assert.equal(mixed.kind, 'touched');
	assert.deepEqual(mixed.touching, ['apps/lines/src/x.ts', 'packages/engine-fx/src/y.ts']);
	assert.equal(kind(['docs/a.md', 'apps/launcher-api/src/x.ts']), 'untouched');
}

// A directory prefix is a path segment, not a string prefix.
assert.equal(kind(['apps/lines-tools/x.ts']), 'untouched');
assert.equal(kind(['scripts-old/x.mjs']), 'untouched');

// 3b. The bake's inputs: the built-in defs and every module they take a value from, and nothing
//     outside their package — so a runtime change that cannot alter a def plans no republished render.
{
	const bake = bakeInputs();
	assert.ok(bake.files.includes(BUILTIN_DEFS_SOURCE));
	for (const file of [
		'packages/engine-layout/src/lib/builtinRegions.ts',
		'packages/engine-layout/src/lib/componentCatalog.ts',
		'packages/engine-layout/src/lib/kindCapabilities.ts',
	])
		assert.ok(bake.files.includes(file), `${file} is a bake input (builtinComponents.ts reads it)`);
	for (const file of bake.files)
		assert.ok(file.startsWith('packages/engine-layout/src/lib/'), `${file} is inside the package`);
	assert.ok(!bake.dirs.includes('apps/lines'));
	// Every value import of the defs file resolves into the set, so a new module they read counts.
	for (const spec of valueImports(readFileSync(join(ROOT, BUILTIN_DEFS_SOURCE), 'utf8')))
		if (spec.startsWith('.'))
			assert.ok(
				bake.files.some((f) => f === `packages/engine-layout/src/lib/${spec.slice(2)}.ts`),
				`${spec} resolved into the bake inputs`,
			);
	assert.deepEqual(
		valueImports(
			[
				"import type { A } from './types';",
				"import { type B, C } from './mixed';",
				"import './side';",
				"export { d } from './re';",
				"export type { E } from './types2';",
				" * {@link import('./doc').X} in a comment",
				'import {',
				'\tF,',
				"} from 'workspace-pkg';",
			].join('\n'),
		),
		['./mixed', './side', './re', 'workspace-pkg'],
	);
	const bakeOf = (files) => classifyChange(files, inputs).bake;
	assert.deepEqual(bakeOf([BUILTIN_DEFS_SOURCE, 'apps/lines/src/x.ts']), [BUILTIN_DEFS_SOURCE]);
	assert.deepEqual(bakeOf(['packages/engine-layout/src/lib/builtinRegions.ts']), [
		'packages/engine-layout/src/lib/builtinRegions.ts',
	]);
	assert.deepEqual(
		bakeOf(['apps/lines/src/game/config.ts', 'packages/pixi-svelte/src/index.ts']),
		[],
	);
	assert.deepEqual(bakeOf(['apps/launcher-api/src/x.ts']), []);
	assert.deepEqual(bakeOf(['docs/a.md']), []);
}

for (const text of [describe({ kind: 'docs' }, 3), describe({ kind: 'untouched' }, 1234)])
	assert.ok(text.length <= 140, `status description fits: ${text}`);

// A file MOVED out of the inputs is still a change to them: git's default rename detection would
// list only the new path, and the move would read as untouched.
{
	const repo = mkdtempSync(join(tmpdir(), 'cg-touched-repo-'));
	const git = (...args) => {
		const r = spawnSync('git', ['-c', 'user.name=cg', '-c', 'user.email=cg@test', ...args], {
			cwd: repo,
			encoding: 'utf8',
		});
		assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
	};
	git('init', '-q');
	mkdirSync(join(repo, 'apps/lines/src'), { recursive: true });
	writeFileSync(join(repo, 'apps/lines/src/big.ts'), Array.from({ length: 200 }, (_, i) => `export const v${i} = ${i};`).join('\n')); // prettier-ignore
	git('add', '-A');
	git('commit', '-q', '-m', 'one');
	mkdirSync(join(repo, 'tools'));
	git('mv', 'apps/lines/src/big.ts', 'tools/big.ts');
	git('commit', '-q', '-m', 'two');
	const files = changedFiles('HEAD~1', 'HEAD', repo);
	rmSync(repo, { recursive: true, force: true });
	assert.deepEqual(files, ['apps/lines/src/big.ts', 'tools/big.ts']);
	assert.equal(kind(files), 'touched', 'a move out of apps/lines is a change to apps/lines');
}

// 4. The CLI writes what the workflow reads.
const cli = (args, input) => {
	const dir = mkdtempSync(join(tmpdir(), 'cg-touched-'));
	const output = join(dir, 'out');
	const r = spawnSync(process.execPath, [TOUCHED, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		input,
		env: { ...process.env, GITHUB_OUTPUT: output },
	});
	const written = existsSync(output) ? readFileSync(output, 'utf8') : '';
	rmSync(dir, { recursive: true, force: true });
	return { ...r, written };
};
{
	const r = cli(['--files', '-'], 'apps/launcher-api/src/x.ts\ndocs/a.md\n');
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.written, /^render=false$/m);
	assert.match(r.written, /^republish=false$/m);
	assert.match(r.written, /^description=Runtime untouched: no game can differ \(1 changed files/m);
}
{
	// A runtime change that cannot alter a built-in def renders, but plans no republished render.
	const r = cli(['--files', '-'], 'apps/lines/src/x.ts\n');
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^republish=false$/m);
	assert.doesNotMatch(r.stdout, /bake's inputs changed/);
}
{
	const r = cli(['--files', '-'], `${BUILTIN_DEFS_SOURCE}\napps/lines/src/x.ts\n`);
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^republish=true$/m);
	assert.match(r.stdout, /bake's inputs changed[^\n]*\n[^\n]*builtinComponents\.ts/);
}
{
	const r = cli(['--files', '-'], 'docs/a.md\n');
	assert.match(r.written, /^render=false$/m);
	assert.match(r.written, /^description=Docs-only change: no game can differ$/m);
}
{
	const r = cli(['--files', '-'], 'apps/launcher-api/src/x.ts\napps/lines/src/x.ts\n');
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^description=$/m);
	assert.match(r.stdout, /^runtime inputs changed:/m);
	assert.match(r.stdout, /apps\/lines\/src\/x\.ts/);
	assert.doesNotMatch(r.stdout, /launcher-api/);
}
{
	// An undecidable diff renders everything: the rule only ever skips, never widens.
	const r = cli(['--base', 'no-such-ref']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^republish=true$/m);
	assert.match(r.stdout, /change set unknown/);
}
{
	// Against git for real: HEAD vs HEAD changes nothing.
	const r = cli(['--base', 'HEAD', '--head', 'HEAD']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.written, /^render=false$/m);
	assert.match(r.written, /^republish=false$/m);
	assert.match(r.written, /^description=Docs-only change/m);
}
{
	const r = spawnSync(process.execPath, [TOUCHED], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(r.status, 2, 'no arguments is a usage error');
}

console.log('touched.fixture: ok');
