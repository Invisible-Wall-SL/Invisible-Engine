// `current-games.yml` skips the build and every render when a change cannot reach a game. That is
// only safe while "cannot reach" is computed from the real workspace graph and the real gates, so
// this proves the closure agrees with pnpm's, that every gate reads only runtime inputs, and that
// the classifier skips exactly the launcher/service/other-app changes and nothing engine-side.
//
//   node scripts/current-games/touched.fixture.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { ALL_GATES } from './lib/gates.mjs';
import {
	classifyChange,
	describe,
	isDoc,
	runtimeClosure,
	runtimeInputs,
	RUNTIME_APP,
} from './lib/touched.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const TOUCHED = 'scripts/current-games/lib/touched.mjs';

// 1. The closure is pnpm's graph: what `pnpm --filter 'lines^...' build` builds is what counts.
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
const isInput = (file) =>
	inputs.files.includes(file) || inputs.dirs.some((d) => file === d || file.startsWith(`${d}/`));

// 2. Every gate's command names only files inside the inputs: a gate that started reading launcher
//    code would otherwise run against stale results on a launcher-only PR.
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

for (const text of [describe({ kind: 'docs' }, 3), describe({ kind: 'untouched' }, 1234)])
	assert.ok(text.length <= 140, `status description fits: ${text}`);

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
	assert.match(r.written, /^reason=untouched$/m);
	assert.match(r.written, /^description=Runtime untouched: no game can differ \(2 changed files/m);
}
{
	const r = cli(['--files', '-'], 'docs/a.md\n');
	assert.match(r.written, /^render=false$/m);
	assert.match(r.written, /^reason=docs$/m);
	assert.match(r.written, /^description=Docs-only change: no game can differ$/m);
}
{
	const r = cli(['--files', '-'], 'apps/launcher-api/src/x.ts\napps/lines/src/x.ts\n');
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^reason=touched$/m);
	assert.match(r.written, /^description=$/m);
	assert.match(r.stdout, /apps\/lines\/src\/x\.ts/);
	assert.doesNotMatch(r.stdout, /launcher-api/);
}
{
	// An undecidable diff renders everything: the rule only ever skips, never widens.
	const r = cli(['--base', 'no-such-ref']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.written, /^render=true$/m);
	assert.match(r.written, /^reason=unknown$/m);
}
{
	// Against git for real: HEAD vs HEAD changes nothing.
	const r = cli(['--base', 'HEAD', '--head', 'HEAD']);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.written, /^render=false$/m);
	assert.match(r.written, /^reason=docs$/m);
}
{
	const r = spawnSync(process.execPath, [TOUCHED], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(r.status, 2, 'no arguments is a usage error');
}

console.log('touched.fixture: ok');
