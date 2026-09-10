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
 *   2. THE END-OF-WIN POP — `winExplode`. Sparse and default OFF, so the whole contract is that an
 *      untouched project persists NOTHING (byte-parity on the beat every paying spin runs), that the
 *      ON state round-trips, and that it reaches BOTH bundle paths — the export result and the
 *      bake whitelist, which are two hand-written lists nothing else forces to agree.
 *
 *   3. THE POP IS THE REMOVAL ("explode and be gone", 2026-09-10). A winning cell that plays its
 *      `explosion` under the pop is taken OFF the board rather than reverted to `postWinStatic`, so
 *      the next spin's board clear cannot pop it a second time — the reported Win → Explosion →
 *      Clear reel. That is one flag on the reel cell read by five places, and the failure mode of
 *      each is a beat nobody can see: a clear that still lists the seat spends the whole cap waiting
 *      for an `oncomplete` no cell can report, a survivor layer that ignores it brings the symbol
 *      back, and a resting replay that ignores it re-lights an empty seat forever. The one claim
 *      that can be DRIVEN here is driven (`visibleColumnPositions`, the real function); the rest are
 *      link checks, with the behaviour proved on a virtual clock by `scripts/verify-swap-in-place-
 *      mode.mjs` part 11 and `scripts/verify-tumble-pattern.mjs` part 6.
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

console.log('\n5. the end-of-win pop is sparse and OFF by default');
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

console.log('\n8. the pop IS the removal — the symbol is gone, not reverted');
const board = read(`${root}apps/lines/src/components/Board.svelte`);
const reelSymbol = read(`${root}apps/lines/src/components/ReelSymbol.svelte`);
const tumbleBoard = read(`${root}apps/lines/src/components/TumbleBoard.svelte`);
const flowEffects = read(`${root}apps/lines/src/game/flowEffects.ts`);
const winCycle = read(`${root}apps/lines/src/game/winSymbolCycle.ts`);
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

// THE ONE CLAIM THAT CAN BE DRIVEN: the board CLEAR's exploding set, over the REAL function. A cell
// the pop removed draws nothing, so it can never report an `oncomplete` — left in the set the step
// waits out the whole beat cap for an animation with no cell to play it, on the beat every
// swap-in-place spin runs.
const visibleColumnPositions = new Function(
	`${stripTypeScriptTypes(slice(flowEffects, 'visibleColumnPositions', 'const visibleColumnPositions = ('))}\nreturn visibleColumnPositions;`,
)() as (
	reelIndex: number,
	strip: readonly unknown[],
	removed?: readonly boolean[],
) => { reel: number; row: number }[];
/** A padded strip: one buffer row, three visible rows, one buffer row. */
const strip = [0, 1, 2, 3, 4];
const keys = (removed?: boolean[]): string =>
	visibleColumnPositions(2, strip, removed)
		.map(({ reel, row }) => `${reel}:${row}`)
		.join(',');
check('nothing removed ⇒ every visible row of the column pops', keys(), '2:1,2:2,2:3');
check(
	'the third argument is optional, so a two-argument call is unchanged',
	visibleColumnPositions(2, strip).length,
	3,
);
check(
	'a removed cell is not in the exploding set…',
	keys([false, false, true, false, false]),
	'2:1,2:3',
);
check('…and a fully exploded column clears nothing', keys([true, true, true, true, true]), '');
check(
	'a removed BUFFER row changes nothing — it was never in the set',
	keys([true, false, false, false, true]),
	'2:1,2:2,2:3',
);
check(
	'the clear passes the removal set on BOTH of its arms (whole board + one column)',
	(
		slice(flowEffects, 'clearOutgoingSymbols', 'const clearOutgoingSymbols = async (').match(
			/visibleColumnPositions\(/g,
		) ?? []
	).length,
	2,
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

// THE WIN BEAT sets it — inside the gated branch, and only there. Off (or on a replay pass) nothing
// is ever removed, which is the whole byte-parity claim.
const popBranch = board.indexOf('if (popOnWin && !isCovered) {');
check('the win beat still gates the pop on the doc flag and skips a replay', board.includes('const popOnWin = !replay && bakedWinExplodeEnabled();'), true); // prettier-ignore
check('…and the removal happens inside that branch', popBranch >= 0 && board.indexOf('reelSymbol.removed = true') > popBranch, true); // prettier-ignore
check(
	'…before the cell is settled back to rest',
	board.indexOf('reelSymbol.removed = true') < board.indexOf("reelSymbol.symbolState = 'postWinStatic'"), // prettier-ignore
	true,
);
check('the board marks exactly one cell removed, nowhere else', (board.match(/\.removed = true/g) ?? []).length, 1); // prettier-ignore
// THE BOOK-OF COLUMN MORPH uses the same `explosion` state and must NOT start vanishing — it
// explodes and then SWAPS to the special symbol, so a removal there would empty the expanded reels.
const bookMorph = slice(
	flowEffects,
	'expandBookColumns',
	'\texpandBookColumns: async (payload) => {',
);
check('the sliced morph really is the one that explodes', bookMorph.includes("symbolState = 'explosion'"), true); // prettier-ignore
check('…and it explodes without removing', bookMorph.includes('.removed = true'), false);

// THE FOUR READERS. Each one's failure is invisible in the others.
check(
	'the reel cell stops rendering a removed symbol',
	/\{#if\s+!covered\s+&&\s+!removed\s*\}/.test(reelSymbol),
	true,
);
check(
	'BOTH survivor-layer initialisers seed the removal, so the pop is not undone',
	[
		slice(tumbleBoard, 'initTumbleBoardBaseReel', '\tconst initTumbleBoardBaseReel = ('),
		slice(tumbleBoard, 'initTumbleBoardBase', '\tconst initTumbleBoardBase = ('),
	].every((source) => source.includes('boardRemoved()') && /\bremoved: removed\b/.test(source)),
	true,
);
check(
	'…and a removed seat is born already gone, so the board-wide removal sweeps it',
	tumbleBoard.includes("symbolState: (removed ? 'clearReel' : 'static') as SymbolState") &&
		tumbleBoard.includes('exploded: removed'),
	true,
);
check(
	'the explode step skips a seat that is already gone (a cascade explodes what the BOOK names)',
	tumbleBoard.includes('if (tumbleSymbol.exploded) return;'),
	true,
);
check(
	'the resting replay drops the cells the pop took off',
	slice(winCycle, 'cycleEntries', 'const cycleEntries = (').includes(
		'stateGameDerived.boardRemoved()',
	),
	true,
);

console.log(
	failures === 0
		? `\nclear-reel + win-explode: OK (${checks} checks)`
		: `\nclear-reel + win-explode: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
