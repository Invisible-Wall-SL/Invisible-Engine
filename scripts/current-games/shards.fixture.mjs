// How the render units are split across the workflow's shards (`unitsForShard`, `weightOf` in
// `lib/plan.mjs`), on the real `costs.json` and the workflow's own `SHARDS` / matrix / timeout.
// A render shard past its `timeout-minutes` is cancelled and fails the PR with no screen changed
// (run 43370261063, 2026-11-13: a runner twice as slow, shard 1 of 8 at 45 min).
//
//   node scripts/current-games/shards.fixture.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COSTS_FILE, unitsForShard, weightOf } from './lib/plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(ROOT, '.github/workflows/current-games.yml'), 'utf8');
const SHARDS = Number(/^ {2}SHARDS: (\d+)$/m.exec(workflow)?.[1]);
const matrix = /^ {8}shard: \[([\d, ]+)\]$/m.exec(workflow)?.[1].split(',').map(Number);
const renderBlock = workflow.slice(workflow.indexOf('\n  render:'));
const TIMEOUT = Number(/timeout-minutes: (\d+)/.exec(renderBlock)?.[1]);
const costs = JSON.parse(readFileSync(COSTS_FILE, 'utf8')).seconds;

/** A render unit per side of each scenario in the table, as the plan makes them. */
const units = Object.entries(costs).flatMap(([scenario, weight]) =>
	['base', 'head'].map((side) => ({ id: `${scenario.replace('/', '--')}--${side}`, weight })),
);
const loads = (count) =>
	Array.from({ length: count }, (_, i) =>
		unitsForShard(units, i + 1, count).reduce((t, u) => t + u.weight, 0),
	);

let failures = 0;
const test = (name, fn) => {
	try {
		fn();
		console.log(`ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`FAIL ${name}\n     ${e.message}`);
	}
};

test('the workflow names one matrix entry per shard, 1..SHARDS', () => {
	assert.ok(SHARDS > 0 && TIMEOUT > 0, 'SHARDS and the render timeout are read');
	assert.deepEqual(
		matrix,
		Array.from({ length: SHARDS }, (_, i) => i + 1),
	);
});

test('the heaviest shard stays near the mean of the cost table', () => {
	const l = loads(SHARDS);
	const mean = l.reduce((a, b) => a + b, 0) / SHARDS;
	assert.ok(
		Math.max(...l) <= mean * 1.1,
		`heaviest ${Math.max(...l)} s against a mean of ${mean.toFixed(0)} s`,
	);
});

test('a runner twice as slow still finishes inside the timeout, with room to set up', () => {
	const slowest = (Math.max(...loads(SHARDS)) * 2) / 60;
	assert.ok(
		slowest <= TIMEOUT * 0.7,
		`${slowest.toFixed(1)} min on a runner twice as slow, against ${TIMEOUT} min`,
	);
});

test('no single unit is a large share of the timeout, so a pair of them can still be packed', () => {
	assert.ok(Math.max(...Object.values(costs)) * 2 <= TIMEOUT * 60 * 0.25);
});

test('a scenario the table does not list gets the heuristic weight, a listed one its measurement', () => {
	const sc = (id, canary = false) => ({ id, canary });
	assert.equal(weightOf('never-seen', sc('base', true)), 300);
	assert.equal(weightOf('never-seen', sc('big-wins')), 130);
	assert.equal(weightOf('never-seen', sc('free-spins')), 60);
	assert.equal(weightOf('never-seen', sc('line-win')), 25);
	assert.equal(weightOf('test6', sc('base', true)), costs['test6/base']);
});

test('the same units split the same way in any order, every unit once', () => {
	const seen = new Map();
	for (let s = 1; s <= SHARDS; s++)
		for (const u of unitsForShard([...units].reverse(), s, SHARDS))
			seen.set(u.id, (seen.get(u.id) ?? 0) + 1);
	assert.equal(seen.size, units.length);
	assert.ok([...seen.values()].every((n) => n === 1));
	assert.deepEqual(unitsForShard(units, 2, SHARDS), unitsForShard([...units].reverse(), 2, SHARDS));
});

test('the heavy bases are in the table at what they took on 2026-11-13, not the 2026-10-05 figure', () => {
	// The heavy bases and what they took on a normal runner (run 43370196307); the table the plan had
	// before this guard held 42 s, 56 s and 303 s for the first two and the last.
	const took = { 'bookofborutpartner/base': 188, 'bookofborutremake/base': 136, 'test6/base': 156 };
	for (const [k, s] of Object.entries(took))
		assert.ok(costs[k] >= s * 0.9, `${k}: table ${costs[k]} s, measured ${s} s on a normal runner`);
});

if (failures) {
	console.error(`${failures} failure(s)`);
	process.exit(1);
}
