// The harness renders each game on the runtime id its publish would pick (`lib/runtimes.mjs`): a
// kind maps to its family's id, a checkout from before the family seams serves every id from one
// `lines` build, and a side's folder resolves an id through its `runtimes.json` (a folder without
// one is a single plain build).
//
//   node scripts/current-games/runtimes.fixture.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RUNTIME_IDS } from '../../packages/constants-shared/runtimes.ts';
import { runtimeDirFor, runtimeFolders, runtimeIdFor } from './lib/runtimes.mjs';

const ROOT = join(import.meta.dirname, '../..');
const tmp = mkdtempSync(join(tmpdir(), 'cg-runtimes-'));
try {
	for (const kind of ['lines', 'ways', 'cluster', 'scatter', 'bookOf', 'holdAndWin', 'custom-x'])
		assert.equal(runtimeIdFor(kind), 'lines', kind);
	for (const kind of ['match3', 'arcade', 'card']) assert.equal(runtimeIdFor(kind), kind, kind);

	assert.deepEqual(
		runtimeFolders(ROOT, RUNTIME_IDS),
		Object.fromEntries(RUNTIME_IDS.map((id) => [id, id])),
		'a checkout with the seams builds each id',
	);
	const old = join(tmp, 'old');
	mkdirSync(old);
	assert.deepEqual(
		runtimeFolders(old, ['lines', 'arcade']),
		Object.fromEntries(RUNTIME_IDS.map((id) => [id, 'lines'])),
		'a checkout from before the seams serves every id from lines, whichever ids were asked for',
	);

	const side = join(tmp, 'side');
	mkdirSync(side);
	writeFileSync(join(side, 'runtimes.json'), JSON.stringify({ lines: 'lines', arcade: 'lines' }));
	assert.equal(runtimeDirFor(side, 'arcade'), join(side, 'lines'));
	assert.throws(() => runtimeDirFor(side, 'card'), /no card runtime/);
	const plain = join(tmp, 'plain');
	mkdirSync(plain);
	assert.equal(runtimeDirFor(plain, 'card'), plain, 'a plain build serves every id');
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
console.log('runtimes: every game renders on the id its publish would pick');
