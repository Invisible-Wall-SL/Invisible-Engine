/**
 * Contract check for Invisible Symbols → "Play Land as each cell stops" (`respinLandOnStop`): on the
 * Hold and Win respin board a coin plays its `land` as its own cell stops, instead of when the
 * `coinsLand` beat sticks every landed coin after the LAST cell of the respin has stopped.
 *
 *   1. THE DOC — sparse and default OFF, so an untouched project persists NOTHING and lands exactly
 *      as before; ON round-trips; a non-boolean is refused on save; the save keeps the flag whatever
 *      the project's config says (two separately edited documents).
 *   2. THE CLIENT — the setter and the page's dirty signature agree with the server.
 *   3. BOTH BUNDLE PATHS — the export result, the export endpoint the bake reads, and the bake
 *      whitelist: three hand-written lists nothing else forces to agree.
 *   4. THE GAME — the reader, and the three places that act on it: the cell draws the stop state, the
 *      held cell draws through `respinHeldState`, and the stick waits for the stop's `land` and skips
 *      the cue the stop already played. The RULE itself (which state each moment draws) is pure and
 *      pinned by `packages/engine-game/fixtures/respinBoard.fixture.ts`.
 *
 * Run:  pnpm --filter launcher-api check:respin-land
 */

import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { normalizeSymbolsDoc } from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	respinLandOnStopEnabled,
	setRespinLandOnStop,
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
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input, 'reject');
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

console.log('\n1. the doc is sparse, OFF by default, and round-trips ON');
const untouched = normalizeSymbolsDoc({ version: 1, symbols: {} });
check('an untouched doc persists no `respinLandOnStop`', 'respinLandOnStop' in untouched, false);
check('…and reads as OFF', respinLandOnStopEnabled(untouched as SymbolsDoc), false);
check(
	'OFF written explicitly still persists nothing (byte-parity)',
	'respinLandOnStop' in normalizeSymbolsDoc({ respinLandOnStop: { enabled: false } }),
	false,
);
check(
	'ON round-trips',
	normalizeSymbolsDoc({ respinLandOnStop: { enabled: true } }).respinLandOnStop,
	{ enabled: true },
);
rejects('a non-boolean is refused', { respinLandOnStop: { enabled: 'yes' } });

console.log('\n2. the client half agrees with the server');
const base: SymbolsDoc = { version: 1, symbols: {} };
check('the setter turns it on', respinLandOnStopEnabled(setRespinLandOnStop(base, true)), true);
check(
	'…and off again, deleting the key',
	'respinLandOnStop' in setRespinLandOnStop(setRespinLandOnStop(base, true), false),
	false,
);
check(
	'turning it on marks the page DIRTY',
	docSignature(setRespinLandOnStop(base, true)) !== docSignature(base),
	true,
);
check(
	'…and the saved doc the server hands back signs the same as the draft',
	docSignature(setRespinLandOnStop(base, true)),
	docSignature({
		...base,
		respinLandOnStop: normalizeSymbolsDoc({ respinLandOnStop: { enabled: true } }).respinLandOnStop,
	}),
);

const here = fileURLToPath(new URL('.', import.meta.url));
const root = `${here}../../../`;
const bake = readLF(`${here}bake-editor-doc.mjs`);
const exportEndpoint = readLF(`${here}../src/routes/api/editor/export-symbols/+server.ts`);
const exporter = readLF(`${here}../src/lib/server/symbolExport.ts`);

console.log('\n3. it reaches BOTH bundle paths');
check(
	'the exporter emits it',
	exporter.includes('...(respinLandOnStop ? { respinLandOnStop } : {})'),
	true,
);
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	(exportEndpoint.match(/\brespinLandOnStop\b/g) ?? []).length >= 2,
	true,
);
check(
	'the bake whitelist rebuilds it',
	bake.includes('s?.respinLandOnStop?.enabled === true'),
	true,
);
check('…and puts it on the bundle', /\n\t{4,}respinLandOnStop,\n/.test(bake), true);

console.log('\n4. the game reads it and acts on it at the stop, the held layer and the stick');
/** Whitespace-blind containment, so a re-wrap of the source cannot fail a claim about its code. */
const squash = (text: string): string => text.replace(/\s+/g, ' ').replace(/([([{]) /g, '$1');
const holds = (source: string, ...snippets: string[]): boolean =>
	snippets.every((snippet) => squash(source).includes(squash(snippet)));
const scenes = readLF(`${root}apps/lines/src/editor-scenes.ts`);
const landing = readLF(`${root}apps/lines/src/game/respinLanding.ts`);
const board = readLF(`${root}apps/lines/src/game/stateRespinBoard.svelte.ts`);
const cell = readLF(`${root}apps/lines/src/components/RespinCell.svelte`);
const held = readLF(`${root}apps/lines/src/components/RespinHeldSymbol.svelte`);
const presentation = readLF(`${root}apps/lines/src/game/holdAndWinPresentation.ts`);
check(
	'the reader resolves runtime → baked → off',
	holds(
		scenes,
		'runtimeBundle!.symbols?.respinLandOnStop',
		'bakedBundle.symbols?.respinLandOnStop',
		'return c?.enabled ?? false;',
	),
	true,
);
check(
	'the game feeds the reader to the stop rule, and the blank never lands',
	holds(landing, 'respinStopState(bakedRespinLandOnStop() && name !== respinBlank(),'),
	true,
);
check(
	'a stopping cell draws the stop state',
	holds(cell, "symbol.symbolState === 'land' ? respinCellStopState(symbol.rawSymbol.name)"),
	true,
);
check(
	"…and reports its land's end, so the stick can wait for it",
	holds(cell, "reelSymbol.symbolState = 'static'; completeCellLanding(key);"),
	true,
);
check(
	'the board records a landing (and plays its cue) only with the switch on, never for the blank',
	holds(
		board,
		'if (!bakedRespinLandOnStop() || symbol.name === respinBlank()) return; ' +
			'stateRespinBoard.landed.push(respinCellKey(reel, row)); ' +
			'playSymbolLandSound(symbol.name, 1);',
	),
	true,
);
check(
	'the board hands its reels the hook',
	holds(board, 'onCellStopping: (reel) => onCellStopping(reel), onCellLand,'),
	true,
);
check(
	'a new spin forgets the last one',
	holds(
		board,
		'soundedColumns = []; if (stateRespinBoard.landed.length > 0) stateRespinBoard.landed = [];',
	),
	true,
);
check(
	'a held cell draws through `respinHeldState`',
	holds(
		held,
		'state={drawnState}',
		'respinHeldState(cellState, props.cell.symbol.name, stateRespinBoard.landed.includes(key))',
	),
	true,
);
check(
	'…and the label pop still keys on the BEAT, not on what it draws',
	holds(held, "pops.land && cellState === 'coinStick'"),
	true,
);
const coinsLand = presentation.slice(presentation.indexOf('export const presentCoinsLand'));
check(
	'the stick waits for the stops only when one landed (off: no await, as before)',
	holds(coinsLand, 'if (landed.length > 0) await awaitStopLandings(event.cells); syncHeldCells();'),
	true,
);
check(
	'…plays the landing cue only for a coin its stop did not already sound',
	holds(coinsLand, 'if (!stopped(cell)) playSymbolLandSound(cell.symbol.name, 1);'),
	true,
);
check(
	'…holds a stick that draws the rest for no animation (cap 0), the rest as before',
	holds(
		coinsLand,
		"if (resting.length === 0) await playHeldBeat(event.cells, 'coinStick');",
		"playHeldBeat(resting, 'coinStick', { capMs: 0 })",
	),
	true,
);
check(
	'…and forgets the landings once the stick has played, so a later stick lands as before',
	holds(coinsLand, ']); if (landed.length > 0) stateRespinBoard.landed = [];'),
	true,
);
const stopLandings = presentation.slice(presentation.indexOf('const awaitStopLandings'));
check(
	'the stop wait is slammable, arms each cell once, and drops what a cap or slam left armed',
	holds(
		stopLandings,
		'await roundSkip.race(',
		'if (armed.includes(key) ||',
		'armed.forEach(completeCellLanding);',
	),
	true,
);

console.log(
	failures === 0
		? `\nrespin land on stop: OK (${checks} checks)`
		: `\nrespin land on stop: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
