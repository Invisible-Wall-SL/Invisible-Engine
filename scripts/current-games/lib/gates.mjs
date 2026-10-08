// A game's own tests, by game type (ADR-0004 §7): the `check:*` gates that cover what that type
// ships, run once per type against the branch. Every type also gets the runtime-wide gates the
// runtime release itself is gated on. The scriptable smoke is the screen script: a game that does
// not boot, spin and settle, or that logs an error or stalls on I/O, fails its row.
//
//   node scripts/current-games/lib/gates.mjs <out.json>   run every type's gates once, for CI's
//                                                          compare to read (`run.mjs --gates-file`)

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../../..');

/** The release gates of `runtime-release.yml`, plus the money/protocol fixtures each type relies on. */
const RUNTIME = ['check:undefined-names', 'check:engine-game', 'check:stake', 'check:resume'];
const BY_TYPE = {
	lines: ['check:freespins', 'check:lines-scatter-paytable', 'check:paytable'],
	ways: ['check:ways', 'check:freespins'],
	cluster: ['check:cluster', 'check:freespins'],
	scatter: ['check:scatter', 'check:freespins'],
	bookOf: ['check:book-paytable', 'check:pots-overlay', 'check:bonus-modes', 'check:buy-cost'],
	holdAndWin: ['check:holdandwin', 'check:bonus-modes'],
};

export const gatesFor = (script) => [...RUNTIME, ...(BY_TYPE[script] ?? BY_TYPE.lines)];

/** Every gate any type runs; `touched.mjs`'s fixture checks each reads only runtime inputs. */
export const ALL_GATES = [...new Set([...RUNTIME, ...Object.values(BY_TYPE).flat()])];

const results = new Map();

/** Use results another job already ran (`<out.json>` of the CLI below) instead of re-running. */
export function loadGateResults(file) {
	for (const r of JSON.parse(readFileSync(file, 'utf8'))) results.set(r.gate, r);
}

/** Run (once per process) and return `{ gate, pass, seconds, tail }`. */
export function runGate(gate) {
	if (results.has(gate)) return results.get(gate);
	const started = Date.now();
	const r = spawnSync('pnpm', ['--silent', gate], {
		cwd: ROOT,
		encoding: 'utf8',
		shell: process.platform === 'win32',
		maxBuffer: 64 * 1024 * 1024,
	});
	const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
	const result = {
		gate,
		pass: r.status === 0,
		seconds: (Date.now() - started) / 1000,
		tail: r.status === 0 ? undefined : out.split('\n').slice(-30).join('\n'),
	};
	results.set(gate, result);
	return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const out = process.argv[2];
	if (!out) {
		console.error('usage: gates.mjs <out.json>');
		process.exit(2);
	}
	const all = ALL_GATES.map((gate) => {
		const r = runGate(gate);
		console.log(`[current-games] ${r.pass ? 'pass' : 'FAIL'} ${gate} (${r.seconds.toFixed(1)} s)`);
		return r;
	});
	writeFileSync(out, JSON.stringify(all, null, '\t'));
}
