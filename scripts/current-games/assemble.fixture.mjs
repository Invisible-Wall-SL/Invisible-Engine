// The compare's row rules (`lib/assemble.mjs`) and the plan's public-artifact rules
// (`lib/plan.mjs`), on synthetic render units — no browser, no R2.
//
//   node scripts/current-games/assemble.fixture.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PNG } from 'pngjs';

import { assembleReport } from './lib/assemble.mjs';
import { makePlan, unitId, unitsForShard } from './lib/plan.mjs';
import { digest, rowVerdict } from './lib/report.mjs';

let failures = 0;
const test = async (name, fn) => {
	try {
		await fn();
		console.log(`ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}\n     ${e.message}`);
	}
};

const tmp = mkdtempSync(join(tmpdir(), 'cg-assemble-'));
const TOLERANCE = {
	default: {
		maxDiffRatio: 0.001,
		blockSize: 16,
		blockThreshold: 0,
		threshold: 0.1,
		antiAliasing: 'count',
		masks: [],
	},
};

const png = (shade) => {
	const img = new PNG({ width: 32, height: 32 });
	img.data.fill(255);
	img.data[0] = shade;
	return PNG.sync.write(img);
};

/** One planned game rendered: `units[scenario][side]` is a result (screens: { name: shade }). */
function scenarioRun(name, units) {
	const dir = join(tmp, name);
	const scenarios = Object.keys(units);
	for (const scenario of scenarios)
		for (const side of ['base', 'head']) {
			const u = units[scenario][side];
			if (!u) continue;
			const id = unitId('g', scenario, side);
			mkdirSync(join(dir, 'units', id), { recursive: true });
			const screens = {};
			for (const [screen, shade] of Object.entries(u.screens ?? {})) {
				writeFileSync(join(dir, 'units', id, `${screen}.png`), png(shade));
				screens[screen] = { file: `${screen}.png`, frame: 1, screens: ['basegame'] };
			}
			writeFileSync(
				join(dir, 'units', id, 'result.json'),
				JSON.stringify({
					unit: { id },
					draw: 'last',
					screens,
					error: u.error,
					bootStopped: u.bootStopped,
					errors: u.errors ?? 0,
					stalls: u.stalls ?? 0,
					console: [],
					seconds: 1,
				}),
			);
		}
	const plan = {
		head: { sha: 'a'.repeat(40) },
		games: [
			{
				game: { key: 'g', name: 'G', gameType: 'lines' },
				script: 'lines',
				status: 'render',
				snapshot: { id: 's1' },
				notes: [],
				scenarios: scenarios.map((id) => ({ id })),
			},
		],
	};
	const out = join(dir, 'report');
	const report = assembleReport({ plan, unitDirs: [dir], out, tolerance: TOLERANCE, gates: false });
	return report.games[0];
}

const REFUSED = 'runtime bundle shape invalid (no assetBase / basegame scene)';
const refusal = { bootStopped: REFUSED, error: `the runtime refused to boot: ${REFUSED}` };

await test('identical captures on both sides pass', () => {
	const row = scenarioRun('same', {
		base: { base: { screens: { a: 1 } }, head: { screens: { a: 1 } } },
	});
	assert.equal(row.looks.status, 'same');
	assert.equal(rowVerdict(row), 'pass');
});

await test('the digest counts byte-identical screens and names one that passed under the threshold', () => {
	const row = scenarioRun('noise', {
		base: { base: { screens: { a: 1, b: 1 } }, head: { screens: { a: 1, b: 2 } } },
	});
	assert.equal(rowVerdict(row), 'pass');
	assert.match(
		digest({ games: [row] }),
		/^noise: 1 of 2 compared screen\(s\) byte-identical; passed under the colour threshold, not byte-identical: g\/b$/m,
	);
});

await test('one differing pixel fails the row, with a stable id', () => {
	const row = scenarioRun('changed', {
		base: { base: { screens: { a: 1 } }, head: { screens: { a: 200 } } },
	});
	assert.equal(row.looks.status, 'changed');
	assert.equal(rowVerdict(row), 'fail');
	assert.match(row.screens[0].id, /^a{40}:g:a:[0-9a-f]{16}$/);
});

await test('a unit with no result is the game error, never a pass', () => {
	const row = scenarioRun('missing', { base: { base: { screens: { a: 1 } } } });
	assert.equal(row.looks.status, 'error');
	assert.match(row.looks.detail, /no render came back for base\/head/);
	assert.equal(rowVerdict(row), 'fail');
});

await test("main failing a scenario is an error row that names main's failure", () => {
	const row = scenarioRun('base-fails', {
		base: { base: { error: 'step 1 (waitFor): not reached' }, head: { screens: { a: 1 } } },
	});
	assert.equal(row.looks.status, 'error');
	assert.match(row.looks.detail, /main's runtime failed this game too/);
	assert.equal(rowVerdict(row), 'fail');
});

await test('a snapshot both runtimes refuse in every scenario is a visible not-rendered row', () => {
	const row = scenarioRun('refused', {
		base: { base: refusal, head: refusal },
		'line-win': { base: refusal, head: refusal },
	});
	assert.equal(row.looks.status, 'refused');
	assert.equal(rowVerdict(row), null);
	assert.ok(row.notes.some((n) => n.includes('Republish the game')));
});

await test('a branch that refuses too but crashes doing it still fails', () => {
	const row = scenarioRun('refused-crashing', {
		base: { base: refusal, head: { ...refusal, errors: 3, stalls: 1 } },
		'line-win': { base: refusal, head: refusal },
	});
	assert.notEqual(row.looks.status, 'refused');
	assert.equal(row.tests.smoke.errors, 3);
	assert.equal(rowVerdict(row), 'fail');
});

await test('refusal reasons pair by scenario, not as a set', () => {
	const other = {
		bootStopped: 'another reason',
		error: 'the runtime refused to boot: another reason',
	};
	const row = scenarioRun('refused-swapped', {
		base: { base: refusal, head: other },
		'line-win': { base: other, head: refusal },
	});
	assert.notEqual(row.looks.status, 'refused');
	assert.equal(rowVerdict(row), 'fail');
});

await test('a branch that crashes where main refused still fails', () => {
	const row = scenarioRun('refused-then-crash', {
		base: { base: refusal, head: refusal },
		'line-win': { base: refusal, head: { error: 'TypeError: x is undefined', errors: 3 } },
	});
	assert.notEqual(row.looks.status, 'refused');
	assert.equal(rowVerdict(row), 'fail');
});

await test('a branch that boots a snapshot main refuses still fails', () => {
	const row = scenarioRun('refused-then-boots', {
		base: { base: refusal, head: { screens: { a: 1 } } },
	});
	assert.notEqual(row.looks.status, 'refused');
	assert.equal(rowVerdict(row), 'fail');
});

await test('every unit goes to exactly one shard, and every shard agrees', () => {
	const units = Array.from({ length: 57 }, (_, i) => ({
		id: `u${i}`,
		weight: (i * 37) % 300,
	}));
	for (const count of [1, 6, 20]) {
		const seen = new Map();
		for (let s = 1; s <= count; s++)
			for (const u of unitsForShard(units, s, count)) seen.set(u.id, (seen.get(u.id) ?? 0) + 1);
		assert.equal(seen.size, units.length, `${count} shards: every unit planned`);
		assert.ok(
			[...seen.values()].every((n) => n === 1),
			`${count} shards: no unit twice`,
		);
	}
	assert.deepEqual(unitsForShard(units, 3, 20), unitsForShard([...units].reverse(), 3, 20));
});

await test('the plan carries no contract, and a lookup error carries no secret', async () => {
	const secret = 'f'.repeat(64);
	process.env.PIPELINE_CI_TOKEN = secret;
	const manifest = {
		ok: { protocol: 'lines', readToken: 'tok', docBase: 'https://launcher', paytable: [1, 2] },
	};
	// A pointer key the plan refuses: its error quotes the key, as an SDK error quotes a host.
	const plan = await makePlan({
		games: [
			{ key: 'ok', name: 'OK', gameType: 'lines', local: { snapshot: '/tmp/x' } },
			{
				key: 'bad',
				name: 'Bad',
				gameType: 'lines',
				publishedPointerKey: `${secret}/../pointer.json`,
			},
		],
		manifest,
		only: null,
	});
	const bad = plan.games.find((g) => g.game.key === 'bad');
	assert.equal(bad.status, 'error');
	assert.match(bad.detail, /refusing pointer key/);
	assert.ok(!bad.detail.includes(secret), 'the lookup error carries the secret');
	const text = JSON.stringify(plan);
	assert.ok(
		!text.includes('readToken') && !text.includes('paytable'),
		'a contract reached the plan',
	);
	assert.match(plan.games.find((g) => g.game.key === 'ok').contractHash, /^[0-9a-f]{16}$/);
});

rmSync(tmp, { recursive: true, force: true });
if (failures) {
	console.error(`${failures} failure(s)`);
	process.exit(1);
}
console.log('current-games compare + plan: all checks pass');
