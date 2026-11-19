// The parts of check:runtime-bytes that decide without building: which push is a verified base, which
// paths reach a runtime, what a manifest holds and how two differ.
//
//   node scripts/check-runtime-bytes.fixture.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	BUILD_STEP,
	diffManifests,
	lastVerifiedMain,
	manifestOf,
	runtimeChanges,
} from './check-runtime-bytes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, fn) => {
	try {
		fn();
		console.log(`✓ ${name}`);
	} catch (e) {
		failures++;
		console.error(`✗ ${name}\n  ${e.message.split('\n')[0]}`);
	}
};

const built = [{ name: BUILD_STEP, conclusion: 'success' }];
const skipped = [{ name: BUILD_STEP, conclusion: 'skipped' }];

check(
	'a cancelled engine push and a skipped push after it are not bases (main, 2026-11-18)',
	() => {
		// 05d51dd10 (#1747, engine) cancelled by a386c88b9, cancelled by 371323b38 (launcher), which
		// skipped its builds: the base for the next push must be the last run that built.
		const runs = [
			{ headSha: '371323b38', conclusion: 'success', steps: skipped },
			{ headSha: 'a386c88b9', conclusion: 'cancelled', steps: [] },
			{ headSha: '05d51dd10', conclusion: 'cancelled', steps: [] },
			{ headSha: 'c337ac20c', conclusion: 'success', steps: skipped },
			{ headSha: 'fa757184b', conclusion: 'success', steps: built },
		];
		assert.equal(lastVerifiedMain(runs), 'fa757184b');
	},
);

check('a failed build is not a base', () => {
	const runs = [
		{ headSha: 'b', conclusion: 'failure', steps: [{ name: BUILD_STEP, conclusion: 'failure' }] },
		{ headSha: 'a', conclusion: 'success', steps: built },
	];
	assert.equal(lastVerifiedMain(runs), 'a');
});

check('no verified run means no base (the caller builds)', () => {
	assert.equal(
		lastVerifiedMain([{ headSha: 'a', conclusion: 'success', steps: skipped }]),
		undefined,
	);
});

check('the workflow still names the build step the base search looks for', () => {
	const workflow = readFileSync(join(ROOT, '.github/workflows/runtime-bytes.yml'), 'utf8');
	assert.ok(workflow.includes(`- name: ${BUILD_STEP}\n`), BUILD_STEP);
});

check('runtime paths: engine, lockfile, the gate; not docs, launcher or Markdown', () => {
	assert.deepEqual(
		runtimeChanges([
			'apps/lines/src/game/online.ts',
			'packages/engine-3d/src/world.ts',
			'pnpm-lock.yaml',
			'scripts/runtime-bytes/lines.json',
			'packages/engine-3d/README.md',
			'apps/launcher-api/src/lib/roles.ts',
			'docs/status/3d.md',
		]),
		[
			'apps/lines/src/game/online.ts',
			'packages/engine-3d/src/world.ts',
			'pnpm-lock.yaml',
			'scripts/runtime-bytes/lines.json',
		],
	);
});

const dir = mkdtempSync(join(tmpdir(), 'runtime-bytes-fixture-'));
try {
	const put = (path, body) => {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), body);
	};
	put('index.html', '<script src="./_app/immutable/bundle.AAAAAAAA.js"></script>');
	put('_app/immutable/bundle.AAAAAAAA.js', 'code');
	put('_app/immutable/bundle.AAAAAAAA.js.map', '{}');
	put('assets/audio/spin.mp3', 'sound');
	put('_app/version.json', '{"version":"reproducible"}');

	const before = manifestOf(dir);
	check(
		'code is listed with its gzip size, every other file by hash, source maps by neither',
		() => {
			assert.deepEqual(Object.keys(before.files), [
				'_app/immutable/bundle.AAAAAAAA.js',
				'index.html',
			]);
			assert.deepEqual(Object.keys(before.other), ['_app/version.json', 'assets/audio/spin.mp3']);
			assert.equal(before.total.files, 2);
		},
	);

	put('assets/audio/spin.mp3', 'louder');
	put('assets/models/cube.glb', 'mesh');
	check('a changed or added static file fails the gate, by name', () => {
		assert.deepEqual(diffManifests(before, manifestOf(dir)), [
			'changed assets/audio/spin.mp3',
			'added   assets/models/cube.glb',
		]);
	});

	check('a source map alone changes nothing', () => {
		const now = manifestOf(dir);
		put('_app/immutable/bundle.AAAAAAAA.js.map', '{"changed":true}');
		assert.deepEqual(diffManifests(now, manifestOf(dir)), []);
	});
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nruntime-bytes fixture ok');
