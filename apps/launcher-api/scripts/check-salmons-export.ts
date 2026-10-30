/**
 * `scripts/salmons/export.mjs` writes the documents a person uploads to the `salmons` project. The
 * launcher only finds them at its own keys (`projectComponentKey` lowercases `salmonsBear` to
 * `salmonsbear`), so this runs the export and holds every key it writes to the launcher's, and the
 * export's copy of `r2Slug` to the launcher's.
 *
 * Run: pnpm --filter launcher-api check:salmons-export
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SALMONS_CHARACTER_COMPONENTS } from '../../../packages/engine-layout/src/lib/referenceLayouts/salmons';
import { r2Slug as exportSlug } from '../../../scripts/salmons/r2Slug.mjs';
import {
	editorDocKey,
	flowV2DocKey,
	gameConfigDocKey,
	projectComponentKey,
	r2Slug,
} from '../src/lib/server/projectPaths';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
	if (ok) passed += 1;
	else {
		failed += 1;
		console.error(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
	}
};

for (const name of [
	'salmonsBear',
	'salmons',
	'Invisible Wall',
	'my-game',
	'ÀÉ',
	'',
	'x'.repeat(80),
]) {
	check(`r2Slug(${JSON.stringify(name)}) is the launcher's`, exportSlug(name) === r2Slug(name));
}

const files = (dir: string): string[] =>
	readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? files(path) : [relative(out, path)];
	});

const out = mkdtempSync(join(tmpdir(), 'salmons-export-'));
try {
	execFileSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			'--import',
			'./scripts/ts-loader.mjs',
			'scripts/salmons/export.mjs',
			'--out',
			out,
		],
		{ cwd: root, stdio: 'pipe' },
	);
	const written = new Set(files(out).map((path) => path.split('\\').join('/')));
	const client = 'invisible_wall';
	const project = 'salmons';
	const expected = [
		gameConfigDocKey(client, project),
		editorDocKey(client, project),
		flowV2DocKey(client, project),
		...SALMONS_CHARACTER_COMPONENTS.map((def) => projectComponentKey(project, def.id)),
	];
	for (const key of expected)
		check(`the export writes ${key}`, written.has(key), [...written].join(', '));
	check(
		'the export writes nothing else',
		written.size === expected.length,
		[...written].filter((key) => !expected.includes(key)).join(', '),
	);
	check(
		'a component key is the lowercased id (salmonsBear → salmonsbear)',
		SALMONS_CHARACTER_COMPONENTS.some((def) => def.id !== def.id.toLowerCase()) &&
			[...written].every((key) => key === key.toLowerCase()),
	);
} finally {
	rmSync(out, { recursive: true, force: true });
}

console.log(`check:salmons-export — ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
