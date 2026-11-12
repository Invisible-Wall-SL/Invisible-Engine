// @ts-nocheck — a Node script inside a browser app; its tsconfig has no Node types, so checking it
// only adds noise to the app's svelte-check.
/**
 * Offline fixture: `Symbol.svelte` keeps its Element FX `gate` connected, so the reads its art makes
 * from Pixi's ticker do not run `ownArt` and `waitsForFx` again each time:
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/symbolGate.fixture.mjs
 *
 * Why: a symbol with Element FX reports its art's completion through `gate` (`stateFxGate`), read
 * from a rig's `complete` (every frame for a looping still) and nowhere reactive. Svelte leaves a
 * derived nothing reactive reads unconnected, and runs an unconnected derived's inputs again on each
 * read once anything they read has changed, even to the same value: on `bookofborutremake`'s spins,
 * ~14 runs of `ownArt` and `waitsForFx` a frame in WebKitGTK (`docs/status/engine.md`, 2026-11-12).
 *
 * Pins, in Svelte's client runtime, with a module shaped like `Symbol`'s gate:
 *   - read only from outside a reaction, once an input of `ownArt` has changed to the same value,
 *     every read runs it again (the control: what the effect is for);
 *   - with `Symbol`'s effect, the same reads run nothing;
 *   - either way: the same gate while nothing changes, a new one when the state changes, the same
 *     reports from the same calls;
 * and in the source: `Symbol.svelte` reads `gate` in an effect while it has Element FX.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stateFxGate } from './stateFxGate.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { compileModule } = require('svelte/compiler');
const svelteRoot = require.resolve('svelte/package.json').replace(/package\.json$/, '');
const client = (path) => pathToFileURL(`${svelteRoot}${path}`).href;

// `Symbol`'s chain: `ownArt` reads the art symbol (a new object with the same name when its label
// moves) and the state; `gate` is made from it, the FX wait and the state.
const source = `
	export function probe(connect, stateFxGate) {
		let state = $state('static');
		let art = $state({ name: 'A' });
		let fx = $state(true);
		const counts = { ownArt: 0, waits: 0, gates: 0, reports: 0 };
		const waitsForFx = $derived.by(() => {
			counts.waits += 1;
			return fx && state === 'win';
		});
		const ownArt = $derived.by(() => {
			counts.ownArt += 1;
			return art.name !== 'none' && state !== 'explosion';
		});
		const gate = $derived.by(() => {
			void state;
			counts.gates += 1;
			const visit = stateFxGate(waitsForFx, ownArt, () => {
				if (visit === gate) counts.reports += 1;
			});
			return visit;
		});
		const stop = $effect.root(() => {
			if (connect)
				$effect.pre(() => {
					if (fx) void gate;
				});
		});
		return {
			complete() { gate.art(); },
			fxDone() { gate.fx(); },
			gate: () => gate,
			setState(value) { state = value; },
			touchArt() { art = { name: art.name }; },
			counts,
			stop,
		};
	}`;
const { js } = compileModule(source, { filename: 'symbolGateProbe.svelte.js' });
// Svelte's CLIENT runtime (Node's own resolution picks the server one).
const code = js.code.replace(
	/(from |import )'svelte\/internal\/([^']+)'/g,
	(_m, lead, rest) =>
		`${lead}'${client(`src/internal/${rest === 'client' ? 'client/index.js' : `${rest}.js`}`)}'`,
);
const { probe } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
const { flushSync } = await import(client('src/index-client.js'));

const play = (connect) => {
	const p = probe(connect, stateFxGate);
	flushSync();
	const first = p.gate();
	p.touchArt();
	flushSync();
	const before = { ownArt: p.counts.ownArt, waits: p.counts.waits };
	for (let i = 0; i < 10; i++) p.complete();
	const reruns = p.counts.ownArt - before.ownArt + (p.counts.waits - before.waits);
	const kept = p.gate() === first;
	const reportsAtRest = p.counts.reports;
	p.setState('win');
	flushSync();
	const won = p.gate();
	p.complete();
	const beforeFx = p.counts.reports;
	p.fxDone();
	const afterFx = p.counts.reports;
	p.complete();
	p.stop();
	return {
		reruns,
		kept,
		reportsAtRest,
		newOnState: won !== first,
		heldForFx: beforeFx === reportsAtRest,
		reportedOnFx: afterFx === beforeFx + 1,
		reports: p.counts.reports,
		gates: p.counts.gates,
	};
};

console.log('read from outside a reaction');
const control = play(false);
check(
	'unconnected: each of ten reads runs the inputs again (the control)',
	control.reruns >= 10,
	JSON.stringify(control),
);
const connected = play(true);
check(
	'connected: the same ten reads run nothing',
	connected.reruns === 0,
	JSON.stringify(connected),
);

console.log('the gate itself, either way');
for (const [label, r] of [
	['unconnected', control],
	['connected', connected],
]) {
	check(`${label}: the same gate while nothing changes`, r.kept, JSON.stringify(r));
	check(`${label}: a new gate when the state changes`, r.newOnState, JSON.stringify(r));
	check(
		`${label}: a state that waits for its FX reports once they end, not before`,
		r.heldForFx && r.reportedOnFx,
		JSON.stringify(r),
	);
}
check(
	'the same reports from the same calls, and one gate per change',
	control.reports === connected.reports &&
		control.reportsAtRest === connected.reportsAtRest &&
		control.reportsAtRest === 10 &&
		control.gates === connected.gates,
	JSON.stringify({ control, connected }),
);

console.log('Symbol.svelte');
const symbol = readFileSync(join(here, '../components/Symbol.svelte'), 'utf8');
check(
	'reads gate in an effect while the symbol has Element FX',
	/\$effect\.pre\(\(\) => \{\s*if \(symbolFx\) void gate;\s*\}\);/.test(symbol),
);
check(
	'…the gate its art completes through',
	/symbolFx \? \(\) => gate\.art\(\) : props\.oncomplete/.test(symbol),
);

if (failures) throw new Error(`symbolGate.fixture: ${failures} FAILED`);
console.log('\nsymbolGate.fixture: all ok');
