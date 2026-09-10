/**
 * Contract check for the two 2026-09-10 symbol-state changes, both over the REAL implementations
 * rather than a re-typed copy of them:
 *
 *   1. THE RENAME — `tumbleExplosion` → `clearReel`. The behaviour did not move; only the key and
 *      the label did. What is asserted here is the MIGRATION, because getting it wrong is silent and
 *      total: the state records are keyed by `z.enum(SYMBOL_STATES)`, which Zod REJECTS an unlisted
 *      key on, and `loadSymbolsDocWithEtag` answers a parse failure with `emptySymbolsDoc()`. An
 *      un-folded legacy doc would therefore have read as a project that had never authored anything
 *      — every binding and every per-symbol cue gone, with no error anywhere. So: a legacy key is
 *      accepted, lands under the new name, on BOTH state-keyed maps (`symbols` + `symbolSounds`);
 *      the new key wins when a doc somehow holds both; and the old name never survives downstream.
 *
 *   2. THE END-OF-ROUND POP — `winExplode`. Sparse and default OFF, so the whole contract is that an
 *      untouched project persists NOTHING (byte-parity on the beat every paying spin runs), that the
 *      ON state round-trips, and that it reaches BOTH bundle paths — the export result and the
 *      bake whitelist, which are two hand-written lists nothing else forces to agree.
 *
 *   3. THE POP IS THE REMOVAL ("explode and be gone", 2026-09-10), and it happens ONCE, at the END
 *      of the round. A round's winning cells are taken off the board rather than reverted to
 *      `postWinStatic`, so the next spin's board clear cannot pop them a second time — the reported
 *      Win → Explosion → Clear reel. It is deferred to the end of the whole win presentation
 *      because a round narrates its wins one after another over the same board and overlapping
 *      paylines share cells: popped per win, a later win re-lit a cell that no longer renders and
 *      the round sat out the beat cap for it.
 *
 *      What is asserted HERE is the WIRING — one flag on the reel cell, one broadcaster, one place
 *      that removes — plus the two claims a source file is the right home for (the Book-of column
 *      morph must not vanish; the board clear's visible band). The BEHAVIOUR is driven on a virtual
 *      clock, over the real functions, by `scripts/verify-win-explode-pop.mjs` (the pop, the seam,
 *      the render gate, the rotation), `scripts/verify-swap-in-place-mode.mjs` part 11 (the board
 *      clear, both arms) and `scripts/verify-tumble-pattern.mjs` part 6 (the cascade).
 *
 * Run:  pnpm --filter launcher-api check:clear-reel
 *
 * The `--tsconfig` that script passes maps SvelteKit's `$env/dynamic/private` to a stub
 * (`scripts/lib/env-stub.ts`), because `symbolsStorage.ts` reaches R2 → `env.ts` → that virtual
 * module, which only exists inside a SvelteKit build.
 */

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { SYMBOL_STATE_LABELS, SYMBOL_STATES } from 'engine-layout';
import {
	migrateLegacySymbolStates,
	normalizeSymbolsDoc,
	symbolsDocSchema,
} from '../src/lib/server/symbolsStorage.ts';
import {
	docSignature,
	setWinExplodeEnabled,
	winExplodeEnabled,
	type SymbolsDoc,
} from '../src/routes/(app)/symbols/symbols.client.ts';

let failures = 0;
let checks = 0;
const canon = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(canon)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value as Record<string, unknown>)
						.sort()
						.map((k) => [k, canon((value as Record<string, unknown>)[k])]),
				)
			: value;
const json = (value: unknown): string => JSON.stringify(canon(value));
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
const rejects = (label: string, input: unknown): void => {
	checks += 1;
	try {
		normalizeSymbolsDoc(input);
	} catch (e) {
		if (e instanceof ZodError) return;
		failures += 1;
		console.log(`FAIL  ${label}\n        threw a non-Zod error: ${String(e)}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        accepted`);
};

const BOOM = { type: 'spine', assetKey: 'acme/game/spines/boom/', animationName: 'boom' } as const;
const MORPH = {
	type: 'spine',
	assetKey: 'acme/game/spines/morph/',
	animationName: 'morph',
} as const;

console.log('\n1. the state set carries the new name and not the old one');
check('`clearReel` is a state', SYMBOL_STATES.includes('clearReel'), true);
check(
	'`tumbleExplosion` is gone',
	(SYMBOL_STATES as readonly string[]).includes('tumbleExplosion'),
	false,
);
check(
	'the label is sentence-case, matching `Post-win`',
	SYMBOL_STATE_LABELS.clearReel,
	'Clear reel',
);

console.log('\n2. a saved doc holding the legacy key is folded, not lost');
const legacy = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { win: MORPH, tumbleExplosion: BOOM } },
	symbolSounds: { H1: { land: 'sfx_land', tumbleExplosion: 'tumble_win_3' } },
});
check('the binding lands under `clearReel`', legacy.symbols.H1?.clearReel, BOOM);
check('…and the old key is gone', 'tumbleExplosion' in (legacy.symbols.H1 ?? {}), false);
check('…and the symbol keeps its other states', legacy.symbols.H1?.win, MORPH);
check('the per-symbol CUE lands under `clearReel` too', legacy.symbolSounds?.H1?.clearReel, 'tumble_win_3'); // prettier-ignore
check('…and its other cue survives', legacy.symbolSounds?.H1?.land, 'sfx_land');
check(
	'the legacy key never survives anywhere in the normalized doc',
	JSON.stringify(legacy).includes('tumbleExplosion'),
	false,
);

console.log('\n   …and the fold is what stands between a legacy doc and an EMPTY one');
checks += 1;
try {
	// The SCHEMA, un-folded — the shape `loadSymbolsDocWithEtag` would have caught and answered with
	// `emptySymbolsDoc()`, silently reporting a fully authored project as a never-authored one. If
	// Zod ever starts STRIPPING an unlisted state key instead of rejecting it, this check is how we
	// find out the migration's stakes changed.
	symbolsDocSchema.parse({ version: 1, symbols: { H1: { tumbleExplosion: BOOM } } });
	failures += 1;
	console.log('FAIL  the raw schema now ACCEPTS the legacy key — re-read the migration comment');
} catch (e) {
	if (!(e instanceof ZodError)) {
		failures += 1;
		console.log(`FAIL  the raw schema threw a non-Zod error: ${String(e)}`);
	}
}

console.log('\n3. the newer key wins when a doc somehow holds both');
const both = normalizeSymbolsDoc({
	version: 1,
	symbols: { H1: { tumbleExplosion: MORPH, clearReel: BOOM } },
	symbolSounds: { H1: { tumbleExplosion: 'old_cue', clearReel: 'new_cue' } },
});
check('the binding keeps the new one', both.symbols.H1?.clearReel, BOOM);
check('the cue keeps the new one', both.symbolSounds?.H1?.clearReel, 'new_cue');

console.log('\n4. a current doc is untouched, and a bad state is still refused');
const current = normalizeSymbolsDoc({ version: 1, symbols: { H1: { clearReel: BOOM } } });
check('a `clearReel` binding round-trips verbatim', current.symbols.H1?.clearReel, BOOM);
check(
	'the migration returns the SAME object when there is nothing to fold',
	migrateLegacySymbolStates(current) === current,
	true,
);
rejects('a state name nothing renders is still rejected', {
	symbols: { H1: { madeUpState: BOOM } },
});

console.log('\n5. the end-of-round pop is sparse and OFF by default');
const untouched = normalizeSymbolsDoc({ version: 1, symbols: { H1: { win: MORPH } } });
check('an untouched doc persists no `winExplode`', 'winExplode' in untouched, false);
check('…and reads as OFF', winExplodeEnabled(untouched as SymbolsDoc), false);
check(
	'OFF written explicitly still persists nothing (byte-parity)',
	'winExplode' in normalizeSymbolsDoc({ winExplode: { enabled: false } }),
	false,
);
check('ON round-trips', normalizeSymbolsDoc({ winExplode: { enabled: true } }).winExplode, {
	enabled: true,
});
rejects('an unknown key inside it is refused (`.strict`)', {
	winExplode: { enabled: true, mode: 'loud' },
});
rejects('a non-boolean is refused', { winExplode: { enabled: 'yes' } });

console.log('\n   …and the client half agrees with the server');
const base: SymbolsDoc = { version: 1, symbols: {} };
check('the setter turns it on', winExplodeEnabled(setWinExplodeEnabled(base, true)), true);
check(
	'…and off again, deleting the key',
	'winExplode' in setWinExplodeEnabled(setWinExplodeEnabled(base, true), false),
	false,
);
check(
	'turning it on marks the page DIRTY',
	docSignature(setWinExplodeEnabled(base, true)) !== docSignature(base),
	true,
);
check(
	'…and the saved doc the server hands back signs the same as the draft',
	docSignature(setWinExplodeEnabled(base, true)),
	docSignature({
		...base,
		winExplode: normalizeSymbolsDoc({ winExplode: { enabled: true } }).winExplode,
	}),
);

console.log('\n6. it reaches BOTH bundle paths');
const here = fileURLToPath(new URL('.', import.meta.url));
/** Repo root, so the runtime half of the contract (`apps/lines`, `packages/*`) can be read too. */
const root = `${here}../../../`;
/** Source with LF newlines whatever the checkout uses. Every assertion from here down is about the
 *  CODE, and a Windows working copy (`core.autocrlf`) would otherwise fail patterns that name a line
 *  break for reasons that have nothing to do with the claim. */
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const bake = read(`${here}bake-editor-doc.mjs`);
const exportEndpoint = read(`${here}../src/routes/api/editor/export-symbols/+server.ts`);
const exporter = read(`${here}../src/lib/server/symbolExport.ts`);
check('the exporter emits it', exporter.includes('...(winExplode ? { winExplode } : {})'), true);
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	(exportEndpoint.match(/\bwinExplode\b/g) ?? []).length >= 2,
	true,
);
check('the bake whitelist rebuilds it', bake.includes('s?.winExplode?.enabled === true'), true);
check('…and puts it on the bundle', /\n\t{4,}winExplode,\n/.test(bake), true);

console.log('\n7. the per-symbol sound cues reach both bundle paths too');
// `bakedSymbolSounds` consults `catalog.bindings.symbols` FIRST and only falls back to
// `symbols.symbolSounds`. The runtime path has always carried that fallback and the bake path
// never wrote it, so the two answered differently whenever a project shipped no bindings block.
check('the exporter emits it', exporter.includes('...(symbolSounds ? { symbolSounds } : {})'), true); // prettier-ignore
check(
	'the export ENDPOINT forwards it (the bake reads this response)',
	(exportEndpoint.match(/\bsymbolSounds\b/g) ?? []).length >= 2,
	true,
);
check('the bake whitelist rebuilds it', bake.includes('s?.symbolSounds && typeof s.symbolSounds'), true); // prettier-ignore
check('…and puts it on the bundle', /\n\t{4,}symbolSounds,\n/.test(bake), true);

console.log('\n8. the pop IS the removal — once, at the end of the round');
const board = read(`${root}apps/lines/src/components/Board.svelte`);
const reelSymbol = read(`${root}apps/lines/src/components/ReelSymbol.svelte`);
const tumbleBoard = read(`${root}apps/lines/src/components/TumbleBoard.svelte`);
const flowEffects = read(`${root}apps/lines/src/game/flowEffects.ts`);
const winCycle = read(`${root}apps/lines/src/game/winSymbolCycle.ts`);
const playUtils = read(`${root}apps/lines/src/game/utils.ts`);
const freeSpinHold = read(`${root}apps/lines/src/game/freeSpinHold.ts`);
const reelFactory = read(`${root}packages/utils-slots/src/createReelForSpinning.svelte.ts`);
const gameState = read(`${root}packages/engine-game/src/game/gameState.svelte.ts`);

/** One declaration out of a source file, from its opening marker to `endMarker` — by default the
 *  blank line that ends it (Prettier separates top-level declarations, so that boundary is stable;
 *  a body with a blank line inside passes its own). Throws rather than silently handing back a
 *  truncated slice, because a slice that quietly shrank would turn every claim over it into a pass. */
const slice = (source: string, what: string, marker: string, endMarker = '\n\n'): string => {
	const start = source.indexOf(marker);
	if (start < 0) throw new Error(`${what}: could not find "${marker}"`);
	const end = source.indexOf(endMarker, start + marker.length);
	if (end < 0) throw new Error(`${what}: could not find the end of the declaration`);
	return source.slice(start, end);
};

// THE BOARD CLEAR'S VISIBLE BAND, over the REAL function. It is a padded strip — one buffer row
// above, one below — and popping a row nobody can see buys a beat-race per hidden cell for no
// picture. A seat the end-of-round pop emptied is deliberately still in the set: the overlay's
// explode step recognises it and returns before it waits, and the board-wide removal after the step
// is keyed on what the step NAMED, so filtering here would strand the emptied seat in the survivor
// layer while everything around it left (driven in verify-swap-in-place-mode part 11, both arms).
const visibleColumnPositions = new Function(
	`${stripTypeScriptTypes(slice(flowEffects, 'visibleColumnPositions', 'const visibleColumnPositions = ('))}\nreturn visibleColumnPositions;`,
)() as (reelIndex: number, strip: readonly unknown[]) => { reel: number; row: number }[];
/** A padded strip: one buffer row, three visible rows, one buffer row. */
const strip = [0, 1, 2, 3, 4];
check(
	'every visible row of the column pops, and only those',
	visibleColumnPositions(2, strip)
		.map(({ reel, row }) => `${reel}:${row}`)
		.join(','),
	'2:1,2:2,2:3',
);
check(
	'a two-row strip is all buffer, so nothing pops',
	visibleColumnPositions(2, [0, 1]).length,
	0,
);
check('an empty column pops nothing rather than throwing', visibleColumnPositions(2, []).length, 0);
check(
	'a longer strip still pops exactly its interior',
	visibleColumnPositions(0, [0, 1, 2, 3, 4, 5, 6])
		.map(({ row }) => row)
		.join(','),
	'1,2,3,4,5',
);
check(
	'the set carries the reel it was asked for',
	new Set(visibleColumnPositions(4, strip).map(({ reel }) => reel)).size === 1 &&
		visibleColumnPositions(4, strip)[0].reel === 4,
	true,
);

// THE FLAG ITSELF — per CELL, which is what makes it self-clearing: every board replacement builds
// fresh cells through `createReelSymbols`, so nothing has to remember to wipe a set.
check(
	'a reel cell is born un-removed',
	slice(
		reelFactory,
		'createReelSymbol',
		'const createReelSymbol = (',
		'\ttype ReelSymbol = ',
	).includes('removed: false'),
	true,
);
check(
	'the engine publishes the removal set beside the raw board',
	slice(gameState, 'boardRemoved', '\tconst boardRemoved = () =>').includes('reelSymbol.removed'),
	true,
);

// THE WIN BEAT NO LONGER POPS. This is a CONTAINMENT claim, not an ordering one: the beat's own
// body must contain no removal and no explosion at all, so a pop cannot escape back into the
// per-win narration the deferral exists to leave alone.
const winBeat = slice(board, 'the win beat', '\t\tboardWithAnimateSymbols: async (', '\n\t\t},\n');
check('the win beat removes nothing', winBeat.includes('.removed = true'), false);
check('…and explodes nothing', winBeat.includes("symbolState = 'explosion'"), false);
check(
	'…but it refuses to re-light a cell that is off the board',
	winBeat.includes('if (reelSymbol.removed) return;'),
	true,
);

// THE POP IS ONE CUE, HANDLED IN ONE PLACE, BROADCAST FROM ONE PLACE, BEHIND ONE SWITCH.
const popBeat = slice(board, 'the pop', '\t\tboardExplodeWinSymbols: async (', '\n\t\t},\n');
check('the pop handler is the one that removes', (popBeat.match(/\.removed = true/g) ?? []).length, 1); // prettier-ignore
check('…and it is the only place in the component that does', (board.match(/\.removed = true/g) ?? []).length, 1); // prettier-ignore
check(
	'…on BOTH exits of the bounded race, i.e. after the await rather than inside the armed callback',
	popBeat.indexOf('.removed = true') > popBeat.indexOf('awaitSymbolBeat('),
	true,
);
check('…bounded by the win-beat cap', popBeat.includes('WIN_BEAT_CAP_MS'), true);
const popGate = slice(
	winCycle,
	'explodeRoundWinners',
	'export const explodeRoundWinners = async (',
);
check('the switch is read before anything else happens', /if \(!bakedWinExplodeEnabled\(\)\) return;/.test(popGate), true); // prettier-ignore
check('…and an empty winning set broadcasts nothing', popGate.includes('if (!symbolPositions.length) return;'), true); // prettier-ignore
check(
	'exactly one module broadcasts the pop cue',
	[
		flowEffects,
		winCycle,
		playUtils,
		read(`${root}apps/lines/src/game/bookEventHandlerMap.ts`),
	].filter((source) => source.includes("type: 'boardExplodeWinSymbols'")).length,
	1,
);

// THE TWO SEAMS. The pop runs where the resting replay would have started — `playBet`'s `finally`
// (every dispatch path) and the between-spins hold — awaited, and before the replay, or the replay
// would light seats that are about to vanish.
for (const [what, source] of [
	[
		'playBet',
		slice(playUtils, 'playBet', 'export const playBet = async (bet: Bet) => {', '\n};\n'),
	],
	['the between-spins hold', slice(freeSpinHold, 'holdAfterBigWin', 'export const holdAfterBigWin = async (', '\n};\n')], // prettier-ignore
] as const) {
	check(`${what} awaits the pop`, source.includes('await explodeRoundWinners();'), true);
	check(
		`…and starts the replay only after it`,
		source.indexOf('await explodeRoundWinners();') < source.indexOf('void startWinCycle();'),
		true,
	);
}
check(
	'…and playBet runs it in the finally, so a slammed or aborted round reaches it',
	slice(playUtils, 'playBet', 'export const playBet = async (bet: Bet) => {', '\n};\n').indexOf('} finally {') < // prettier-ignore
		slice(playUtils, 'playBet', 'export const playBet = async (bet: Bet) => {', '\n};\n').indexOf('await explodeRoundWinners();'), // prettier-ignore
	true,
);

// THE BOOK-OF COLUMN MORPH uses the same `explosion` state and must NOT start vanishing — it
// explodes and then SWAPS to the special symbol, so a removal there would empty the expanded reels.
const bookMorph = slice(
	flowEffects,
	'expandBookColumns',
	'\texpandBookColumns: async (payload) => {',
);
check('the sliced morph really is the one that explodes', bookMorph.includes("symbolState = 'explosion'"), true); // prettier-ignore
check('…and it explodes without removing', bookMorph.includes('.removed = true'), false);

// THE RENDER GATE — the single claim that a removed cell actually stops being drawn — evaluated
// rather than matched, over the component's OWN derivation and its OWN `{#if}` condition.
const removedDerivation = slice(reelSymbol, 'the removed derivation', 'const removed = $derived(', ';\n'); // prettier-ignore
const ifCondition = reelSymbol.match(/\n\{#if ([^}]+)\}\n/);
if (!ifCondition) throw new Error('ReelSymbol.svelte no longer opens with an {#if}');
const drawsCell = new Function(
	'props',
	'covered',
	`${removedDerivation.replace('$derived(', '(')}\nreturn Boolean(${ifCondition[1]});`,
) as (props: { reelSymbol: { removed: boolean } }, covered: boolean) => boolean;
check(
	'drawn: not covered, not removed',
	drawsCell({ reelSymbol: { removed: false } }, false),
	true,
);
check('undrawn: removed', drawsCell({ reelSymbol: { removed: true } }, false), false);
check('undrawn: covered', drawsCell({ reelSymbol: { removed: false } }, true), false);
check('undrawn: both', drawsCell({ reelSymbol: { removed: true } }, true), false);

// THE CASCADE OVERLAY. Its survivor layer is built from the resting board while the reel board is
// hidden, so a seat the pop emptied has to arrive UNDRAWN — but in the ORDINARY state, because the
// step's removal filters `base` by what THAT step popped. Born `clearReel` it would be swept by a
// cascade that never named it, and the combined column would settle SHORT.
check(
	'BOTH survivor-layer initialisers seed the removal, so the pop is not undone',
	[
		slice(tumbleBoard, 'initTumbleBoardBaseReel', '\tconst initTumbleBoardBaseReel = ('),
		slice(tumbleBoard, 'initTumbleBoardBase', '\tconst initTumbleBoardBase = ('),
	].every((source) => source.includes('boardRemoved()') && /\bremoved: removed\b/.test(source)),
	true,
);
check(
	'…and a removed seat is born undrawn but ORDINARY, so only the step that names it sweeps it',
	tumbleBoard.includes('exploded: removed,') &&
		tumbleBoard.includes("symbolState: 'static' as SymbolState,") &&
		!tumbleBoard.includes("symbolState: (removed ? 'clearReel' : 'static')"),
	true,
);
check(
	'the explode step skips a seat that is already gone, and marks it for its own removal',
	/if \(tumbleSymbol\.exploded\) \{\s*\n\s*tumbleSymbol\.symbolState = 'clearReel';\s*\n\s*return;\s*\n\s*\}/.test(
		tumbleBoard,
	),
	true,
);
check(
	'…and the board-wide removal is still keyed on that state',
	tumbleBoard.includes("tumbleSymbol.symbolState !== 'clearReel'"),
	true,
);

console.log(
	failures === 0
		? `\nclear-reel + win-explode: OK (${checks} checks)`
		: `\nclear-reel + win-explode: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
