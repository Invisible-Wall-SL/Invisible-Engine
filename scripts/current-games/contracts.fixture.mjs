// The renders deal from the mock contracts the plan pinned, frozen beside `plan.json`, never from a
// second read of `test_server/games.json`: the launcher rewrites that one live key on every publish,
// and a publish landing between the plan and a shard's read failed the game on both sides (runs
// 37788159984 and 37807647398, 2026-10-08). This proves the frozen copy outlives a rewrite, matches
// the plan's hashes, and never reaches the public plan artifact in the clear.
//
//   node scripts/current-games/contracts.fixture.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { CONTRACTS_FILE, openContracts, sealContracts, writeContracts } from './lib/contracts.mjs';
import { contractHash } from './lib/plan.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SECRET = 'f'.repeat(64);
const MARKER = 'paytable-marker-7c1e';

// ---- sealing ----

const contracts = { g1: { protocol: 'lines', name: 'G1', paytable: MARKER } };
const sealed = sealContracts(contracts, SECRET);
assert.ok(!sealed.includes(MARKER), 'a sealed file does not carry the contract in the clear');
assert.deepEqual(openContracts(sealed, SECRET), contracts, 'it opens with the same secret');
assert.notEqual(sealContracts(contracts, SECRET), sealed, 'each seal is salted afresh');
assert.throws(() => openContracts(sealed, 'e'.repeat(64)), /does not open with this run's/);
assert.throws(() => openContracts(sealed, undefined), /is sealed and .* is not set/);
const tampered = JSON.parse(sealed);
tampered.sealed.data = Buffer.from('x'.repeat(40)).toString('base64');
assert.throws(() => openContracts(JSON.stringify(tampered), SECRET), /does not open/);
assert.deepEqual(openContracts(sealContracts(contracts, undefined), undefined), contracts);

const dir = mkdtempSync(join(tmpdir(), 'cg-contracts-'));
try {
	const saved = process.env.CURRENT_GAMES_R2_SECRET_ACCESS_KEY;
	delete process.env.CURRENT_GAMES_R2_SECRET_ACCESS_KEY;
	assert.throws(
		() => writeContracts(dir, contracts, { fromR2: true }),
		/refusing to write live mock contracts unsealed/,
	);
	if (saved !== undefined) process.env.CURRENT_GAMES_R2_SECRET_ACCESS_KEY = saved;

	// ---- the plan phase freezes what it hashed; a rewrite after it changes nothing ----

	const games = [
		{ key: 'race', name: 'Race', gameType: 'lines', local: { snapshot: join(dir, 'snap') } },
	];
	const entry = {
		protocol: 'lines',
		name: 'Race',
		paytable: MARKER,
		updatedAt: '2026-10-08T09:00Z',
	};
	writeFileSync(join(dir, 'games.json'), JSON.stringify({ games }));
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ games: { race: entry } }));
	const planOut = join(dir, 'plan');
	const run = spawnSync(
		process.execPath,
		[
			'scripts/current-games/run.mjs',
			'--phase',
			'plan',
			'--games-file',
			join(dir, 'games.json'),
			'--manifest-file',
			join(dir, 'manifest.json'),
			'--typekit',
			'network',
			'--out',
			planOut,
			'--cache',
			join(dir, 'cache'),
		],
		{
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...process.env, CURRENT_GAMES_R2_SECRET_ACCESS_KEY: SECRET },
		},
	);
	assert.equal(run.status, 0, run.stderr || run.stdout);
	const plan = JSON.parse(readFileSync(join(planOut, 'plan.json'), 'utf8'));
	const frozen = readFileSync(join(planOut, CONTRACTS_FILE), 'utf8');
	for (const [name, text] of [
		['plan.json', JSON.stringify(plan)],
		[CONTRACTS_FILE, frozen],
	])
		assert.ok(!text.includes(MARKER), `${name} does not carry the contract in the clear`);

	// A publish rewrites the live manifest after the plan (the 2026-10-08 race).
	writeFileSync(
		join(dir, 'manifest.json'),
		JSON.stringify({ games: { race: { ...entry, updatedAt: '2026-10-08T09:07Z' } } }),
	);
	const opened = openContracts(frozen, SECRET);
	assert.equal(
		contractHash(opened.race),
		plan.games.find((p) => p.game.key === 'race').contractHash,
		'the frozen contract is the one the plan hashed, whatever the manifest says now',
	);
	assert.equal(opened.race.updatedAt, '2026-10-08T09:00Z');
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log('contracts.fixture: ok');
