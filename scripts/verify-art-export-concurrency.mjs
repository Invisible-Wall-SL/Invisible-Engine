// Offline fixture for the CONCURRENT art export (game-maker open item 6).
//
//   node scripts/verify-art-export-concurrency.mjs
//
// WHY THIS EXISTS. `/api/editor/runtime` re-runs every exporter on the READ path, and profiling
// `test6` on 2026-09-21 put `art` at 90.2s of a 93.3s assemble — `art:manifests` alone was 50.3s
// for 41 sheets. None of it is compute: each sheet makes ~4-5 SEQUENTIAL R2 round-trips, so the
// exporter spent the whole time waiting on the network one request at a time. The fix runs those
// sheets through `mapWithConcurrency`.
//
// Turning a sequential loop that WRITES SHIPPED GAME ART into a concurrent one is exactly the kind
// of change whose failures are silent and data-shaped, so the three properties the export now leans
// on are asserted here rather than assumed:
//
//   1. ORDER — results come back in INPUT order however they interleave. The export builds its
//      index from them, so a completion-ordered result would make an unchanged project assemble to
//      different bytes each time.
//   2. BOUNDED WIDTH — never more than `limit` tasks in flight. The launcher already OOMs during
//      bake and each art task can hold a full atlas page and KTX2-encode it, so an unbounded fan
//      out trades a slow assemble for a dead container.
//   3. IT ACTUALLY OVERLAPS — a width of N runs N-at-a-time, not one-at-a-time. Without this the
//      whole change is a no-op that still looks correct.
//
// Plus the property the CALLER depends on: a stem is claimed in the same synchronous tick as its
// collision check, so two sheets can never both take `foo` and write to `editor-art/foo/`.
//
// HOW IT RUNS THE REAL SOURCE. `mapWithConcurrency` is imported from the shipped module (Node >= 22
// strips the types); nothing below re-implements it.

import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../apps/launcher-api/src/lib/server/concurrency.ts';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, fn) => {
	try {
		fn();
		console.log(`  ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`  FAIL ${name}\n       ${e.message}`);
	}
};

console.log('1. results come back in INPUT order, not completion order');
{
	// Reverse-graded delays: the LAST item finishes first. A push-as-you-go implementation would
	// return the exact reverse of the input here, so this is the assertion that catches it.
	const items = [0, 1, 2, 3, 4, 5, 6, 7];
	const out = await mapWithConcurrency(items, 4, async (n) => {
		await sleep((items.length - n) * 12);
		return `v${n}`;
	});
	check('order preserved under reversed completion', () =>
		assert.deepEqual(
			out,
			items.map((n) => `v${n}`),
		),
	);
	check('one result per input', () => assert.equal(out.length, items.length));
}

console.log('2. concurrency is BOUNDED and every item runs exactly once');
{
	for (const limit of [1, 3, 6, 50]) {
		let live = 0;
		let peak = 0;
		const seen = [];
		const items = Array.from({ length: 20 }, (_, i) => i);
		await mapWithConcurrency(items, limit, async (n) => {
			live++;
			peak = Math.max(peak, live);
			await sleep(5);
			seen.push(n);
			live--;
		});
		check(`limit ${limit}: peak in-flight <= limit`, () =>
			assert.ok(peak <= limit, `peak ${peak}`),
		);
		check(`limit ${limit}: every item ran exactly once`, () =>
			assert.deepEqual(
				[...seen].sort((a, b) => a - b),
				items,
			),
		);
	}
}

console.log('3. it genuinely overlaps (the point of the change)');
{
	const items = Array.from({ length: 12 }, (_, i) => i);
	const started = Date.now();
	await mapWithConcurrency(items, 6, () => sleep(40));
	const elapsed = Date.now() - started;
	// 12 x 40ms sequential = 480ms; at width 6 it is 2 waves ~= 80ms. A generous ceiling still
	// fails loudly if the helper degrades to one-at-a-time.
	check('width 6 over 12 tasks is far faster than sequential', () =>
		assert.ok(elapsed < 300, `took ${elapsed}ms, sequential would be ~480ms`),
	);
}

console.log('4. edge cases');
{
	check('empty input returns empty', async () =>
		assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []),
	);
	const one = await mapWithConcurrency(['x'], 8, async (v) => v.toUpperCase());
	check('limit larger than the input is clamped, not spun', () => assert.deepEqual(one, ['X']));
	let rejected = false;
	try {
		await mapWithConcurrency([1, 2, 3], 2, async (n) => {
			if (n === 2) throw new Error('boom');
			await sleep(5);
		});
	} catch (e) {
		rejected = e.message === 'boom';
	}
	check('a failing task rejects the whole map (a partial export is a broken bundle)', () =>
		assert.ok(rejected),
	);
}

console.log('5. the stem claim is synchronous — two sheets can never take the same name');
{
	// The shape of `exportManifest`'s stem block, with the await that used to sit between the
	// collision check and the claim. Run both orderings through the same interleaving.
	const run = async (claimBeforeAwait) => {
		const usedStems = new Set();
		const taken = [];
		const exportOne = async (base) => {
			let stem = base;
			for (let i = 2; usedStems.has(stem); i++) stem = `${base}_${i}`;
			if (claimBeforeAwait) usedStems.add(stem);
			await sleep(10); // sheetVersion / pageStore.ensure
			if (!claimBeforeAwait) usedStems.add(stem);
			taken.push(stem);
		};
		await Promise.all([exportOne('foo'), exportOne('foo'), exportOne('foo')]);
		return taken;
	};
	const broken = await run(false);
	const fixed = await run(true);
	check('the OLD claim-after-await order really does collide (the bug is real)', () =>
		assert.ok(new Set(broken).size < broken.length, `expected a collision, got ${broken}`),
	);
	check('claiming before the await gives three distinct stems', () =>
		assert.deepEqual([...fixed].sort(), ['foo', 'foo_2', 'foo_3']),
	);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
