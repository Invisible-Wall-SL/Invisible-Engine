/**
 * Offline fixture for RELEASE ON ARRIVAL (Invisible Symbols → "Let the next spin start as soon as
 * the symbols are back") — the switch that stops the `emerge` arrival GATING the round.
 *
 * WHY IT EXISTS AT ALL, measured rather than assumed. Owner report: a delay on every spin, win or
 * not, and an identical-feeling pause between two wins of one cascading spin. Traced in a real
 * browser at 136-204 fps (a throttled tab had produced three wrong answers before this):
 * `reveal` runs 3.0-3.4 s on EVERY spin, a cascade step ~2.14 s, and inside one 3401 ms reveal the
 * board's own clips were finished at t+2088 while the round released at t+3401. The tail is
 * `tumbleBoardAppear` waiting out `INTRO_BEAT_CAP_MS` after the picture has already settled.
 *
 * WHAT THE SWITCH MUST NOT BECOME. It would be trivial — and wrong — to implement this by simply
 * not running the beat. The beat is what takes a cell OFF `intro`: its completion settles the cell,
 * and its cap settles a cell whose art can never report. Skip it and such a symbol is frozen
 * mid-rise for the rest of the round, which is the exact failure `symbolBeat.ts` exists to prevent.
 * So the contract is DETACHED, NOT SKIPPED — and that distinction is what this fixture pins, on the
 * real component text, because it is invisible in behaviour until the one board that can't report
 * shows up.
 *
 * Part 2 is the anti-#613 half: #613 was two `verify-*` guards slicing source that had moved, and
 * so guarding nothing. Every assertion below reads the shipped file.
 *
 * Run: apps/launcher-api/node_modules/.bin/tsx scripts/verify-arrival-release.mts
 */

import { readLF } from './lib/read-lf.mjs';

let failures = 0;
const assert = (label: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failures += 1;
	console.log(
		`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
	);
};

const read = (rel: string) => readLF(new URL(rel, import.meta.url));

// 1. THE ACCESSOR resolves the flag on BOTH bundle paths and defaults OFF.
const scenes = read('../apps/lines/src/editor-scenes.ts');
assert('the doc type carries the field', /arrivalRelease\?: \{ enabled\?: boolean \}/.test(scenes), true); // prettier-ignore
assert('an accessor exists', scenes.includes('export function bakedArrivalReleaseEnabled()'), true);
const accessor = scenes.slice(
	scenes.indexOf('export function bakedArrivalReleaseEnabled()'),
	scenes.indexOf('export function bakedArrivalReleaseEnabled()') + 420,
);
assert('…reads the live runtime bundle', accessor.includes('runtimeBundle!.symbols?.arrivalRelease'), true); // prettier-ignore
assert('…and the baked bundle', accessor.includes('bakedBundle.symbols?.arrivalRelease'), true);
assert('…defaulting OFF, so an unauthored project is byte-identical', accessor.includes('?? false'), true); // prettier-ignore

// 2. THE CALL SITE — the arrival beat.
const tumble = read('../apps/lines/src/components/TumbleBoard.svelte');
const appear = tumble.slice(tumble.indexOf('tumbleBoardAppear: async ('));
assert('the appear handler reads the flag', appear.includes('bakedArrivalReleaseEnabled()'), true);
// Read at DISPATCH time: the live runtime bundle resolves after the component mounts, so a value
// captured at mount is the coded default forever. Same rule `bakedSymbolTransition` follows.
assert(
	'…at dispatch time, not at mount',
	tumble.indexOf('bakedArrivalReleaseEnabled()') > tumble.indexOf('tumbleBoardAppear: async ('),
	true,
);
assert('…and branches on it', /if \(releaseOnArrival\)/.test(appear), true);

// THE WHOLE POINT: detached, not skipped. Both paths must run the beat, and both must settle.
// Sliced to the BRANCH, not a fixed window: a generous slice runs past the closing brace and picks
// up the gated path's own `await beat()`, which would make the "does not await" assertion pass by
// reading the wrong code. It ends at the branch's `return;`.
const branchStart = appear.indexOf('if (releaseOnArrival)');
const branch = appear.slice(branchStart, appear.indexOf('return;', branchStart) + 'return;'.length);
assert('the released path still RUNS the beat', /void beat\(\)/.test(branch), true);
assert('…without awaiting it', /await\s+beat\(\)/.test(branch), false);
assert('…and still settles the cell to rest', /symbolState = 'static'/.test(branch), true);
assert('…then leaves the phase', /\breturn;/.test(branch), true);
assert('the gated path still awaits', /await beat\(\);/.test(appear), true);
assert(
	'…and settles after the await, so the cap path settles too',
	appear.indexOf("symbolState = 'static'", appear.indexOf('await beat();')) > appear.indexOf('await beat();'), // prettier-ignore
	true,
);
// The cap still comes from the authored-state question — the released path must not quietly become
// the long guard for a cell that never authored an intro.
assert(
	'the cap is still chosen by hasAuthoredSymbolState',
	/hasAuthoredSymbolState\(tumbleSymbol\.rawSymbol\.name, 'intro'\)/.test(appear),
	true,
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
