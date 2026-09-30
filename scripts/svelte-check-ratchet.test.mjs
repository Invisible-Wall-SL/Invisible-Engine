#!/usr/bin/env node
/**
 * Fixtures for scripts/svelte-check-ratchet.mjs. Run: node scripts/svelte-check-ratchet.test.mjs
 *
 * The gate's whole value is in two decisions — "did this run finish?" and "is anything new?" — so
 * those are what is pinned here, without running svelte-check itself.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { compare, parseMachineVerbose, shardOf, summarize } from './svelte-check-ratchet.mjs';

const ROOT = resolve('/repo');
const WS = resolve('/repo/apps/lines');
const diag = (filename, code, source = 'ts', type = 'ERROR', line = 3) =>
	`1727000000000 ${JSON.stringify({
		type,
		filename,
		start: { line, character: 1 },
		end: { line, character: 9 },
		message: `msg ${code}\nsecond line`,
		code,
		source,
	})}`;

// A run that never printed COMPLETED crashed (an OOM prints nothing on stdout) — never "clean".
assert.equal(parseMachineVerbose('1727000000000 START "/repo/apps/lines"\n', WS, ROOT), null);
assert.equal(
	parseMachineVerbose(`${diag('src/a.ts', 2307)}\n`, WS, ROOT),
	null,
	'errors without COMPLETED are still a crash',
);

// Errors only, repo-relative POSIX paths, `<source>:<code>` rules, first message line, 1-based line.
const out = [
	'1727000000000 START "/repo/apps/lines"',
	diag('src/a.ts', 2307),
	diag('src/a.ts', 2307, 'ts', 'ERROR', 9),
	diag('src/Board.svelte', 'a11y_click_events_have_key_events', 'svelte'),
	diag('src/b.ts', 6133, 'ts', 'WARNING'),
	diag('../../packages/pixi-svelte/src/x.ts', 2322),
	'not json {',
	'1727000000001 COMPLETED 120 FILES 4 ERRORS 1 WARNINGS 3 FILES_WITH_PROBLEMS',
].join('\r\n');
const errors = parseMachineVerbose(out, WS, ROOT);
assert.deepEqual(errors, [
	{ file: 'apps/lines/src/a.ts', rule: 'ts:2307', line: 4, message: 'msg 2307' },
	{ file: 'apps/lines/src/a.ts', rule: 'ts:2307', line: 10, message: 'msg 2307' },
	{
		file: 'apps/lines/src/Board.svelte',
		rule: 'svelte:a11y_click_events_have_key_events',
		line: 4,
		message: 'msg a11y_click_events_have_key_events',
	},
	{ file: 'packages/pixi-svelte/src/x.ts', rule: 'ts:2322', line: 4, message: 'msg 2322' },
]);

// A plain `.ts` file's diagnostic has no `source`; its numeric code is the compiler's.
const noSource = `1 ${JSON.stringify({ type: 'ERROR', filename: 'src/n.ts', start: { line: 0 }, message: 'm', code: 2352 })}`;
assert.equal(
	parseMachineVerbose(
		`${noSource}\n1 COMPLETED 1 FILES 1 ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS`,
		WS,
		ROOT,
	)[0].rule,
	'ts:2352',
);

// The printed errors must add up to COMPLETED's count, or the parser is missing some.
assert.throws(
	() =>
		parseMachineVerbose(
			`${diag('src/a.ts', 2307)}\n1 COMPLETED 1 FILES 2 ERRORS 0 WARNINGS 1 FILES_WITH_PROBLEMS`,
			WS,
			ROOT,
		),
	/reported 2 errors but printed 1/,
);

const current = summarize(errors);
assert.equal(current.errors, 4);
assert.deepEqual(Object.keys(current.byFile), [
	'apps/lines/src/Board.svelte',
	'apps/lines/src/a.ts',
	'packages/pixi-svelte/src/x.ts',
]);
assert.equal(current.byFile['apps/lines/src/a.ts']['ts:2307'], 2);

// Same errors → no movement.
let diff = compare(current, current);
assert.deepEqual([diff.increased, diff.decreased], [[], []]);

// One more of an existing (file, rule) is NEW even though the file and rule were both known.
const oneMore = summarize([...errors, { file: 'apps/lines/src/a.ts', rule: 'ts:2307' }]);
diff = compare(current, oneMore);
assert.deepEqual(diff.increased, [
	{ file: 'apps/lines/src/a.ts', rule: 'ts:2307', was: 2, now: 3 },
]);

// A brand-new file, and a new rule in a known file, are both NEW.
diff = compare(
	current,
	summarize([
		...errors,
		{ file: 'apps/lines/src/new.ts', rule: 'ts:2304' },
		{ file: 'apps/lines/src/a.ts', rule: 'ts:2345' },
	]),
);
assert.deepEqual(
	diff.increased.map((d) => `${d.file} ${d.rule}`),
	['apps/lines/src/a.ts ts:2345', 'apps/lines/src/new.ts ts:2304'],
);

// An error that MOVED to another file is new there even though the total held: the total alone
// would pass this.
diff = compare(
	current,
	summarize([...errors.slice(0, 3), { file: 'apps/lines/src/c.ts', rule: 'ts:2322' }]),
);
assert.equal(diff.now, diff.was);
assert.deepEqual(diff.increased, [
	{ file: 'apps/lines/src/c.ts', rule: 'ts:2322', was: 0, now: 1 },
]);
assert.deepEqual(diff.decreased, [
	{ file: 'packages/pixi-svelte/src/x.ts', rule: 'ts:2322', was: 1, now: 0 },
]);

// Fewer errors → decreased only (the gate passes and asks for the baseline to be lowered).
diff = compare(current, summarize(errors.slice(1)));
assert.deepEqual(diff.increased, []);
assert.deepEqual(diff.decreased, [
	{ file: 'apps/lines/src/a.ts', rule: 'ts:2307', was: 2, now: 1 },
]);
assert.deepEqual([diff.was, diff.now], [4, 3]);

// A package with no baseline entry yet: every error is new.
diff = compare(undefined, current);
assert.equal(diff.increased.length, 3);
assert.equal(diff.was, 0);

// Shards cover every package exactly once, and the two heavy apps never share one.
const pkgs = ['apps/cluster', 'apps/launcher-api', 'apps/lines', 'packages/a', 'packages/b'];
const shards = [shardOf(pkgs, 1, 2), shardOf(pkgs, 2, 2)];
assert.deepEqual(shards.flat().sort(), [...pkgs].sort());
assert.ok(!shards.some((s) => s.includes('apps/lines') && s.includes('apps/launcher-api')));
assert.deepEqual(shardOf(pkgs, 1, 1), pkgs);

console.log('svelte-check-ratchet: all fixtures pass');
