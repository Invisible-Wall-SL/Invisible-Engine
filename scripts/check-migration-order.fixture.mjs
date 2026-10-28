// Offline fixture for scripts/check-migration-order.mjs.
//
//   node scripts/check-migration-order.fixture.mjs
//
// The case it exists for is the 9F/9G one: two PRs each generate a migration, and the one generated
// second (newer `when`) merges first. Its journal then reads in order, yet the other's older `when`
// would be skipped by a database that already applied the base.

import assert from 'node:assert/strict';
import { journalProblems } from './check-migration-order.mjs';

let checks = 0;
const ok = (label, fn) => {
	fn();
	checks++;
	console.log(`  ✓ ${label}`);
};
const entry = (idx, when, tag = `${String(idx).padStart(4, '0')}_m${idx}`) => ({ idx, when, tag });
const journal = (...entries) => ({ entries });

const base = journal(entry(0, 100), entry(1, 200));

ok('a well-formed journal with a newer migration passes', () => {
	assert.deepEqual(journalProblems(journal(...base.entries, entry(2, 300)), base), []);
});
ok('no base: only the shape is checked', () => {
	assert.deepEqual(journalProblems(base, null), []);
});
ok(
	'the 9F/9G case: a new migration older than the base newest fails, though the journal is in order',
	() => {
		const baseWith35 = journal(...base.entries, entry(2, 350, '0035_repair'));
		const head = journal(
			...base.entries,
			entry(2, 340, '0034_family'),
			entry(3, 350, '0035_repair'),
		);
		const problems = journalProblems(head, baseWith35);
		assert.equal(problems.length, 1);
		assert.match(problems[0], /0034_family is older .* than 0035_repair/);
	},
);
ok('regenerated on top of the base, it passes', () => {
	const baseWith35 = journal(...base.entries, entry(2, 350, '0035_repair'));
	const head = journal(...base.entries, entry(2, 350, '0035_repair'), entry(3, 360, '0036_family'));
	assert.deepEqual(journalProblems(head, baseWith35), []);
});
ok('an applied migration that disappears fails', () => {
	assert.match(
		journalProblems(journal(entry(0, 100)), base).join('\n'),
		/0001_m1 is on the base but gone/,
	);
});
ok('a `when` that does not increase fails', () => {
	assert.match(journalProblems(journal(entry(0, 100), entry(1, 100)), null)[0], /is not after/);
});
ok('an idx gap fails', () => {
	assert.match(
		journalProblems(journal(entry(0, 100), entry(2, 200)), null)[0],
		/has idx 2, expected 1/,
	);
});
ok('a tag with no .sql fails', () => {
	assert.match(journalProblems(base, null, (tag) => tag !== '0001_m1')[0], /no 0001_m1\.sql/);
});

console.log(`check-migration-order.fixture — ${checks} claims hold`);
