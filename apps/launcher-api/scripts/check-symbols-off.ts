/**
 * Contract check for Invisible Symbols → the on/off switch on "Highlight (win frame)" and
 * "Free-spin board glow" (`off`): a game that has no use for a coded part turns it off, and then it
 * is neither drawn nor shipped.
 *
 *   1. THE DOC — sparse: an untouched project persists no `off`; only `true` persists; a swapped rig
 *      stays on the doc while its part is off, so turning it back on restores it.
 *   2. THE CLIENT — the setter and the page's dirty signature agree with the server.
 *   3. THE EXPORT — an off part ships no rig bundle and no pointer, only the flag; it reaches BOTH
 *      bundle paths (the export endpoint the bake reads, and the bake whitelist).
 *   4. THE GAME — the reader, the win frame and the board glow act on it. Its stock art is held by
 *      `apps/lines/src/game/stockAssets.fixture.ts`.
 *
 * Run:  pnpm --filter launcher-api check:symbols-off
 */

import { fileURLToPath } from 'node:url';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import { collectSymbolRefs } from '../src/lib/server/symbolExport.ts';
import { symbolsRouteCarries } from './lib/symbolsRouteBody.ts';
import {
	docSignature,
	setSymbolsPartOff,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const FRAME = 'clients/c/projects/p/spines/frame/';
const GLOW = 'clients/c/projects/p/spines/glow/';
const swapped = {
	version: 1 as const,
	symbols: {},
	highlight: { type: 'spine' as const, assetKey: FRAME, sizeRatios: { width: 1, height: 1 } },
	boardGlow: { type: 'spine' as const, assetKey: GLOW },
};

console.log('\n1. the doc is sparse and keeps the swapped rigs');
check('an untouched doc persists no `off`', 'off' in normalizeSymbolsDoc({ symbols: {} }), false);
check(
	'nothing turned off persists nothing',
	'off' in normalizeSymbolsDoc({ symbols: {}, off: {} }),
	false,
);
check(
	'both off round-trip',
	normalizeSymbolsDoc({ ...swapped, off: { highlight: true, boardGlow: true } }).off,
	{ highlight: true, boardGlow: true },
);
check(
	'…and the swapped rigs stay on the doc',
	[
		normalizeSymbolsDoc({ ...swapped, off: { highlight: true, boardGlow: true } }).highlight
			?.assetKey,
		normalizeSymbolsDoc({ ...swapped, off: { highlight: true, boardGlow: true } }).boardGlow
			?.assetKey,
	],
	[FRAME, GLOW],
);

console.log('\n2. the client half agrees with the server');
const base: SymbolsDoc = { version: 1, symbols: {} };
const frameOff = setSymbolsPartOff(base, 'highlight', true);
check('the setter turns the win frame off', frameOff.off, { highlight: true });
check(
	'…and on again, deleting the key',
	'off' in setSymbolsPartOff(frameOff, 'highlight', false),
	false,
);
check(
	'turning a part off marks the page DIRTY',
	docSignature(frameOff) !== docSignature(base),
	true,
);
check(
	'…and the saved doc the server hands back signs the same as the draft',
	docSignature(frameOff),
	docSignature({ ...base, off: normalizeSymbolsDoc({ off: { highlight: true } }).off }),
);

console.log('\n3. an off part ships nothing but the flag, on both bundle paths');
const rigs = (doc: SymbolsDoc): string[] => [...collectSymbolRefs(doc).rigKeys].sort();
check('both on ⇒ both swapped rigs ship', rigs(swapped), [FRAME, GLOW]);
check('the win frame off ⇒ its rig does not', rigs({ ...swapped, off: { highlight: true } }), [
	GLOW,
]);
check('the board glow off ⇒ its rig does not', rigs({ ...swapped, off: { boardGlow: true } }), [
	FRAME,
]);
const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}../../../`;
const exporter = readLF(`${here}../src/lib/server/symbolExport.ts`);
const bake = readLF(`${here}bake-editor-doc.mjs`);
check(
	'the exporter drops the pointers of an off part and emits the flag',
	[
		"!doc.off?.highlight && doc.highlight?.type === 'spine' && doc.highlight.assetKey",
		'const boardGlow = doc.off?.boardGlow ? undefined : doc.boardGlow;',
		'...(doc.off ? { off: doc.off } : {}),',
	].filter((line) => !exporter.includes(line)),
	[],
);
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	symbolsRouteCarries('off'),
	true,
);
check('the bake whitelist rebuilds it', bake.includes('if (s?.off?.[part] === true)'), true);
check('…and puts it on the bundle', /\n\t{4,}off,\n/.test(bake), true);

console.log('\n4. the game reads it and draws nothing for an off part');
const squash = (text: string): string => text.replace(/\s+/g, ' ').replace(/([([{]) /g, '$1');
const holds = (source: string, ...snippets: string[]): boolean =>
	snippets.every((snippet) => squash(source).includes(squash(snippet)));
const scenes = readLF(`${root}apps/lines/src/editor-scenes.ts`);
const symbol = readLF(`${root}apps/lines/src/components/Symbol.svelte`);
const frame = readLF(`${root}apps/lines/src/components/BoardFrame.svelte`);
check(
	'the reader resolves runtime → baked → on',
	holds(scenes, 'runtimeBundle!.symbols?.off', 'bakedBundle.symbols?.off'),
	true,
);
check(
	'a winning symbol draws no frame while it is off',
	holds(
		symbol,
		'const winFrameOff = bakedSymbolsOff()?.highlight === true;',
		'const showWinFrame = $derived( !winFrameOff &&',
	),
	true,
);
check(
	'the board glow never lights while it is off',
	holds(frame, 'const OFF = bakedSymbolsOff()?.boardGlow === true;', 'if (active && !OFF) {'),
	true,
);

console.log(
	failures === 0
		? `\nsymbols off: OK (${checks} checks)`
		: `\nsymbols off: ${failures} of ${checks} FAILED`,
);
if (failures) process.exit(1);
