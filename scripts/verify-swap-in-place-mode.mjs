// Offline fixture for the SWAP-IN-PLACE board mode (docs/design/perspective-board-mode.md, phase 2).
//
//   node scripts/verify-swap-in-place-mode.mjs
//
// WHAT IT PROVES, in five parts.
//
//   1. THE BEHAVIOUR IS AUTHORED IN THE GAME CONFIG, and it is INDEPENDENT OF `farScale`. Two
//      claims that have to hold together.
//
//      `swapInPlace`, `swapStyle` and `columnStaggerMs` are the `reelBehaviour` block of the
//      Invisible Game Config — one answer for the whole game. They used to live on the Scene
//      Editor's `reelGrid` node beside the vanishing point, and that was the wrong home: a
//      `reelGrid` node is authored PER layoutType, so the schema allowed a board that rolled in
//      portrait and swapped in landscape, or swept at two speeds depending on the phone. The whole
//      chain is exercised here — authored block → the REAL `resolveReelBehaviour` → the engine's
//      accessors — including the case that would fail most quietly: a node saved before the move
//      still carries the old fields (`normalizeNode` is pass-through), and they must have NO effect.
//
//      Independence is the trap the phase turns on, and it survives the move. The
//      seat algebra calls a board FLAT — and `boardPerspective()` returns `undefined` — whenever
//      `farScale` is absent, non-finite, `<= 0` or exactly `1`. That is correct for geometry and
//      wrong for the mode, because the design keeps the two knobs separate on purpose: "a stylised
//      game may want a converging grid that still rolls, or a flat board that swaps". So
//      `{ swapInPlace: true }` with NO `farScale` is a legal, intended configuration, and a
//      `boardSwapsInPlace` derived from `boardPerspective()` would make it do nothing at all, with
//      no error anywhere to find. Both functions are sliced out of the real module and asserted
//      against each other over the whole cross-product of the two knobs.
//
//      The one dependency that IS enforced lives in the schema, not in a consumer: `clearBoard`
//      needs `swapInPlace` and the `dropIn` style (a column cascade already empties each column by
//      draining it, so a clear there would be two clears for one round). Answered once, so the
//      engine and the authoring tool cannot answer it differently.
//
//   2. THE STAND-DOWNS return their OFF value. Reel anticipation, sequential reel stop and
//      stacked-picture mode are reel-shaped; a board with no roll stands them down. Each is gated at
//      its SOURCE — one accessor beside the flag it reads — so there is one thing to assert per
//      behaviour instead of one per consumer, and this checks each accessor over the cross-product
//      of {flag on, flag off} x {swapInPlace on, off}: it must read exactly today's value whenever
//      `swapInPlace` is absent, and false whenever it is on.
//
//   3. THE DROP-IN REVEAL leaves the board in the SAME state a spin would have. This is the claim
//      most likely to be subtly wrong, so it is driven rather than reasoned: the real
//      `dropInRevealBoard` is run against a stub event emitter wired to the REAL `tumbleBoardInit` /
//      `tumbleBoardSlideDown` handlers and the REAL `tumbleBoardCombined`, and the fixture asserts
//      the broadcast ORDER, that no explode step is in it, and that the `boardSettle` payload is the
//      revealed board CELL FOR CELL — by object identity, not by a value comparison that a rebuilt
//      lookalike board would also pass.
//
//   4. THE COLUMN CASCADE (`swapStyle: 'columnCascade'`) drains and refills column by column, LEFT
//      TO RIGHT, and lands on the same end state. Driven through the same harness — the real
//      `columnCascadeRevealBoard` against the real cue handlers — on a VIRTUAL CLOCK, so the
//      per-column stagger and the tween durations are real numbers an order and an overlap can be
//      asserted against without spending a millisecond of wall time. It asserts the sweep order,
//      that every column drains BEFORE it refills (its survivor layer is empty at the moment the
//      replacements are queued), the settle contract cell for cell, and that the stagger KNOB
//      changes the behaviour: a large one makes the columns strictly sequential, a small one
//      overlaps them into a wave.
//
//   5. THE GROUND TILES SURVIVE THE SWAP. The tiles live on the reel board, which a swap hides for
//      its whole duration, so the overlay draws the same layer while it stands in. Asserted as
//      "exactly one tile layer at a time": there is one board on screen now, so the tiles are
//      cue, and must be the art whenever the overlay owns the screen, `undefined` whenever the reel
//      board does — and `undefined` throughout for a board with no authored `tileRegion`.
//
// WHAT IT CANNOT PROVE. The two swaps are PRESENTATION sequences, and a fixture is not a renderer:
//   * Nothing here draws, so "the board looks right falling in" — or draining out — is not tested
//     and cannot be. The seat each symbol is aimed at comes from `getSymbolSeat`, which has its own
//     fixture (`verify-symbol-seat.mjs`); here it is a monotonic stand-in, because what is under
//     test is the SEQUENCE, not the algebra.
//   * TIMING AND FEEL ARE NOT TESTED, ONLY ORDER AND OVERLAP. The virtual clock makes "column 2
//     starts before column 1 has finished" a decidable statement, and that is all it makes
//     decidable: whether 140 ms reads as a wave, whether the drain's `cubicIn` looks like a fall,
//     whether a symbol snapping to its target row's scale is visible — none of that is here, and
//     only playing the game answers it.
//   * The tile assertions are on the overlay's own visibility ANSWER, not on Pixi children. That
//     `{#if tileArt}<BoardTiles>` mounts what the answer says is asserted on the markup as source
//     text, and that `BoardTiles` draws a tile per cell is `Board.svelte`'s shipped layer, unchanged.
//   * A symbol's `oncomplete` never fires (there is no `<Symbol>`), so every `land` beat resolves
//     through the cap — which is exactly what an unauthored `land` state does in the real game, but
//     it means the authored-animation path is not exercised.
//   * `enhancedBoard.settle` itself is not run; the fixture asserts what is HANDED to `boardSettle`,
//     and that the reel board consumes it is the shipped `Board.svelte` subscriber, unchanged.
//   * The reel path is asserted only negatively (the mode reads off, so the spin branch is the one
//     taken). That the spin still rolls is covered by the untouched `lines` build and its e2e.
//   * NO EXPLOSION → INTRO TRANSITION IS AUTHORED in any run here (`bakedSymbolTransition` answers
//     `undefined`, which is what it answers for a project that has not drawn one). That is the
//     shipped default and the case every claim below is about; what an authored one looks like is a
//     drawing question, and it is fire-and-forget by construction, so nothing here would see it.
//
// Everything under test is SLICED OUT OF THE SHIPPED SOURCE — the modules are runes/Svelte and
// cannot be imported from Node — so a rename or a reordering fails loudly here rather than leaving
// the fixture quietly asserting nothing. The TYPE removal that makes a slice runnable is Node's own
// `stripTypeScriptTypes`, NOT this file's idea of what an annotation looks like: hand-written
// strippers made "the component grew an annotation" a failure mode of its own, and one of those
// failures is what kept parts 3-10 from running at all for the length of a feature.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lfReaderFrom } from './lib/read-lf.mjs';
import { resolveGrid } from '../packages/game-config/src/grid.ts';
import { tumbleExplosionDelays } from '../packages/engine-layout/src/lib/tumblePattern.ts';
import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';
import { assertStubSetIsComplete } from './lib/stub-set-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = lfReaderFrom(ROOT);

let failures = 0;
let checks = 0;
const check = (label, actual, expected) => {
	checks += 1;
	if (!Object.is(actual, expected)) {
		failures += 1;
		console.log(
			`FAIL  ${label}\n      got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`,
		);
	}
};

// ---------------------------------------------------------------------------
// 1 + 2 — the mode switch and the stand-downs, from `engine-game`.
// ---------------------------------------------------------------------------

const gameStateSource = read('packages/engine-game/src/game/gameState.svelte.ts');

/** Slice `[from, to)` out of the source, or throw with the marker that went missing. */
const sliceBetween = (source, what, from, to) => {
	const start = source.indexOf(from);
	if (start < 0) throw new Error(`${what}: could not find "${from}"`);
	const end = source.indexOf(to, start);
	if (end < 0) throw new Error(`${what}: could not find "${to}" after it`);
	return source.slice(start, end + to.length);
};

/**
 * A source slice, as JavaScript this fixture can evaluate.
 *
 * Every slice below is TypeScript, and the removal used to be hand-written regexes — one per
 * annotation the sliced code happened to contain, plus a guard that threw when an unknown one got
 * through. That guard is why this file stopped running: the explosion → intro TRANSITION feature
 * added `type SeatTransition = { … }`, a `scheduleTransition` signature, `$state.raw<SeatTransition[]>`
 * and `new Map<string, ReturnType<typeof setTimeout>>()` to the TumbleBoard helper slice, and parts
 * 3, 4 and 5 went dark behind "grew a type annotation this fixture cannot strip". Node's own stripper
 * knows the whole language, so growing an annotation is no longer an event.
 */
const stripTypes = (what, source) =>
	// Runes are Svelte's, not TypeScript's, so the stripper leaves them — and here each one reduces to
	// the identity its VALUE semantics have outside a component. `.raw` first: the bare `$state(`
	// pattern would not match it, but stripping leaves the type argument's whitespace behind, so both
	// patterns have to tolerate the gap.
	stripSliceTypes(what, source)
		.replace(/\$state\.raw\s*\(/g, '(')
		.replace(/\$state\s*\(/g, '(')
		.replace(/\$derived\s*\(/g, '(');

// `boardPerspective` … `getSymbolSeat` — the same contiguous block `verify-symbol-seat.mjs` takes,
// which is where `boardSwapsInPlace` now lives too (deliberately: it sits with the geometry it is
// NOT derived from, so the two are read side by side).
const seatBlock = (() => {
	const start = gameStateSource.indexOf('\tconst boardGeometry = () => {');
	const seat = gameStateSource.indexOf('\tconst getSymbolSeat = (');
	if (start < 0 || seat < start) {
		throw new Error(
			'could not locate the boardGeometry…getSymbolSeat block in gameState.svelte.ts',
		);
	}
	const end = gameStateSource.indexOf('\n\t};\n', seat);
	if (end < 0) throw new Error('could not locate the end of getSymbolSeat');
	return (
		gameStateSource
			.slice(start, end + '\n\t};\n'.length)
			// The only TypeScript in the slice is parameter annotations.
			.replace(/: number/g, '')
			.replace(/: BoardPerspective/g, '')
	);
})();
for (const name of ['boardSwapsInPlace', 'boardSwapStyle', 'boardColumnStaggerMs']) {
	if (!seatBlock.includes(`const ${name} = () =>`)) {
		throw new Error(`${name} is no longer inside the geometry block`);
	}
}

// The three stand-down accessors, sliced as a unit — they are declared together, next to the flags
// they gate, which is the arrangement this fixture is asserting is still true.
const standDownBlock = (() => {
	const start = gameStateSource.indexOf('\tconst anticipationActive = () =>');
	const last = gameStateSource.indexOf('\tconst stackedPicturesActive = () =>');
	if (start < 0 || last < start) {
		throw new Error('the three stand-down accessors are no longer declared together');
	}
	const end = gameStateSource.indexOf('\n', last);
	return gameStateSource.slice(start, end + 1);
})();
for (const name of ['anticipationActive', 'sequentialStopActive', 'stackedPicturesActive']) {
	if (!standDownBlock.includes(`const ${name} = () =>`)) {
		throw new Error(`the stand-down slice no longer declares ${name}`);
	}
}

// The REAL layout resolver, so this is the whole chain an author's saved block travels: node →
// `resolveReelGridPerspective` → the engine's own reading of it. `verify-symbol-seat.mjs`
// deliberately stubs this one out (it is testing the seat's own guard); here it must be real,
// because "does a bare `swapInPlace` survive the resolver" is half of the claim.
const reelGridSource = read('packages/engine-layout/src/lib/reelGrid.ts');
const resolverSource = sliceBetween(
	reelGridSource,
	'resolveReelGridPerspective',
	'export function resolveReelGridPerspective(',
	'\n}\n',
)
	.replace('export function', 'function')
	.replace(/node: ReelGridNode \| undefined/, 'node')
	.replace(/\)\s*:\s*ReelGridPerspective \| undefined \{/, ') {')
	.replace(/const out: ReelGridPerspective = \{\}/, 'const out = {}')
	.replace(/\(v: unknown\): v is number =>/, '(v) =>');
if (/:\s*(ReelGridNode|ReelGridPerspective|unknown)/.test(resolverSource)) {
	throw new Error('resolveReelGridPerspective grew a type annotation this fixture cannot strip');
}

// The REAL CONFIG resolver, so the mode is proved through the chain an author's saved config
// actually travels: `/config` → `reelBehaviour` block → `resolveReelBehaviour` → the engine's
// accessors. Stubbing it would leave the defaults ("absent means the reels roll") asserted only
// against a description of themselves — and the defaults ARE the parity claim for every project
// that never opened the section.
const behaviourModule = read('packages/game-config/src/reelBehaviour.ts');
const behaviourSource = [
	sliceBetween(behaviourModule, 'isSwapStyle', 'const isSwapStyle = ', ';\n'),
	sliceBetween(
		behaviourModule,
		'resolveReelBehaviour',
		'export function resolveReelBehaviour(',
		'\n}\n',
	),
]
	.join('\n')
	.replace('export function', 'function')
	.replace(/\(\s*doc:[\s\S]*?\n\): ResolvedReelBehaviour \{/, '(doc) {')
	.replace(/\(value: unknown\): value is SwapStyle =>/, '(value) =>')
	.replace(/ as SwapStyle/g, '');
if (/:\s*(Pick|ResolvedReelBehaviour|SwapStyle|unknown)/.test(behaviourSource)) {
	throw new Error('resolveReelBehaviour grew a type annotation this fixture cannot strip');
}
// Read from the schema rather than restated, so adding a style there without teaching this fixture
// about it fails here instead of silently going untested.
const SWAP_STYLES = (() => {
	const match = read('packages/game-config/src/types.ts').match(
		/export const SWAP_STYLES = \[([\s\S]*?)\] as const;/,
	);
	if (!match) throw new Error('types.ts no longer declares SWAP_STYLES');
	return match[1]
		.split(',')
		.map((entry) => entry.trim().replace(/^'|'$/g, ''))
		.filter(Boolean);
})();
const behaviourCeiling = (() => {
	const match = behaviourModule.match(/export const REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS = (\d+);/);
	if (!match) throw new Error('reelBehaviour.ts no longer exports the column-stagger ceiling');
	return Number(match[1]);
})();

/** The engine's `deps.reelBehaviour`, built the way the app builds it: the REAL resolver, over the
 *  block a project would have authored in `/config` → Reel behaviour. */
const behaviourDep = compileSlice({
	what: 'verify-swap-in-place-mode / reelBehaviour.ts#resolveReelBehaviour',
	names: ['SWAP_STYLES', 'REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS', 'reelBehaviour'],
	body: `${behaviourSource}\nreturn () => resolveReelBehaviour({ reelBehaviour });`,
});

const constantsSource = read('packages/engine-game/src/game/constants.ts');
const readConst = (name) => {
	const match = constantsSource.match(new RegExp(`export const ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`constants.ts no longer exports ${name}`);
	return Number(match[1]);
};

const buildEngine = compileSlice({
	what: 'verify-swap-in-place-mode / gameState.svelte.ts#boardSwapsInPlace+getSymbolSeat',
	names: [
		'SYMBOL_SIZE',
		'REEL_PADDING',
		'resolveReelGridFromNode',
		'boardOverride',
		'deps',
		'stateGame',
	],
	body: `${resolverSource}
${seatBlock}
${standDownBlock}
return {
	boardPerspective,
	boardSwapsInPlace,
	boardSwapStyle,
	boardColumnStaggerMs,
	boardClearsOutgoing,
	getSymbolSeat,
	anticipationActive,
	sequentialStopActive,
	stackedPicturesActive,
};`,
});

/**
 * @param perspective the authored `perspective` block on the reelGrid NODE — SHAPE only now — or
 *   undefined for "no block at all"
 * @param flags the three reel-shaped runtime flags, as a game's `stateGame` carries them
 * @param behaviour the authored `reelBehaviour` block in the GAME CONFIG, or undefined for "the
 *   project never opened the Reel behaviour section"
 */
const engineFor = (perspective, flags = {}, behaviour = undefined) =>
	buildEngine(
		readConst('SYMBOL_SIZE'),
		readConst('REEL_PADDING'),
		() => null,
		{ node: perspective === undefined ? null : { perspective } },
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: 5, y: 3 }),
			// Uniform: these fixtures do not exercise stepped grids, so every seat below takes the
			// same pass-through it took before `activeGrid` existed.
			activeGrid: () => resolveGrid({ numReels: 5, numRows: [3, 3, 3, 3, 3] }),
			reelBehaviour: behaviourDep(SWAP_STYLES, behaviourCeiling, behaviour),
		},
		{
			anticipationMode: false,
			sequentialReelStop: false,
			stackedPictureMode: false,
			...flags,
		},
	);

console.log('--- 1. the behaviour is authored in the CONFIG, independently of the geometry ---');

const SWAP = { swapInPlace: true };

// THE TRAP, stated as the assertion: the mode switches ON while leaving the board geometrically
// FLAT. Both halves matter — an implementation gated on `boardPerspective()` fails the first line,
// and one that quietly turned the geometry on fails the second.
{
	const engine = engineFor(undefined, {}, SWAP);
	check('config swapInPlace: the mode is ON', engine.boardSwapsInPlace(), true);
	check('config swapInPlace: the board is still FLAT', engine.boardPerspective(), undefined);
	const flat = engineFor(undefined);
	check(
		'config swapInPlace: the seat is byte-identical to a board that authored nothing',
		engine.getSymbolSeat(3, 2).y,
		flat.getSymbolSeat(3, 2).y,
	);
	check(
		'config swapInPlace: and so is its x',
		engine.getSymbolSeat(3, 2).x,
		flat.getSymbolSeat(3, 2).x,
	);
	check('config swapInPlace: and its scale', engine.getSymbolSeat(3, 2).scale, 1);
}

// THE MOVE, asserted where it would fail most quietly.
//
// All three behaviour knobs (`swapInPlace`, `swapStyle`, `columnStaggerMs`) used to live on the
// reelGrid node's `perspective` block, and that was the wrong home: a `reelGrid` node is authored
// PER layoutType, so the schema allowed a board that rolled in portrait and swapped in landscape, or
// swept at two different speeds depending on the phone. They now live in the game config, once.
//
// A node saved before the move still CARRIES the old fields — `normalizeNode` is pass-through, so
// they survive every save — and they must have no effect. An engine still reading them would keep
// working on exactly the docs where they are wrong, and the `/config` switch the author is now
// looking at would appear to do nothing.
{
	const stale = engineFor({ swapInPlace: true, swapStyle: 'columnCascade', columnStaggerMs: 300 });
	check(
		'a stale perspective.swapInPlace does NOT switch the mode',
		stale.boardSwapsInPlace(),
		false,
	);
	check('a stale perspective.swapStyle is not read', stale.boardSwapStyle(), 'dropIn');
	check('a stale perspective.columnStaggerMs is not read', stale.boardColumnStaggerMs(), undefined);
	check(
		'...and a stale block with farScale beside it still does its GEOMETRY',
		typeof engineFor({ farScale: 0.6, swapInPlace: true }).boardPerspective(),
		'object',
	);
	check(
		'the config decides, whatever the node says',
		engineFor({ swapInPlace: true }, {}, { swapInPlace: false }).boardSwapsInPlace(),
		false,
	);
	check(
		'...in both directions',
		engineFor({ swapInPlace: false }, {}, SWAP).boardSwapsInPlace(),
		true,
	);
}

// The mirror image: a converging grid that still ROLLS. `farScale` alone must not switch the mode.
{
	const engine = engineFor({ farScale: 0.6 });
	check('bare farScale: the mode is OFF', engine.boardSwapsInPlace(), false);
	check('bare farScale: the geometry is ON', typeof engine.boardPerspective(), 'object');
}

// Both together, and neither.
{
	const both = engineFor({ farScale: 0.6 }, {}, SWAP);
	check('both knobs: the mode is ON', both.boardSwapsInPlace(), true);
	check('both knobs: the geometry is ON', typeof both.boardPerspective(), 'object');

	const none = engineFor(undefined);
	check('nothing authored: the mode is OFF', none.boardSwapsInPlace(), false);
	check('nothing authored: the geometry is OFF', none.boardPerspective(), undefined);
}

// Every "flat" `farScale` the seat algebra rejects must STILL leave the mode alone — this is the
// regression a shared early-return would reintroduce.
for (const farScale of [1, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
	const engine = engineFor({ farScale }, {}, SWAP);
	check(
		`flat farScale=${String(farScale)}: the mode is still ON`,
		engine.boardSwapsInPlace(),
		true,
	);
	check(
		`flat farScale=${String(farScale)}: the board is still flat`,
		engine.boardPerspective(),
		undefined,
	);
}

// And the off state is genuinely off: only a real `true` counts, because the block is authored data.
for (const swapInPlace of [false, undefined, 'true', 1, null]) {
	check(
		`swapInPlace=${JSON.stringify(swapInPlace)} is not the mode`,
		engineFor(undefined, {}, { swapInPlace }).boardSwapsInPlace(),
		false,
	);
}

// THE SWAP STYLE — a sibling of the mode switch, with the same defensive shape. Absent ⇒ `'dropIn'`
// ⇒ the shipped presentation, the parity claim for every project authored before it existed.
{
	const none = engineFor(undefined);
	check('nothing authored ⇒ the shipped drop-in', none.boardSwapStyle(), 'dropIn');
	check('nothing authored ⇒ no authored stagger', none.boardColumnStaggerMs(), undefined);

	const swapping = engineFor(undefined, {}, SWAP);
	check('swapInPlace with no style ⇒ the shipped drop-in', swapping.boardSwapStyle(), 'dropIn');

	const cascade = engineFor(undefined, {}, { swapInPlace: true, swapStyle: 'columnCascade' });
	check(
		'an authored columnCascade survives the resolver',
		cascade.boardSwapStyle(),
		'columnCascade',
	);
	check('and it does not switch the geometry on', cascade.boardPerspective(), undefined);
	check('and the mode is still on', cascade.boardSwapsInPlace(), true);

	// The style is authored DATA, so anything that is not one of the recognised literals must read as
	// the shipped drop-in rather than reach a presentation branch that does not exist.
	for (const swapStyle of ['columncascade', 'cascade', '', 0, 1, true, null, undefined, {}]) {
		check(
			`swapStyle=${JSON.stringify(swapStyle)} ⇒ the shipped drop-in`,
			engineFor(undefined, {}, { swapInPlace: true, swapStyle }).boardSwapStyle(),
			'dropIn',
		);
	}
	// A style with no mode beside it is INERT, not an error: the reveal reaches no swap presentation
	// at all, so this is only ever read on a board that swaps.
	check(
		'a style with no swapInPlace leaves the mode off',
		engineFor(undefined, {}, { swapStyle: 'columnCascade' }).boardSwapsInPlace(),
		false,
	);
	// Every DECLARED style must be reachable — a literal added to the schema and forgotten in the
	// resolver would otherwise fall silently back to the drop-in.
	for (const swapStyle of SWAP_STYLES) {
		check(
			`the declared style ${swapStyle} round-trips`,
			engineFor(undefined, {}, { swapInPlace: true, swapStyle }).boardSwapStyle(),
			swapStyle,
		);
	}
}

// THE STAGGER — passed through raw (the presentation owns the default), and `0` must survive, since
// "every column at once" is a legal authoring choice that a truthiness test would silently replace.
{
	const cascading = (columnStaggerMs) =>
		engineFor(undefined, {}, { swapInPlace: true, swapStyle: 'columnCascade', columnStaggerMs });
	check('an authored stagger survives', cascading(320).boardColumnStaggerMs(), 320);
	check(
		'a zero stagger survives — it means "no sweep", not "unset"',
		cascading(0).boardColumnStaggerMs(),
		0,
	);
	check(
		'a stagger above the ceiling is clamped by the schema, not by a caller',
		cascading(99999).boardColumnStaggerMs(),
		behaviourCeiling,
	);
	for (const columnStaggerMs of [
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		'120',
		null,
		undefined,
	]) {
		check(
			`columnStaggerMs=${String(columnStaggerMs)} ⇒ unset, the presentation's default applies`,
			cascading(columnStaggerMs).boardColumnStaggerMs(),
			undefined,
		);
	}
}

// THE CLEAR STEP — the one knob whose precondition the SCHEMA owns, so the engine and the authoring
// tool cannot answer "is this live" differently. It needs `swapInPlace` and nothing else: a rolling
// round replaces nothing, it re-spins. Both styles honour it — the whole board at once under
// `dropIn`, one column per beat under `columnCascade`, where it takes the place of the drain.
{
	const clearing = (reelBehaviour) => engineFor(undefined, {}, reelBehaviour).boardClearsOutgoing();
	check('nothing authored ⇒ nothing clears', engineFor(undefined).boardClearsOutgoing(), false);
	check('clearBoard with no mode ⇒ inert', clearing({ clearBoard: true }), false);
	check(
		'clearBoard + swapInPlace ⇒ live (dropIn is the default style)',
		clearing({ ...SWAP, clearBoard: true }),
		true,
	);
	check(
		'clearBoard + swapInPlace + dropIn ⇒ live',
		clearing({ ...SWAP, swapStyle: 'dropIn', clearBoard: true }),
		true,
	);
	// THE CORRECTION (owner-reported): an earlier cut gated this to `dropIn`, reasoning that a
	// cascade's drain already empties the column. It does — but a drain and a clear are two different
	// PICTURES of that beat (slide out of the window vs pop in place), so under a cascade the clear
	// REPLACES the drain, per column. Gating it there took a real choice away from the author.
	check(
		'clearBoard under a columnCascade ⇒ LIVE, the clear replaces the drain per column',
		clearing({ ...SWAP, swapStyle: 'columnCascade', clearBoard: true }),
		true,
	);
	check('swapInPlace alone does not imply a clear', clearing(SWAP), false);
	for (const clearBoard of [false, undefined, 'true', 1, null]) {
		check(
			`clearBoard=${JSON.stringify(clearBoard)} is not a clear`,
			clearing({ ...SWAP, clearBoard }),
			false,
		);
	}
}

console.log('--- 2. the reel-shaped behaviours stand down ---');

// Each accessor over the cross-product of its own flag and the mode. The `swapInPlace: undefined`
// column is the parity claim: today's value, unchanged, for every game that authors nothing.
const standDowns = [
	['anticipationActive', 'anticipationMode'],
	['sequentialStopActive', 'sequentialReelStop'],
	['stackedPicturesActive', 'stackedPictureMode'],
];
for (const [accessor, flag] of standDowns) {
	for (const flagValue of [false, true]) {
		const off = engineFor(undefined, { [flag]: flagValue });
		check(
			`${accessor} with ${flag}=${flagValue}, no mode ⇒ today's value`,
			off[accessor](),
			flagValue,
		);

		const swapping = engineFor(undefined, { [flag]: flagValue }, SWAP);
		check(
			`${accessor} with ${flag}=${flagValue}, swapInPlace ⇒ stood down`,
			swapping[accessor](),
			false,
		);

		// And it stands down on a FLAT swapping board too — the same trap, one level down: gating a
		// stand-down on the geometry would leave every reel behaviour live on exactly the board that
		// has no reels.
		const flatSwapping = engineFor({ farScale: 1 }, { [flag]: flagValue }, SWAP);
		check(
			`${accessor} with ${flag}=${flagValue}, flat + swapInPlace ⇒ stood down`,
			flatSwapping[accessor](),
			false,
		);

		// A converging board that still rolls keeps every one of them.
		const converging = engineFor({ farScale: 0.6 }, { [flag]: flagValue });
		check(
			`${accessor} with ${flag}=${flagValue}, farScale only ⇒ today's value`,
			converging[accessor](),
			flagValue,
		);
	}
}

// ---------------------------------------------------------------------------
// 3 — the drop-in reveal, driven.
// ---------------------------------------------------------------------------

console.log('--- 3. the drop-in reveal ---');

const ROWS = 3;
const REELS = 5;
/** A reel strip is padded one buffer row top and bottom, so it is `rows + 2` long. */
const STRIP = ROWS + 2;

// The board's PADDING fact left the component too, and earlier: #443 moved `PAD_ROWS_ABOVE` and the
// stacking rule into `apps/lines/src/game/tumbleBoardLayout.ts` — plain TS on purpose, because that
// rule had shipped wrong for months precisely because nothing outside a browser could execute it.
// This fixture was already broken by that move; the marker crash above simply died first and hid it.
//
// Both are sliced rather than restated, and `combineTumbleReel` especially: it is what
// `tumbleBoardCombined` stacks each column by, so it decides WHERE the refills sit relative to the
// pads — and a fixture that stacked by its own copy of that rule would assert the settle contract
// cell for cell against a board the shipped one no longer produces. That is the exact shape of the
// bug #443 fixed, so it is the one thing here that must not be a restatement.
const tumbleLayoutSource = read('apps/lines/src/game/tumbleBoardLayout.ts');
const layoutHelpers = [
	sliceBetween(tumbleLayoutSource, 'PAD_ROWS_ABOVE', 'export const PAD_ROWS_ABOVE = ', ';\n'),
	sliceBetween(
		tumbleLayoutSource,
		'combineTumbleReel',
		'export const combineTumbleReel = ',
		'];\n',
	),
]
	.join('')
	.replace(/export const /g, 'const ');

// The beat CAP the cascade races against is no longer declared in the component. It used to be
// `CASCADE_BEAT_CAP_MS`, sliced from `TumbleBoard.svelte` right here; #442 moved both the race and
// the cap into `apps/lines/src/game/symbolBeat.ts`, because the win beat (`Board.svelte`) and the
// multiplier collect need the identical guard for the identical reason, and the win beat had
// shipped for months without one. Nothing about the cascade's behaviour changed — the same race
// against the same 650ms — but the declaration this fixture keyed on left the file, and the marker
// went with it, so the fixture crashed before asserting anything rather than failing a check.
//
// So the race and the cascade's own cap are sliced out of THAT module and prepended to the helpers,
// rather than restated here: the fixture still drives the SHIPPED race against the SHIPPED number
// (every `land` beat below resolves through it, since no symbol reports `oncomplete` with no
// renderer mounted), and a rename in `symbolBeat.ts` now fails as loudly as one in the component.
const symbolBeatSource = read('apps/lines/src/game/symbolBeat.ts');
/** The two caps, read from the shipped module rather than restated, so re-timing either one updates
 *  the fixture's arithmetic instead of breaking it. */
const capOf = (name) =>
	Number(
		sliceBetween(symbolBeatSource, name, `export const ${name} = `, ';\n').replace(/[^\d]/g, ''),
	);
const TRANSIT_CAP_MS = capOf('TRANSIT_BEAT_CAP_MS');
const INTRO_CAP_MS = capOf('INTRO_BEAT_CAP_MS');
const beatHelpers = [
	sliceBetween(symbolBeatSource, 'awaitSymbolBeat', 'export const awaitSymbolBeat = ', ';\n'),
	sliceBetween(
		symbolBeatSource,
		'TRANSIT_BEAT_CAP_MS',
		'export const TRANSIT_BEAT_CAP_MS = ',
		';\n',
	),
	// The emerge beat is capped separately (an arrival animation, not a step on the way to one), so
	// the handler slice below would throw on an undefined name without it. Read from the shipped
	// module rather than restated, like every other constant here.
	sliceBetween(symbolBeatSource, 'INTRO_BEAT_CAP_MS', 'export const INTRO_BEAT_CAP_MS = ', ';\n'),
]
	.join('')
	.replace(/export const /g, 'const ');

// The real cascade board's helpers + cue handlers, sliced out of `TumbleBoard.svelte`. Only the
// module's TYPE annotations are removed; the bodies are the shipped ones.
const tumbleComponent = read('apps/lines/src/components/TumbleBoard.svelte');
const componentScript = tumbleComponent.slice(tumbleComponent.lastIndexOf('<script lang="ts">'));
const helpers = stripTypes(
	'the TumbleBoard helper slice',
	(
		layoutHelpers +
		beatHelpers +
		sliceBetween(
			componentScript,
			'the TumbleBoard helpers',
			'\tconst inTransit =',
			'\tcontext.eventEmitter.subscribeOnMount({',
		)
	).replace('\tcontext.eventEmitter.subscribeOnMount({', ''),
);
for (const name of [
	'PAD_ROWS_ABOVE',
	'combineTumbleReel',
	'awaitSymbolBeat',
	'TRANSIT_BEAT_CAP_MS',
	'awaitBeat',
	'inTransit',
	'initTumbleBoardAddingReel',
	'initTumbleBoardAdding',
	'initTumbleBoardNoBase',
	'initTumbleBoardBaseReel',
	'initTumbleBoardBase',
	'createArrivingCells',
]) {
	if (!helpers.includes(`const ${name} = `)) {
		throw new Error(`the TumbleBoard slice no longer declares ${name}`);
	}
}

/** The `subscribeOnMount({ … })` argument, by brace balance. */
const handlersSource = (() => {
	const marker = 'context.eventEmitter.subscribeOnMount(';
	const start = componentScript.indexOf(marker) + marker.length;
	if (start < marker.length) throw new Error('TumbleBoard.svelte no longer subscribes on mount');
	let depth = 0;
	for (let i = start; i < componentScript.length; i += 1) {
		if (componentScript[i] === '{') depth += 1;
		else if (componentScript[i] === '}') {
			depth -= 1;
			if (depth === 0) return componentScript.slice(start, i + 1);
		}
	}
	throw new Error('could not find the end of the TumbleBoard cue handlers');
})();
/** The same block as a DECLARATION, stripped — what the runtime below evaluates. `handlersSource`
 *  itself stays raw, because part 9 asserts against it as source text. */
const handlersDecl = stripTypes(
	'the TumbleBoard cue handlers',
	`const handlers = ${handlersSource};`,
);

// The cascade board's own state, sliced too — `tumbleBoardCombined` is the function that decides
// what the drop-in settles on, so it must be the real one.
const tumbleState = read('apps/lines/src/game/stateTumble.svelte.ts');
const tumbleStateRaw = [
	sliceBetween(tumbleState, 'stateTumble', 'export const stateTumble = ', '});\n'),
	sliceBetween(tumbleState, 'attachCascadeSeat', 'export const attachCascadeSeat = ', '\n};\n'),
	sliceBetween(tumbleState, 'releaseCascadeCells', 'export const releaseCascadeCells = ', '\n};\n'),
	sliceBetween(tumbleState, 'tumbleBoardCombined', 'export const tumbleBoardCombined = ', ';\n'),
	sliceBetween(tumbleState, 'resetTumbleBoard', 'export const resetTumbleBoard = ', '\n};\n'),
]
	.join('\n')
	.replace(/export const /g, 'const ');
const tumbleStateSource = stripTypes('the stateTumble slice', tumbleStateRaw);

// The reveal presentation itself, sliced out of the shared module both drivers now call.
const flowEffects = read('apps/lines/src/game/flowEffects.ts');
// The CLEAR step lives beside it and is the drop-in's only branch, so it is sliced too — asserting
// the sequence against a hand-written stand-in would prove the fixture, not the game. Prepended to
// the drop-in slice below, because the drop-in calls it by name.
const clearSource = stripTypes(
	'the clearOutgoingSymbols slice',
	[
		sliceBetween(flowEffects, 'visibleColumnPositions', 'const visibleColumnPositions = (', ';\n'),
		sliceBetween(
			flowEffects,
			'clearOutgoingSymbols',
			'const clearOutgoingSymbols = async (',
			'\n};\n',
		),
	].join('\n'),
);
if (!clearSource.includes('tumbleBoardExplode') || !clearSource.includes('RemoveExploded')) {
	throw new Error('clearOutgoingSymbols no longer runs the explode + remove pair');
}
// The per-column removal MUST name its column. A cascade runs its columns concurrently on an
// absolute stagger, so an unscoped filter would take a neighbour's symbols mid-explosion.
if (!clearSource.includes("type: 'tumbleBoardRemoveExploded', reelIndex")) {
	throw new Error('the per-column clear no longer scopes its removal to the column');
}
const dropInSource = stripTypes(
	'the dropInRevealBoard slice',
	sliceBetween(flowEffects, 'dropInRevealBoard', 'const dropInRevealBoard = async (', '\n};\n'),
);
// A reveal has nothing to explode of its OWN — nothing has won yet. The explode/remove pair reaches
// a round only through the authored clear step above, which is a separate claim with its own run
// below; leaked back into the drop-in body it would fire on every project, authored or not.
if (dropInSource.includes('tumbleBoardExplode') || dropInSource.includes('RemoveExploded')) {
	throw new Error('dropInRevealBoard explodes symbols — a reveal has nothing to explode yet');
}
/** What the fixture actually EVALUATES for a drop-in run: the clear helper the body calls by name,
 *  then the body. `dropInSource` stays pure so the explode guard above still has something to
 *  guard. */
const dropInPresentation = `${clearSource}\n${dropInSource}`;

// `presentReveal` must route through it rather than the spin when the mode is on. Asserted on the
// SOURCE because the branch reads `stateGameDerived`, which a Node fixture cannot stand up whole.
const presentReveal = sliceBetween(
	flowEffects,
	'presentReveal',
	'export const presentReveal = async (',
	'\n};\n',
);
check(
	'presentReveal branches on the board mode',
	presentReveal.includes('stateGameDerived.boardSwapsInPlace()') &&
		presentReveal.includes('await dropInRevealBoard(bookEvent);'),
	true,
);
check(
	'the drop-in asks the config before it clears, and clears BEFORE it queues the new board',
	dropInSource.indexOf('boardClearsOutgoing()') > -1 &&
		dropInSource.indexOf('boardClearsOutgoing()') < dropInSource.indexOf('tumbleBoardInit'),
	true,
);
check(
	'presentReveal still spins when it does not',
	presentReveal.includes('await stateGameDerived.enhancedBoard.spin({'),
	true,
);
check(
	'the sequential-stop stand-down is read at the one remaining spin call site',
	presentReveal.includes('forceSequentialStop: stateGameDerived.sequentialStopActive(),'),
	true,
);
// The other driver must not have kept a copy — one implementation is the point.
const codedHandlers = read('apps/lines/src/game/bookEventHandlerMap.ts');
check(
	'the coded reveal handler no longer spins the board itself',
	codedHandlers.includes('enhancedBoard.spin('),
	false,
);
check(
	'the coded reveal handler calls the shared one',
	codedHandlers.includes('presentReveal({'),
	true,
);
check(
	'the flow revealBoard effect calls the shared one',
	flowEffects.includes('revealBoard: async (payload) =>\n\t\tpresentReveal({') ||
		flowEffects.includes('revealBoard: async (payload) => presentReveal({'),
	true,
);

// The COLUMN CASCADE presentation, sliced out of the same module — plus its default stagger, so the
// fixture asserts the number the game actually ships rather than a copy of it.
const columnCascadeSource = stripTypes(
	'the columnCascadeRevealBoard slice',
	sliceBetween(
		flowEffects,
		'columnCascadeRevealBoard',
		'const columnCascadeRevealBoard = async (',
		'\n};\n',
	),
);
/** What the fixture EVALUATES for a cascade run. The body references `clearOutgoingSymbols` on its
 *  clearing branch, so the helper is in scope for every run; `columnCascadeSource` stays pure so the
 *  "a reveal explodes nothing of its own" guard below still has something to guard. */
const columnCascadePresentation = `${clearSource}\n${columnCascadeSource}`;

const COLUMN_CASCADE_STAGGER_MS = Number(
	sliceBetween(
		flowEffects,
		'COLUMN_CASCADE_STAGGER_MS',
		'const COLUMN_CASCADE_STAGGER_MS = ',
		';\n',
	).replace(/[^\d.]/g, ''),
);
if (!Number.isFinite(COLUMN_CASCADE_STAGGER_MS) || COLUMN_CASCADE_STAGGER_MS <= 0) {
	throw new Error('could not read COLUMN_CASCADE_STAGGER_MS out of flowEffects.ts');
}
check(
	'presentReveal branches on the swap STYLE, early-returning the shipped drop-in',
	presentReveal.includes('stateGameDerived.boardSwapStyle()') &&
		presentReveal.includes("swapStyle === 'columnCascade'") &&
		presentReveal.includes('await columnCascadeRevealBoard(bookEvent);'),
	true,
);
check(
	'...and reaches the emerge style by its own arm, not by falling through to the drop-in',
	presentReveal.includes("swapStyle === 'emerge'") &&
		presentReveal.includes('await emergeRevealBoard(bookEvent);') &&
		presentReveal.indexOf('await emergeRevealBoard(bookEvent);') <
			presentReveal.indexOf('await dropInRevealBoard(bookEvent);'),
	true,
);
if (
	columnCascadeSource.includes('tumbleBoardExplode') ||
	columnCascadeSource.includes('Exploded')
) {
	throw new Error(
		'columnCascadeRevealBoard explodes symbols — a reveal has nothing to explode yet',
	);
}

/**
 * A VIRTUAL CLOCK. Every wait in the harness — a `Tween`'s duration, the cascade beat cap, the
 * per-column stagger — is scheduled on this rather than on wall time, and the driver advances it to
 * the next due timer once the microtask queue is empty.
 *
 * It is what makes the STAGGER assertable. The knob's whole claim is relative ("a large stagger
 * makes the columns strictly sequential, a small one overlaps them"), which needs durations that
 * actually elapse — and with real timers a sequential 5-column run would cost seconds of wall time
 * per case for the privilege. Here the same run costs nothing and the times are exact integers, so
 * "column 2 started before column 1 finished" is decidable rather than flaky.
 *
 * It still proves only ORDER and OVERLAP. See the header: how any of it FEELS is not in scope.
 */
const createClock = () => {
	let now = 0;
	let seq = 0;
	let timers = [];
	/** Let Node drain the entire microtask queue — a macrotask boundary is the only way to know
	 *  every already-resolved `await` in the chain has run. */
	const drainMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
	const wait = (ms) =>
		new Promise((resolve) => {
			const delay = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
			seq += 1;
			timers.push({ at: now + delay, seq, resolve });
		});
	const run = async (task) => {
		let finished = false;
		const done = task().then((value) => {
			finished = true;
			return value;
		});
		for (let guard = 0; guard < 100000; guard += 1) {
			await drainMicrotasks();
			if (finished) break;
			if (!timers.length) {
				throw new Error('the virtual clock deadlocked: nothing pending and nothing scheduled');
			}
			now = timers.reduce((min, timer) => Math.min(min, timer.at), Number.POSITIVE_INFINITY);
			// Ties resolve in the order they were armed, so a run is deterministic.
			const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.seq - b.seq);
			timers = timers.filter((timer) => timer.at > now);
			for (const timer of due) timer.resolve();
		}
		await drainMicrotasks();
		return done;
	};
	return { wait, run, at: () => now };
};

/** A `Tween` that takes its authored `duration` on the virtual clock. */
/**
 * The overlay's `Tween`, on the virtual clock — and a LEDGER of every `set` it is asked for.
 *
 * The ledger exists for the emerge style, whose entire claim is a NEGATIVE one: no symbol travels.
 * That is not observable in the end state (a drop-in and an emerge settle on identical boards) and
 * it is not observable in the cue log either (both styles end with the symbols on their seats). The
 * only place the difference lives is the DURATION each placement is asked for — 200 ms for a fall,
 * `0` for an appearance — so that is what is recorded and asserted.
 */
const tweenClass = (clock, moves) =>
	class Tween {
		constructor(value) {
			this.current = value;
		}
		async set(value, options) {
			moves?.push({ to: value, duration: options?.duration, at: clock.at() });
			await clock.wait(options?.duration);
			this.current = value;
		}
	};

const rawSymbol = (name) => ({ name });

/**
 * ONE REEL CELL, the shape `createReelForSpinning` mints — because the cascade no longer builds a
 * parallel set of its own. It ADOPTS the board's cells and mints the step's arrivals through the
 * reel's own factory (`docs/design/board-cell-continuity.md`), so a fixture standing in for the
 * reels has to hand it objects of that shape or the handlers under test are not the shipped ones.
 *
 * `symbolY` closes over the CELL rather than over the index it was built at, because a strip
 * renumbers a cell when it adopts one — reading the live field is what the real one does.
 */
const makeReelCell = (raw, symbolIndex, removed) => {
	const cell = {
		id: {},
		rawSymbol: raw,
		symbolIndex,
		symbolState: 'static',
		symbolY: () => (cell.symbolIndex + 0.5) * 120,
		oncomplete: () => {},
		winLineColor: undefined,
		removed,
		cascade: null,
	};
	return cell;
};

/** The reel API the cascade actually touches: the settled strip it adopts, and the factory it
 *  mints the step's arrivals through. */
const makeReel = (strip, removedStrip) => ({
	reelState: {
		symbols: strip.map((raw, row) => makeReelCell(raw, row, Boolean(removedStrip?.[row]))),
	},
	createSymbols: (raws) => raws.map((raw, row) => makeReelCell(raw, row, false)),
});
/** A padded strip: one buffer row, `ROWS` visible rows, one buffer row. */
const stripOf = (prefix) =>
	Array.from({ length: STRIP }, (_unused, row) => rawSymbol(`${prefix}${row}`));
const boardOf = (prefix) =>
	Array.from({ length: REELS }, (_unused, reel) => stripOf(`${prefix}${reel}-`));

/**
 * The real `TumbleBoard.svelte` cue handlers, standing on a virtual clock.
 *
 * `show` and `reelBoardShown` are declared here rather than sliced, because they live above the
 * helper block the slice takes — with the SAME initial values the component gives them (`false` and
 * `true`), which is load-bearing for the tile guard: `Board.svelte` mounts showing, so the overlay
 * must start out believing the reels own the screen.
 *
 * The transit counter lives above that block too and is SLICED anyway (see `helpers`), because
 * unlike those two it has behaviour: `inTransit` awaits the movement it wraps, and a stand-in that
 * forgot to would silently un-order every beat measured below.
 */
let stubSetChecked = false;

const buildTumbleRuntime = ({
	clock,
	previousBoard,
	// Nothing removed unless a run says so — the empty matrix answers `undefined` per cell, which is
	// the same "not removed" every board that never turned the pop on reports.
	previousRemoved = [],
	tileArt,
	onLand,
	onSound,
	moves,
	authoredIntro,
	swapStyle,
	/** `/symbols` → Transition → the arrival release. OFF is the unauthored project, and the premise
	 *  every timing in this file is written against: the emerge arrival is AWAITED. */
	releaseOnArrival = false,
}) => {
	// The REELS this cascade drives. Their settled cells are what it adopts, and their factory is
	// what it mints the step's arrivals through — see `makeReel`.
	const stateGame = {
		board: previousBoard.map((strip, reelIndex) => makeReel(strip, previousRemoved[reelIndex])),
	};
	/**
	 * The stub set: every module the slices import and this fixture does not run. Written as an
	 * OBJECT, not as the two positional lists `new Function` wants, because a positional list can
	 * drift out of step with ITSELF — insert one name and every stub below it is silently bound to
	 * the wrong value. Keys and values travel together here by construction, and the guard below
	 * reads the keys.
	 */
	const stubs = {
		Tween: tweenClass(clock, moves),
		backOut: (t) => t,
		cubicIn: (t) => t,
		waitForResolve: (arm) => new Promise((resolve) => arm(resolve)),
		// The beat CAP on the virtual clock: no symbol reports `oncomplete` here (there is no
		// renderer), so every beat resolves through this race arm — which is exactly what an
		// unauthored `land` state does in the real game.
		waitForTimeout: (ms) => clock.wait(ms),
		// A monotonic stand-in. The real seat algebra has its own fixture; what is under test here is
		// which seat each symbol is AIMED at, not what that seat evaluates to. With `ROWS = 3` the
		// board window bottom is 360, so anything a drain leaves below that is out of the window.
		getSymbolSeat: (reel, row) => ({ x: reel * 120, y: (row + 0.5) * 120, scale: 1 }),
		// THE REELS THEMSELVES, not only the derived view of them. The cascade adopts their settled
		// cells and mints its arrivals through their factory, so a stub that answered only
		// `boardRaw()` would leave the helpers under test unreachable.
		stateGame,
		stateGameDerived: {
			boardRaw: () => previousBoard,
			// WHICH seats the end-of-win pop already emptied — all-`false` for every run but the one
			// that turns it on, which is what makes the removal's claims below a difference rather than
			// a restatement of the default board.
			boardRemoved: () => previousRemoved,
			boardTileArt: () => tileArt,
			onSymbolLand: ({ rawSymbol: landedSymbol }) => onLand?.(landedSymbol.name),
			// Every board this fixture drives IS a swap-in-place one — that is the mode under test —
			// and the STYLE is whichever presentation the caller is driving. The explode handler reads
			// both to decide whether a transition bridges the pop into the intro, a question only the
			// emerge style answers yes to.
			boardSwapsInPlace: () => true,
			boardSwapStyle: () => swapStyle,
		},
		// The overlay's handlers PLAY things now (the cascade pop, a symbol's own pop, a symbol's own
		// emerge voice). Stubbed rather than ignored, and RECORDED rather than no-op'd: what a beat
		// sounds like is part of what it does, and a cue that stopped firing would otherwise leave no
		// trace here at all. The real players are `soundBindings.ts`, which reads baked project data
		// no fixture has — so what is asserted is that the beat asks, not what it picks.
		playTumbleExplosionSound: () => onSound?.('tumbleExplosion'),
		playSymbolClearReelSound: (symbolName) => onSound?.(`symbol:clearReel:${symbolName}`),
		playSymbolIntroSound: (symbolName) => onSound?.(`symbol:intro:${symbolName}`),
		// WHICH SYMBOLS AUTHORED AN INTRO. A parameter rather than a constant, because the whole
		// point of the predicate is that the two answers cost different amounts of time, and a
		// fixture that could only exercise one of them would not be testing the rule at all.
		// Default: NOTHING is authored. That is the state every project is in the day the style
		// ships, and it is the case that regressed — so it is the one the fixture runs by default.
		hasAuthoredSymbolState: (symbolName, state) => Boolean(authoredIntro?.(symbolName, state)),
		// THE EXPLOSION → INTRO TRANSITION, unauthored — which is what `bakedSymbolTransition()`
		// returns for every project that has not drawn one, and therefore the behaviour every claim
		// below is about. What a transition DOES is not in scope here (nothing in a fixture draws);
		// what is in scope is that the explode handler asks, and that an unauthored answer changes no
		// step, no order and no beat — it is fire-and-forget by construction (see `transitions`).
		bakedSymbolTransition: () => undefined,
		// THE EXPLOSION PATTERN, and the ordering function that reads it. Both are free identifiers in
		// the explode handler, so the slice needs them or it throws before a single claim below is
		// tested — which is exactly what happened when the pattern and this fixture's repair landed in
		// the same hour, each green on its own branch and broken together on `main`.
		//
		// `bakedTumblePattern` answers UNAUTHORED, like `bakedSymbolTransition` above and for the same
		// reason: every claim in this file is about a board with no pattern picked, and that answer is
		// what makes the explode step the single frame those claims assume. The ORDERING function is
		// the real one rather than a stub, so if the un-authored path ever stopped resolving to
		// all-zero, every order asserted below would move and say so.
		bakedTumblePattern: () => undefined,
		// ARRIVAL RELEASE — read by the appear handler to decide whether the round is let go as soon
		// as the symbols are seated, or only once every intro has played out. Another free identifier
		// in the slice, and the third time a new one has quietly taken this fixture out: it threw
		// before a single part-9 claim ran, on `main`, green on the branch that added it.
		//
		// A knob rather than a constant, and driven BOTH ways below: OFF is the state every project is
		// in until someone turns it on, and what every timing in this file is written against — but a
		// stub nothing ever flips is the shape a stub set drifts into.
		bakedArrivalReleaseEnabled: () => releaseOnArrival,
		tumbleExplosionDelays,
	};

	const body = `${tumbleStateSource}
let show = false;
// Svelte's, and the helper slice hands it the transition sweep. Nothing unmounts a component in a
// fixture, so the callback never runs — what has to hold is that registering it does not throw.
const onDestroy = () => {};
${helpers}
${handlersDecl}
return {
	handlers,
	stateTumble,
	tumbleBoardCombined,
	stateGame,
	showing: () => show,
};`;

	// Once per run, before the first presentation: does this set still cover everything the slices
	// call? It did not, twice — see `scripts/lib/stub-set-guard.mjs`.
	if (!stubSetChecked) {
		stubSetChecked = true;
		assertStubSetIsComplete({
			what: 'verify-swap-in-place-mode',
			body,
			stubNames: Object.keys(stubs),
		});
	}

	return compileSlice({
		what: 'verify-swap-in-place-mode / the TumbleBoard + Board runtime',
		names: Object.keys(stubs),
		body,
	})(...Object.values(stubs));
};

/**
 * Drive ONE reveal presentation, sliced out of the shipped module, against those handlers.
 *
 * Every broadcast is logged with the virtual time it happened at, the time it RESOLVED (for the
 * awaited ones), and — sampled straight after the handler ran — what the overlay's tile layer
 * answers and whether the reel board is up. That last pair is the whole tile assertion: the log
 * cannot contain a moment where both boards claim the ground, because it records both answers at
 * every single step.
 */
const runReveal = async ({
	name,
	source,
	staggerMs,
	clearBoard = false,
	tileArt,
	authoredIntro,
	previousBoard = boardOf('old'),
	revealedBoard = boardOf('new'),
	/** Cells the END-OF-WIN POP took off the resting board before this reveal — `[reel, row]` pairs
	 *  into the padded strip (Invisible Symbols → "Winning symbols explode"). Empty ⇒ the board every
	 *  other run in this file drives. */
	removedCells = [],
	/** `/symbols` → Transition → the arrival release. OFF everywhere but the A/B that turns it on. */
	releaseOnArrival = false,
}) => {
	const clock = createClock();
	/** The authored style this run IS, read off the presentation being driven — the same answer the
	 *  engine's `boardSwapStyle()` hands the component in a game configured for it. */
	const swapStyle = {
		dropInRevealBoard: 'dropIn',
		columnCascadeRevealBoard: 'columnCascade',
		emergeRevealBoard: 'emerge',
	}[name];
	if (swapStyle === undefined) throw new Error(`no swap style for the presentation "${name}"`);
	const landed = [];
	const sounded = [];
	const moves = [];
	const log = [];
	let settled;
	/** The removal set as the engine publishes it — `boardRemoved()`, the same shape as `boardRaw()`.
	 *  Built from `previousBoard` so it can never be a row longer or shorter than the strip it
	 *  describes. */
	const previousRemoved = previousBoard.map((strip, reel) =>
		strip.map((_cell, row) => removedCells.some(([r, w]) => r === reel && w === row)),
	);

	const runtime = buildTumbleRuntime({
		clock,
		previousBoard,
		previousRemoved,
		tileArt,
		onLand: (symbolName) => landed.push(symbolName),
		onSound: (cue) => sounded.push(cue),
		moves,
		authoredIntro,
		swapStyle,
		releaseOnArrival,
	});

	const logEvent = (event) => {
		const entry = { type: event.type, reelIndex: event.reelIndex, at: clock.at() };
		if (event.type === 'boardSettle') settled = event.board;
		// The survivor layer of the column being refilled, SAMPLED BEFORE the handler runs — that is
		// the "did this column drain first" question, asked at the only moment it can be asked.
		if (event.type === 'tumbleBoardInit' && event.reelIndex !== undefined) {
			entry.baseLengthBefore = runtime.stateTumble.base[event.reelIndex]?.length;
		}
		// Column lengths ACROSS a removal — the only way to see the per-column clear's real hazard.
		// A cascade runs its columns concurrently on an absolute stagger, so column `i + 1` can be
		// mid-explosion while column `i` reaches its removal; an unscoped filter would take the
		// neighbour's symbols too, and the END state would not show it (each column's own scoped
		// init resets `base` anyway). Sampled before AND after, so the diff is exact.
		if (event.type === 'tumbleBoardRemoveExploded') {
			entry.baseLengthsBefore = runtime.stateTumble.base.map((column) => column.length);
		}
		// The symbols a drain is about to move, held by reference so their FINAL y can be read after
		// the fall — the overlay drops them out of its own layers, so there is nowhere else to look.
		// The clear step's aim, recorded so "exactly the visible rows" is asserted on the real payload.
		// An explode names no column of its own — it carries POSITIONS — so when every position falls
		// in one reel, that reel is stamped on the entry. It is what makes a per-column clear
		// attributable at all, and deriving it here (rather than trusting a field the cue does not
		// have) keeps the fixture honest about where the column came from.
		if (event.type === 'tumbleBoardExplode') {
			entry.explodingPositions = event.explodingPositions;
			// WHAT THE SURVIVOR LAYER DRAWS as the step begins, seat by seat — sampled here because the
			// layer is rebuilt by the init that follows, so this is the only moment it can be read. A
			// seat the end-of-win pop already emptied must arrive already undrawn, or the symbols the
			// win blew up come back for the length of the clear (the reel board is hidden throughout).
			entry.baseUndrawnBefore = runtime.stateTumble.base.map((column) =>
				column.map((tumbleSymbol) => tumbleSymbol.removed),
			);
			const reels = new Set(event.explodingPositions.map((position) => position.reel));
			if (reels.size === 1) entry.reelIndex = [...reels][0];
		}
		if (event.type === 'tumbleBoardDrain') {
			// The TWEENS the drain is about to run, not the cells that carry them: a drained column is
			// handed straight back to its strip when the fall ends (`releaseCascadeCells`), so by the
			// time the final y can be read the cell no longer has a seat to read it from.
			entry.draining = [...(runtime.stateTumble.base[event.reelIndex] ?? [])];
			entry.drainingTweens = entry.draining.map((cell) => cell.cascade.y);
		}
		log.push(entry);
		return entry;
	};
	const sample = (entry) => {
		if (entry.draining) {
			entry.drainedY = entry.drainingTweens.map((tween) => tween.current);
		}
		if (entry.baseLengthsBefore) {
			entry.baseLengthsAfter = runtime.stateTumble.base.map((column) => column.length);
		}
	};
	const eventEmitter = {
		broadcast: (event) => {
			const entry = logEvent(event);
			runtime.handlers[event.type]?.(event);
			sample(entry);
		},
		broadcastAsync: async (event) => {
			const entry = logEvent(event);
			sample(entry);
			await runtime.handlers[event.type]?.(event);
			entry.done = clock.at();
			sample(entry);
		},
	};

	const present = compileSlice({
		what: `verify-swap-in-place-mode / flowEffects.ts#${name}`,
		names: [
			'eventEmitter',
			'tumbleBoardCombined',
			'stateGameDerived',
			'waitForTimeout',
			'COLUMN_CASCADE_STAGGER_MS',
		],
		body: `${source}\nreturn ${name};`,
	})(
		eventEmitter,
		runtime.tumbleBoardCombined,
		{
			boardColumnStaggerMs: () => staggerMs,
			boardClearsOutgoing: () => clearBoard,
			boardRaw: () => previousBoard,
		},
		(ms) => clock.wait(ms),
		COLUMN_CASCADE_STAGGER_MS,
	);

	await clock.run(() => present({ type: 'reveal', board: revealedBoard, gameType: 'basegame' }));
	const types = log.map((entry) => entry.type);
	return { log, types, settled, landed, sounded, moves, revealedBoard, previousBoard, previousRemoved, runtime, clock }; // prettier-ignore
};

const dropIn = await runReveal({ name: 'dropInRevealBoard', source: dropInPresentation });

// THE SEQUENCE — the cascade's, minus the two steps a reveal has nothing to do with.
check(
	'the drop-in broadcasts the cascade sequence minus the explode steps',
	dropIn.types.join(' → '),
	[
		'boardHide',
		'tumbleBoardShow',
		'tumbleBoardInit',
		'tumbleBoardSlideDown',
		'boardSettle',
		'tumbleBoardReset',
		'tumbleBoardHide',
		'boardShow',
	].join(' → '),
);
// Stated separately so a future reorder fails on the REASON, not just on the string.
check(
	'the board is settled AFTER the slide, not during it',
	dropIn.types.indexOf('boardSettle') > dropIn.types.indexOf('tumbleBoardSlideDown'),
	true,
);
check(
	'the board is settled BEFORE the overlay is reset — a reset first would settle an empty board',
	dropIn.types.indexOf('boardSettle') < dropIn.types.indexOf('tumbleBoardReset'),
	true,
);
check('the reels are given the screen back', dropIn.runtime.showing(), false);

// THE STATE THE BOARD ENDS IN — the claim the whole phase rests on. `enhancedBoard.spin` sets each
// reel's symbols from `revealEvent.board[reelIndex]`, so the drop-in has to hand `boardSettle`
// exactly that, or every downstream consumer (win lines, `winInfo`, the resting-board win cycle)
// reads a stale board. Asserted by OBJECT IDENTITY per cell, so a rebuilt lookalike fails.
check('the settled board has one column per reel', dropIn.settled?.length, REELS);
for (let reel = 0; reel < REELS; reel += 1) {
	check(`settled reel ${reel} is a full padded strip`, dropIn.settled[reel].length, STRIP);
	for (let row = 0; row < STRIP; row += 1) {
		check(
			`settled cell (${reel}, ${row}) IS the revealed symbol`,
			dropIn.settled[reel][row],
			dropIn.revealedBoard[reel][row],
		);
	}
}
// And nothing of the previous board survived into it — the failure mode of keeping the base layer is
// a double-height column whose second half is the old board.
const settledNames = new Set(dropIn.settled.flat().map((symbol) => symbol.name));
check(
	'no symbol of the previous board is left on the settled board',
	dropIn.previousBoard.flat().some((symbol) => settledNames.has(symbol.name)),
	false,
);

// THE LAND BEAT — only the VISIBLE rows land. With the old board left in the base layer this is the
// other thing that breaks: the off-screen half would fire land sounds for symbols nobody sees.
check('exactly the visible rows landed', dropIn.landed.length, REELS * ROWS);
check(
	'and they are the revealed board’s visible cells',
	dropIn.landed.slice().sort().join(','),
	dropIn.revealedBoard
		.flatMap((reel) => reel.slice(1, 1 + ROWS))
		.map((symbol) => symbol.name)
		.sort()
		.join(','),
);

// PARITY of the cue extension: `keepBase` absent is the cascade, byte-for-byte — the current board
// stays as the survivor layer, and the adding layer is spliced into it by the shipped
// `combineTumbleReel`, which puts the refills BELOW the top padding row rather than above it.
//
// That splice is #443, and it is why these read top-down rather than "adding first". Stacking the
// refills onto the whole column left it as `[…new…, pad, …survivors…, pad]`, with the TOP pad
// stranded in the middle, and three things broke on that at once: the settled board stopped
// matching the board the server had scored, the slide aimed the refills one row too high, and
// `tumbleBoardSlideDown`'s "visible rows only" guard (first and last entries are padding) skipped a
// real symbol's `land` to play one for the stranded pad. The pads belong at the two ends.
{
	const previousBoard = boardOf('old');
	const runtime = buildTumbleRuntime({ clock: createClock(), previousBoard });
	const adding = [[rawSymbol('a0')], [rawSymbol('a1')], [], [], []];
	runtime.handlers.tumbleBoardInit({ type: 'tumbleBoardInit', addingBoard: adding });
	const combined = runtime.tumbleBoardCombined();
	check('keepBase absent ⇒ the survivors stay', combined[0].length, 1 + STRIP);
	check(
		'keepBase absent ⇒ the top padding row is still the pad',
		combined[0][0].rawSymbol.name,
		'old0-0',
	);
	check('keepBase absent ⇒ the adding layer sits below it', combined[0][1].rawSymbol.name, 'a0');
	check('keepBase absent ⇒ the survivors follow it', combined[0][2].rawSymbol.name, 'old0-1');

	runtime.handlers.tumbleBoardInit({
		type: 'tumbleBoardInit',
		addingBoard: adding,
		keepBase: false,
	});
	const replaced = runtime.tumbleBoardCombined();
	check('keepBase false ⇒ still one column per reel', replaced.length, REELS);
	check('keepBase false ⇒ no survivors', replaced[0].length, 1);
	check('keepBase false ⇒ an empty column stays empty, not missing', replaced[2].length, 0);

	// PARITY of the second cue extension: `reelIndex` absent is the whole board, and a SCOPED init
	// touches nothing but its own column. The column cascade rests entirely on that — a scoped init
	// that leaked into a neighbour would push the un-drained columns' combined indices down and move
	// the still-resting board.
	runtime.handlers.tumbleBoardInit({ type: 'tumbleBoardInit', addingBoard: [] });
	const resting = runtime.tumbleBoardCombined();
	check('reelIndex absent ⇒ every column is the resting board', resting[0].length, STRIP);
	check(
		'reelIndex absent, addingBoard [] ⇒ nothing is queued',
		resting[0][0].rawSymbol.name,
		'old0-0',
	);

	runtime.handlers.tumbleBoardDrain({ type: 'tumbleBoardDrain', reelIndex: 2 });
	runtime.handlers.tumbleBoardInit({
		type: 'tumbleBoardInit',
		addingBoard: [[], [], [rawSymbol('n2')], [], []],
		keepBase: false,
		reelIndex: 2,
	});
	const scoped = runtime.tumbleBoardCombined();
	check('a scoped init replaces its own column', scoped[2].length, 1);
	check('with the symbol it was handed', scoped[2][0].rawSymbol.name, 'n2');
	for (const reelIndex of [0, 1, 3, 4]) {
		check(
			`a scoped init leaves reel ${reelIndex} exactly as it was`,
			scoped[reelIndex].length,
			STRIP,
		);
		check(
			`and its first symbol is still the resting one on reel ${reelIndex}`,
			scoped[reelIndex][0].rawSymbol.name,
			`old${reelIndex}-0`,
		);
	}
	// A column that a full init never built is left alone rather than punched into the array as a
	// hole — `tumbleBoardCombined` maps over `base`, so a hole would crash the next combine.
	runtime.handlers.tumbleBoardInit({
		type: 'tumbleBoardInit',
		addingBoard: [],
		keepBase: false,
		reelIndex: 99,
	});
	check(
		'a scoped init for a column that does not exist is a no-op',
		runtime.tumbleBoardCombined().length,
		REELS,
	);
}

// ---------------------------------------------------------------------------
// 4 — the column cascade, driven on the virtual clock.
// ---------------------------------------------------------------------------

console.log('--- 4. the column cascade ---');

const cascade = await runReveal({
	name: 'columnCascadeRevealBoard',
	source: columnCascadePresentation,
});

/** The one logged entry for a cue on a given column (the cascade fires each exactly once). */
const entryFor = (run, type, reelIndex) =>
	run.log.find((entry) => entry.type === type && entry.reelIndex === reelIndex);
const indexOfEntry = (run, type, reelIndex) => run.log.indexOf(entryFor(run, type, reelIndex));

// THE FRAME — the same overlay seam as the drop-in: hide the reels, mount, … , settle, unmount.
check(
	'the cascade opens and closes on the drop-in’s own overlay seam',
	[cascade.types[0], cascade.types[1], cascade.types[2], ...cascade.types.slice(-4)].join(' → '),
	[
		'boardHide',
		'tumbleBoardShow',
		'tumbleBoardInit',
		'boardSettle',
		'tumbleBoardReset',
		'tumbleBoardHide',
		'boardShow',
	].join(' → '),
);
check(
	'the opening init keeps the resting board as the layer that drains',
	cascade.log[2].reelIndex === undefined && cascade.log[2].baseLengthBefore === undefined,
	true,
);
check(
	'every column drains exactly once',
	cascade.types.filter((type) => type === 'tumbleBoardDrain').length,
	REELS,
);
check(
	'and refills exactly once',
	cascade.types.filter((type) => type === 'tumbleBoardSlideDown').length,
	REELS,
);

// 3 — THE ORDER IS LEFT TO RIGHT. Asserted as the actual ordering of adjacent pairs, both in the
// broadcast log and on the clock, not as "a delay exists somewhere".
for (let reelIndex = 0; reelIndex + 1 < REELS; reelIndex += 1) {
	check(
		`column ${reelIndex} starts before column ${reelIndex + 1} in the broadcast order`,
		indexOfEntry(cascade, 'tumbleBoardDrain', reelIndex) <
			indexOfEntry(cascade, 'tumbleBoardDrain', reelIndex + 1),
		true,
	);
	check(
		`column ${reelIndex} starts before column ${reelIndex + 1} on the clock`,
		entryFor(cascade, 'tumbleBoardDrain', reelIndex).at <
			entryFor(cascade, 'tumbleBoardDrain', reelIndex + 1).at,
		true,
	);
}
// The absolute slot, so the default stagger is the number the game ships and not a coincidence.
for (let reelIndex = 0; reelIndex < REELS; reelIndex += 1) {
	check(
		`column ${reelIndex} starts at its absolute slot (${reelIndex} × the default stagger)`,
		entryFor(cascade, 'tumbleBoardDrain', reelIndex).at,
		reelIndex * COLUMN_CASCADE_STAGGER_MS,
	);
}

// 4 — EVERY COLUMN DRAINS BEFORE IT REFILLS. Three independent readings of the same claim: the
// broadcast order, the clock, and — the one that actually catches a reordering that still settles
// correctly — the survivor layer being EMPTY at the instant the replacements are queued.
for (let reelIndex = 0; reelIndex < REELS; reelIndex += 1) {
	check(
		`column ${reelIndex}: drain is broadcast before the refill is queued`,
		indexOfEntry(cascade, 'tumbleBoardDrain', reelIndex) <
			indexOfEntry(cascade, 'tumbleBoardInit', reelIndex),
		true,
	);
	check(
		`column ${reelIndex}: the refill is queued before the slide`,
		indexOfEntry(cascade, 'tumbleBoardInit', reelIndex) <
			indexOfEntry(cascade, 'tumbleBoardSlideDown', reelIndex),
		true,
	);
	check(
		`column ${reelIndex}: the drain has FINISHED before the refill is queued`,
		entryFor(cascade, 'tumbleBoardDrain', reelIndex).done <=
			entryFor(cascade, 'tumbleBoardInit', reelIndex).at,
		true,
	);
	check(
		`column ${reelIndex}: the old symbols are GONE when the new ones are queued`,
		entryFor(cascade, 'tumbleBoardInit', reelIndex).baseLengthBefore,
		0,
	);
}

// 2 — THE END STATE, the same Phase 2 contract the drop-in asserts, by object identity per cell.
check('the settled board has one column per reel', cascade.settled?.length, REELS);
for (let reel = 0; reel < REELS; reel += 1) {
	check(`settled reel ${reel} is a full padded strip`, cascade.settled[reel].length, STRIP);
	for (let row = 0; row < STRIP; row += 1) {
		check(
			`cascade settled cell (${reel}, ${row}) IS the revealed symbol`,
			cascade.settled[reel][row],
			cascade.revealedBoard[reel][row],
		);
	}
}
{
	const settledNames = new Set(cascade.settled.flat().map((symbol) => symbol.name));
	check(
		'no symbol of the drained board is left on the settled board',
		cascade.previousBoard.flat().some((symbol) => settledNames.has(symbol.name)),
		false,
	);
}
check(
	'the board is settled AFTER the last column resolved',
	cascade.types.indexOf('boardSettle') > cascade.types.lastIndexOf('tumbleBoardSlideDown'),
	true,
);
check(
	'and the settle is on the clock at or after every column’s slide completed',
	cascade.log
		.filter((entry) => entry.type === 'tumbleBoardSlideDown')
		.every((entry) => entry.done <= entryFor(cascade, 'boardSettle', undefined).at),
	true,
);
check(
	'the board is settled BEFORE the overlay is reset',
	cascade.types.indexOf('boardSettle') < cascade.types.indexOf('tumbleBoardReset'),
	true,
);
check('the reels are given the screen back', cascade.runtime.showing(), false);

// Only the VISIBLE rows land, exactly as on the drop-in — the padding rows top and bottom are
// off-screen buffer and landing them would fire land sounds for symbols nobody sees.
check('exactly the visible rows landed', cascade.landed.length, REELS * ROWS);
check(
	'and they are the revealed board’s visible cells',
	cascade.landed.slice().sort().join(','),
	cascade.revealedBoard
		.flatMap((reel) => reel.slice(1, 1 + ROWS))
		.map((symbol) => symbol.name)
		.sort()
		.join(','),
);

// THE DRAIN IS A FALL OUT OF THE WINDOW, not a delete. With the harness's stand-in seats the board
// window bottom is `ROWS × 120 = 360`; every drained symbol has to end BELOW that, or "the resting
// board falls out downward" is a removal wearing an animation's name.
const WINDOW_BOTTOM = ROWS * 120;
for (let reelIndex = 0; reelIndex < REELS; reelIndex += 1) {
	const entry = entryFor(cascade, 'tumbleBoardDrain', reelIndex);
	check(`column ${reelIndex}: the whole resting strip drains`, entry.draining.length, STRIP);
	check(
		`column ${reelIndex}: it is the PREVIOUS board that drains`,
		entry.draining.map((symbol) => symbol.rawSymbol.name).join(','),
		cascade.previousBoard[reelIndex].map((symbol) => symbol.name).join(','),
	);
	check(
		`column ${reelIndex}: every drained symbol ends below the board window`,
		entry.drainedY.every((y) => y > WINDOW_BOTTOM),
		true,
	);
	check(
		`column ${reelIndex}: and they keep their spacing — the column leaves as a block`,
		entry.drainedY
			.map((y, index) => y - entry.drainedY[0] - index * 120)
			.every((delta) => delta === 0),
		true,
	);
}

// ---------------------------------------------------------------------------
// 5 — the stagger KNOB, and the two readings of "left to right".
// ---------------------------------------------------------------------------

console.log('--- 5. the stagger is the knob ---');

/** The virtual ms a whole column costs: its drain, its slide, and its `land` beats. */
const columnSpan = (run, reelIndex) =>
	entryFor(run, 'tumbleBoardSlideDown', reelIndex).done -
	entryFor(run, 'tumbleBoardDrain', reelIndex).at;

{
	const wave = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		staggerMs: 20,
	});
	const span = columnSpan(wave, 0);
	check('a column takes real time on the clock', span > 0, true);
	for (let reelIndex = 0; reelIndex + 1 < REELS; reelIndex += 1) {
		check(
			`stagger 20: column ${reelIndex + 1} starts while column ${reelIndex} is still moving`,
			entryFor(wave, 'tumbleBoardDrain', reelIndex + 1).at <
				entryFor(wave, 'tumbleBoardSlideDown', reelIndex).done,
			true,
		);
	}
	check(
		'stagger 20: the whole sweep is barely longer than one column',
		wave.log[wave.log.length - 1].at < span * 2,
		true,
	);

	const sequential = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		staggerMs: 5000,
	});
	for (let reelIndex = 0; reelIndex + 1 < REELS; reelIndex += 1) {
		check(
			`stagger 5000: column ${reelIndex + 1} cannot start until column ${reelIndex} has finished`,
			entryFor(sequential, 'tumbleBoardDrain', reelIndex + 1).at >=
				entryFor(sequential, 'tumbleBoardSlideDown', reelIndex).done,
			true,
		);
	}
	// The knob CHANGED the behaviour, stated as the difference rather than as two absolutes.
	check(
		'the same board takes strictly longer with the larger stagger',
		sequential.log[sequential.log.length - 1].at > wave.log[wave.log.length - 1].at,
		true,
	);
	// …and it is still the same board at the end. A timing knob that changed the outcome would be a
	// bug, not a knob.
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`stagger 5000 settled cell (${reel}, ${row}) IS the revealed symbol`,
				sequential.settled[reel][row],
				sequential.revealedBoard[reel][row],
			);
		}
	}

	// A ZERO stagger is a legal authored value: every column starts together, no sweep. It must not
	// be swallowed by the `??` that applies the default.
	const together = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		staggerMs: 0,
	});
	check(
		'stagger 0: every column starts at the same instant',
		new Set(
			together.log.filter((entry) => entry.type === 'tumbleBoardDrain').map((entry) => entry.at),
		).size,
		1,
	);
	check(
		'stagger 0: and it is still the left-to-right broadcast order',
		together.log
			.filter((entry) => entry.type === 'tumbleBoardDrain')
			.map((entry) => entry.reelIndex)
			.join(','),
		[0, 1, 2, 3, 4].join(','),
	);
}

// ---------------------------------------------------------------------------
// 6 — one board on screen, and it draws the cells throughout.
// ---------------------------------------------------------------------------

console.log('--- 6. one board on screen, drawing the cells throughout ---');

const TILE = { key: 'ground::tile', fallbackKey: 'tile' };

// The cascade used to be an OVERLAY: `boardHide` took the reel board off, the overlay mounted a
// clone of the standing board, and `boardShow` put the reels back. Both hand-overs destroyed one
// component tree and built the other, and a new component starts its clip at frame one — so every
// standing symbol restarted, board-wide, twice per board change, however little about it had
// changed. Measured live: 23 cells per spin rebuilt around art that had not changed
// (docs/design/board-cell-continuity.md).
//
// There is one board now. `Board.svelte` draws the cells whoever is driving them, and this
// component drives them. These are the markup claims that keep it that way — the ground tiles and
// the board mask come along for the ride, because there is no longer a second board to own a
// second copy of either.
{
	const boardComponent = read('apps/lines/src/components/Board.svelte');
	const overlayMarkup = tumbleComponent.slice(tumbleComponent.indexOf('{#if show}'));

	check(
		'the reel board mounts the one tile layer, behind its own guard',
		boardComponent.includes('{#if tileArt}') &&
			boardComponent.includes('<BoardTiles art={tileArt} />'),
		true,
	);
	// The overlay draws NOTHING the board already draws. Each of these was a second copy of a layer
	// that only existed because the reel board was hidden for the length of a swap.
	for (const [what, token] of [
		['the ground tiles', 'BoardTiles'],
		['the board mask', 'BoardMask'],
		['the cells', 'BoardBase'],
	]) {
		// The TAG, in the markup — the components are still named in this file's prose, which is where
		// the reason they went lives.
		check(
			`the cascade step draws no second copy of ${what}`,
			overlayMarkup.includes(`<${token}`),
			false,
		);
	}
	check(
		'...what it does still draw is its own transition layer',
		overlayMarkup.includes('<SymbolLayer'),
		true,
	);

	// The reel board keeps DRAWING through a step, not merely mounted: the step is the board, so a
	// `boardHide` broadcast by a cascading reveal must not black the screen for its duration.
	check(
		'the board is on screen while a cascade step runs',
		boardComponent.includes('const mounted = $derived(show || overlayShown);'),
		true,
	);
	check(
		'...and nothing hides it behind that guard',
		boardComponent.includes('<BoardContainer visible='),
		false,
	);

	// ONE MOUNT SITE, and cells keyed by IDENTITY — the two halves of the fix. `BoardBase` reads the
	// cascade's layers when it is driving and the strips otherwise, and a cell that changes row (a
	// step filters survivors and splices refills above them) is MOVED rather than re-created.
	const baseComponent = read('apps/lines/src/components/BoardBase.svelte');
	check(
		'the cells have one mount site, which reads whoever is driving them',
		baseComponent.includes('stateTumble.active') && baseComponent.includes('tumbleBoardCombined()'),
		true,
	);
	check(
		'...keyed by the cell itself, flat and under perspective alike',
		baseComponent.includes('{#each column as reelSymbol, row (reelSymbol)}') &&
			baseComponent.includes('{#each rowOrder as seat (seat.reelSymbol)}'),
		true,
	);

	// THE SEAM BACK. Every cascading reveal settles on `tumbleBoardCombined()` — the cells on screen
	// — so the reels ADOPT those objects instead of minting a fresh strip from their raw symbols.
	// Rebuilding there would tear the board down on the last beat of the step, which is the second of
	// the two restart clusters this change removes.
	check(
		'the reels adopt the cells the step settles on',
		boardComponent.includes('reel.setSymbolsWithReelSymbols(cells[reelIndex] ?? [])'),
		true,
	);
	check(
		'...and fall back to a raw settle for a board the step is not holding',
		boardComponent.includes('context.stateGameDerived.enhancedBoard.settle(board);'),
		true,
	);

	// The step's own cells are the BOARD's cells: adopted where they sit, minted through the reel's
	// factory when they are genuinely new.
	check(
		'the survivor layer adopts the reels’ own cells',
		componentScript.includes('attachCascadeSeat(reelSymbol, getSymbolSeat('),
		true,
	);
	check(
		'...and the arrivals are minted through the reel’s own factory',
		componentScript.includes('stateGame.board[reelIndex]?.createSymbols(rawSymbols)'),
		true,
	);
}

// The ground still reaches the screen for a board that authors one, and still mounts nothing at
// all for a board that does not — the parity claim, which is not optional: `apps/lines` is the
// shared `_runtime/lines` bundle every online game runs.
{
	const tiled = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		tileArt: TILE,
	});
	check(
		'a tiled board still runs the swap cue for cue',
		tiled.types.includes('tumbleBoardShow') && tiled.types.includes('tumbleBoardHide'),
		true,
	);
	const untiled = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
	});
	check(
		'...and an untiled one broadcasts exactly the same sequence',
		untiled.types.join(' → '),
		tiled.types.join(' → '),
	);
}

// ---------------------------------------------------------------------------
// 7 — THE CLEAR STEP, driven.
// ---------------------------------------------------------------------------

console.log('--- 7. the outgoing board can be cleared first ---');

{
	// PARITY FIRST, and it is the claim that matters most: `apps/lines` is the shared
	// `_runtime/lines` bundle every online game runs, so a project that never opened the Reel
	// behaviour section must broadcast the same cues in the same order it did before the knob
	// existed. Asserted against the run at the top of part 3, which is exactly that project.
	check(
		'clearBoard off ⇒ the drop-in sequence is untouched, cue for cue',
		dropIn.types.join(' → '),
		[
			'boardHide',
			'tumbleBoardShow',
			'tumbleBoardInit',
			'tumbleBoardSlideDown',
			'boardSettle',
			'tumbleBoardReset',
			'tumbleBoardHide',
			'boardShow',
		].join(' → '),
	);

	const cleared = await runReveal({
		name: 'dropInRevealBoard',
		source: dropInPresentation,
		clearBoard: true,
	});

	// THE SEQUENCE — the cascade's two missing steps, put back AHEAD of the drop-in rather than
	// folded into it. The order is the whole feature: an explode after the new board was queued
	// would blow up the incoming symbols instead of the outgoing ones.
	check(
		'clearBoard on ⇒ the outgoing board explodes and is removed BEFORE the new one is queued',
		cleared.types.join(' → '),
		[
			'boardHide',
			'tumbleBoardShow',
			'tumbleBoardInit',
			'tumbleBoardExplode',
			'tumbleBoardRemoveExploded',
			'tumbleBoardInit',
			'tumbleBoardSlideDown',
			'boardSettle',
			'tumbleBoardReset',
			'tumbleBoardHide',
			'boardShow',
		].join(' → '),
	);
	// Stated separately so a reorder fails on the REASON, not just on the string.
	check(
		'the explode is awaited before the removal — a removal mid-animation eats the explosion',
		cleared.log.find((entry) => entry.type === 'tumbleBoardExplode').done <=
			cleared.log.find((entry) => entry.type === 'tumbleBoardRemoveExploded').at,
		true,
	);
	check(
		'and the whole clear finishes before the new board is queued',
		cleared.log.find((entry) => entry.type === 'tumbleBoardRemoveExploded').at <=
			cleared.log.filter((entry) => entry.type === 'tumbleBoardInit')[1].at,
		true,
	);
	// It COSTS something on the clock. A clear that took zero time would mean the explode beat was
	// never actually awaited, which is the failure the two ordering checks above cannot see.
	check(
		'clearing takes real time, so the beat is genuinely awaited',
		cleared.log.find((entry) => entry.type === 'tumbleBoardSlideDown').at >
			dropIn.log.find((entry) => entry.type === 'tumbleBoardSlideDown').at,
		true,
	);

	// EXACTLY THE VISIBLE ROWS EXPLODE. A column is a padded strip, and exploding the buffers would
	// buy a beat-race per hidden cell for no picture. The positions are also asserted to be the
	// OUTGOING board's, which is what makes this a clear rather than a mis-aimed one.
	const explodedAt = cleared.log.find((entry) => entry.type === 'tumbleBoardExplode');
	check(
		'the clear explodes one cell per visible seat',
		explodedAt.explodingPositions.length,
		REELS * ROWS,
	);
	check(
		'and they are exactly the visible rows of every reel',
		explodedAt.explodingPositions.map(({ reel, row }) => `${reel}:${row}`).join(','),
		Array.from({ length: REELS }, (_unused, reel) =>
			Array.from({ length: ROWS }, (_row, row) => `${reel}:${row + 1}`).join(','),
		).join(','),
	);

	// THE END STATE IS UNCHANGED. The clear rewrites the very layer the settle reads, so the drop-in's
	// own contract — the reel board ends holding exactly what a spin would have settled — has to be
	// re-asserted THROUGH it, by object identity, not assumed to survive.
	check('the cleared run still settles one column per reel', cleared.settled?.length, REELS);
	for (let reel = 0; reel < REELS; reel += 1) {
		check(`cleared reel ${reel} is a full padded strip`, cleared.settled[reel].length, STRIP);
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`cleared cell (${reel}, ${row}) IS the revealed symbol`,
				cleared.settled[reel][row],
				cleared.revealedBoard[reel][row],
			);
		}
	}
	const clearedNames = new Set(cleared.settled.flat().map((symbol) => symbol.name));
	check(
		'and nothing of the exploded board survived into it',
		cleared.previousBoard.flat().some((symbol) => clearedNames.has(symbol.name)),
		false,
	);
	// The land beat is untouched too: only the visible rows land, and they are the NEW board's.
	check('exactly the visible rows landed', cleared.landed.length, REELS * ROWS);
	check(
		'and they are the revealed board’s visible cells',
		cleared.landed.slice().sort().join(','),
		cleared.revealedBoard
			.flatMap((reel) => reel.slice(1, 1 + ROWS))
			.map((symbol) => symbol.name)
			.sort()
			.join(','),
	);
}

// ---------------------------------------------------------------------------
// 8 — THE PER-COLUMN CLEAR, driven.
// ---------------------------------------------------------------------------

console.log('--- 8. a column cascade can CLEAR each column instead of draining it ---');

{
	// PARITY FIRST: the cascade run at the top of part 4 authored no clear, so it must still drain,
	// with no explode/remove anywhere. `apps/lines` is the shared `_runtime/lines` bundle.
	check(
		'clearBoard off ⇒ every column still DRAINS',
		cascade.types.filter((type) => type === 'tumbleBoardDrain').length,
		REELS,
	);
	check(
		'clearBoard off ⇒ nothing explodes',
		cascade.types.some((type) => type.startsWith('tumbleBoardExplode')),
		false,
	);

	const cleared = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		clearBoard: true,
	});

	// THE SWAP: the clear takes the DRAIN'S PLACE. Not "as well as" — a column that both popped and
	// slid out would play the beat twice, and the drain would animate symbols already removed.
	check('clearBoard on ⇒ no column drains', cleared.types.includes('tumbleBoardDrain'), false);
	check(
		'clearBoard on ⇒ every column explodes instead',
		cleared.types.filter((type) => type === 'tumbleBoardExplode').length,
		REELS,
	);
	check(
		'...and every explosion is removed',
		cleared.types.filter((type) => type === 'tumbleBoardRemoveExploded').length,
		REELS,
	);

	// PER COLUMN, in order, and each column's own beat is explode → remove → refill → slide.
	for (let reel = 0; reel < REELS; reel += 1) {
		const beats = cleared.log.filter(
			(entry) => entry.reelIndex === reel && entry.type !== 'boardSettle',
		);
		check(
			`column ${reel} clears then refills, in that order`,
			beats.map((entry) => entry.type).join(' → '),
			[
				'tumbleBoardExplode',
				'tumbleBoardRemoveExploded',
				'tumbleBoardInit',
				'tumbleBoardSlideDown',
			].join(' → '),
		);
		// The explode is aimed at THIS column's visible rows only — the padded buffers stay put.
		const explode = beats.find((entry) => entry.type === 'tumbleBoardExplode');
		check(
			`column ${reel} explodes exactly its visible rows`,
			explode.explodingPositions.map((position) => `${position.reel}:${position.row}`).join(','),
			Array.from({ length: ROWS }, (_unused, row) => `${reel}:${row + 1}`).join(','),
		);
	}

	// THE HAZARD, asserted directly. The columns overlap on the default stagger, so at the moment
	// column `i` removes, column `i + 1` may already be mid-explosion. An unscoped filter would take
	// its symbols too — invisible in the END state, because each column's own scoped init resets
	// `base` regardless, and visible in the live game only as a column emptying before its turn.
	const removals = cleared.log.filter((entry) => entry.type === 'tumbleBoardRemoveExploded');
	check(
		'every removal names its column',
		removals.every((entry) => entry.reelIndex !== undefined),
		true,
	);
	for (const entry of removals) {
		const changed = entry.baseLengthsBefore
			.map((length, reel) => (length === entry.baseLengthsAfter[reel] ? null : reel))
			.filter((reel) => reel !== null);
		check(
			`the removal for column ${entry.reelIndex} touches ONLY column ${entry.reelIndex}`,
			changed.join(','),
			String(entry.reelIndex),
		);
	}
	// And the overlap the hazard depends on is REAL in this run, not hypothetical — otherwise the
	// assertion above would be passing for want of anything to catch.
	const overlapped = removals.some((entry) =>
		cleared.log.some(
			(other) =>
				other.type === 'tumbleBoardExplode' &&
				other.reelIndex !== entry.reelIndex &&
				other.at <= entry.at &&
				other.done > entry.at,
		),
	);
	check('the columns genuinely overlap, so the scoping is load-bearing here', overlapped, true);

	// THE END STATE IS UNCHANGED. The clear rewrites the layer the settle reads, so the cascade's own
	// contract — the reel board ends holding exactly what a spin would have settled — is re-asserted
	// THROUGH it, by object identity rather than assumed to survive.
	check('the cleared cascade settles one column per reel', cleared.settled?.length, REELS);
	for (let reel = 0; reel < REELS; reel += 1) {
		check(`cleared reel ${reel} is a full padded strip`, cleared.settled[reel].length, STRIP);
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`cleared cell (${reel}, ${row}) IS the revealed symbol`,
				cleared.settled[reel][row],
				cleared.revealedBoard[reel][row],
			);
		}
	}
	const clearedNames = new Set(cleared.settled.flat().map((symbol) => symbol.name));
	check(
		'and nothing of the exploded board survived into it',
		cleared.previousBoard.flat().some((symbol) => clearedNames.has(symbol.name)),
		false,
	);
	check('exactly the visible rows landed', cleared.landed.length, REELS * ROWS);

	// The sweep is still LEFT TO RIGHT — clearing must not disturb the ordering the stagger buys.
	const firstBeatAt = Array.from({ length: REELS }, (_unused, reel) =>
		Math.min(
			...cleared.log
				.filter((entry) => entry.reelIndex === reel && entry.type === 'tumbleBoardExplode')
				.map((entry) => entry.at),
		),
	);
	check(
		'the clear sweeps left to right, strictly',
		firstBeatAt.every((at, reel) => reel === 0 || at > firstBeatAt[reel - 1]),
		true,
	);
}

// ---------------------------------------------------------------------------
// 9 - the EMERGE style: the board surfaces in place, and NOTHING TRAVELS.
//
// The claim this part exists for is a negative one, and it is invisible everywhere the other parts
// look. An emerge and a drop-in broadcast nearly the same cues, settle on identical boards, and
// leave every symbol on the same seat - the ONLY place they differ is the DURATION each placement
// is asked for. So the harness's `Tween` keeps a ledger (see `tweenClass`), and the assertions below
// are measurements of it: every emerge placement is `duration: 0`, and the drop-in control in the
// same run is not, which is what stops "no travel" passing for want of anything that could travel.
//
// The other half is that the arrival ANIMATION replaces the landing one rather than following it.
// That is asserted where it is decidable offline: the visible rows - and only the visible rows -
// take the `intro` state, tick the scatter counter through `onSymbolLand`, and ask for a per-symbol
// emerge cue; the padding rows are seated in silence.
// ---------------------------------------------------------------------------

console.log('--- 9. the emerge style - nothing travels ---');

const emergeSource = stripTypes(
	'the emergeRevealBoard slice',
	sliceBetween(flowEffects, 'emergeRevealBoard', 'const emergeRevealBoard = async (', '\n};\n'),
);
/** Same shape as the cascade's: the body reaches `clearOutgoingSymbols` on its clearing branch, so
 *  the helper is in scope for every run while the slice itself stays pure. */
const emergePresentation = `${clearSource}\n${emergeSource}`;

// SOURCE GUARDS - the two motions this style is DEFINED by not performing. A slide or a drain
// appearing here would not fail a sequence assertion (both end with the symbols on their seats), so
// it is named directly.
check(
	'emergeRevealBoard slides nothing - the drop-in motion is not reachable from it',
	emergeSource.includes('tumbleBoardSlideDown'),
	false,
);
check(
	'...and drains nothing either - that motion belongs to the cascade',
	emergeSource.includes('tumbleBoardDrain'),
	false,
);
check('...it appears instead', emergeSource.includes("type: 'tumbleBoardAppear'"), true);
// The DEFAULT differs from the cascade's on purpose: "the board appears" is the style, and a sweep
// is a flourish an author opts into. A `?? COLUMN_CASCADE_STAGGER_MS` here would silently make every
// emerge a wave.
check(
	'an un-authored emerge does NOT inherit the cascade default stagger',
	emergeSource.includes('boardColumnStaggerMs() ?? 0'),
	true,
);
// Ordering inside the handler is the anti-flash rule (see the cue's doc): the state must be set
// BEFORE the placement, or the symbol's resting art paints for one frame on its final seat.
/** The APPEAR handler alone, with its whitespace collapsed.
 *
 *  SCOPED deliberately: `tumbleBoardDrain` also calls `tumbleSymbol.cascade.y.set(` and sits earlier
 *  in the file, so an `indexOf` over the whole handler block would compare the intro assignment
 *  against the DRAIN's placement and pass by accident.
 *
 *  COLLAPSED because these two assertions are about INTENT, not about line breaks. Prettier is free
 *  to fold `{ duration: 0 }` onto its own lines when the call grows, and a fixture that failed for
 *  that is a fixture people learn to re-write rather than read. */
const appearHandlerSource = handlersSource
	.slice(handlersSource.indexOf('tumbleBoardAppear:'))
	.replace(/\s+/g, ' ');
/** The one placement that DEFINES the style: the arriving symbol, seated instantly.
 *
 *  Matched exactly rather than by "the first `cascade.y.set` in the handler", because the handler now
 *  has two branches and the OTHER one — the survivor's 200 ms slide — sits first. A loose pattern
 *  here compared the intro assignment against the survivor's placement and failed for the wrong
 *  reason; a non-greedy `.*?` one would have spanned the two branches and passed for the wrong
 *  reason, which is worse. */
const INSTANT_PLACEMENT = 'tumbleSymbol.cascade.y.set(seatY, { duration: 0 });';
check(
	'the appear handler seats the arriving symbol instantly',
	appearHandlerSource.includes(INSTANT_PLACEMENT),
	true,
);
check(
	"...and sets 'intro' BEFORE it places, so the first painted frame is already the intro art",
	appearHandlerSource.indexOf("tumbleSymbol.symbolState = 'intro'") <
		appearHandlerSource.indexOf(INSTANT_PLACEMENT),
	true,
);
// The survivor half, asserted at source too: it must NOT be instant. Part 10 drives the behaviour,
// but this says out loud that the two branches are different on purpose.
check(
	'...while a survivor is given the slide duration, not placed',
	/cascade\.y\.set\(cell\.seatY, \{ duration: 200, easing: backOut \}\)/.test(appearHandlerSource),
	true,
);

{
	const emerge = await runReveal({
		name: 'emergeRevealBoard',
		source: emergePresentation,
		staggerMs: 0,
	});

	check(
		'the emerge broadcasts the sweep sequence with an APPEAR in place of a slide',
		emerge.types.join(' -> '),
		[
			'boardHide',
			'tumbleBoardShow',
			'tumbleBoardInit',
			...Array.from({ length: REELS }, () => ['tumbleBoardInit', 'tumbleBoardAppear']).flat(),
			'boardSettle',
			'tumbleBoardReset',
			'tumbleBoardHide',
			'boardShow',
		].join(' -> '),
	);

	// THE MEASUREMENT. Every placement the whole reveal asked for was instantaneous.
	check('the emerge places every symbol', emerge.moves.length > 0, true);
	check(
		'...and NOT ONE of them travels - every placement is duration 0',
		emerge.moves.every((move) => move.duration === 0),
		true,
	);
	// THE CONTROL. The same ledger, on the shipped drop-in, must show travel - otherwise the
	// assertion above is passing because nothing was ever measured.
	check(
		'...while the shipped drop-in DOES travel, so the ledger can tell them apart',
		dropIn.moves.some((move) => move.duration > 0),
		true,
	);
	check(
		'...and the drop-in moves every symbol it places',
		dropIn.moves.every((move) => move.duration > 0),
		true,
	);

	// EVERY VISIBLE CELL ARRIVES, and only the visible ones. `STRIP` is `ROWS + 2`, so a style that
	// forgot the padding guard would land 5 rows per reel instead of 3.
	check('every visible cell reports a landing', emerge.landed.length, REELS * ROWS);
	check(
		'...and every one of them asks for its own emerge cue',
		emerge.sounded.filter((cue) => cue.startsWith('symbol:intro:')).length,
		REELS * ROWS,
	);
	check(
		'...and no padding row does either - they are seated in silence',
		emerge.landed.some((name) => name.endsWith('-0') || name.endsWith(`-${STRIP - 1}`)),
		false,
	);

	// THE SETTLE CONTRACT, by object identity - the same claim parts 3 and 4 make, because the point
	// of a new style is that everything downstream of it is unchanged.
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`emerge settled cell (${reel}, ${row}) IS the revealed symbol`,
				emerge.settled[reel][row],
				emerge.revealedBoard[reel][row],
			);
		}
	}

	// A ZERO stagger means every column starts together - which is what an un-authored emerge gets.
	const firstAppear = entryFor(emerge, 'tumbleBoardAppear', 0).at;
	for (let reelIndex = 1; reelIndex < REELS; reelIndex += 1) {
		check(
			`stagger 0: column ${reelIndex} surfaces on the same beat as column 0`,
			entryFor(emerge, 'tumbleBoardAppear', reelIndex).at,
			firstAppear,
		);
	}
}

{
	// THE ARRIVAL RELEASE (`/symbols` → Transition → "let the next spin start as soon as the
	// symbols are back"). The switch changes what the round WAITS for and nothing else, so it is
	// driven A/B on one presentation with every symbol's `intro` AUTHORED — an unauthored one
	// costs the short transit beat instead of the long cap, which would hide the difference.
	//
	// It is also why `bakedArrivalReleaseEnabled` is a stub this fixture can FLIP rather than a
	// constant: every clock in this file is written against the OFF answer, and a stub nothing ever
	// changes is the shape a stub set drifts into — which is how this fixture went down twice.
	const arrivalOpts = { name: 'emergeRevealBoard', source: emergePresentation, staggerMs: 0, authoredIntro: () => true }; // prettier-ignore
	const awaited = await runReveal({ ...arrivalOpts, releaseOnArrival: false });
	const released = await runReveal({ ...arrivalOpts, releaseOnArrival: true });

	// OFF: the column is held for the authored intro cap (`INTRO_BEAT_CAP_MS`, the long one) —
	// the measured tail the switch exists to give back.
	const awaitedAppear = entryFor(awaited, 'tumbleBoardAppear', 0);
	check('awaited: the arrival holds the column for the authored intro cap', awaitedAppear.done - awaitedAppear.at, INTRO_CAP_MS); // prettier-ignore
	check('...and the whole reveal costs it', awaited.clock.at(), INTRO_CAP_MS);

	// ON: released the moment every cell is seated.
	const releasedAppear = entryFor(released, 'tumbleBoardAppear', 0);
	check('released: the arrival holds the column for nothing at all', releasedAppear.done - releasedAppear.at, 0); // prettier-ignore
	check('...and the reveal is over in the tick it started', released.clock.at(), 0);

	// AND NOTHING ELSE MOVED. Same broadcasts in the same order, the same landings, the same emerge
	// voices and the same settled board cell for cell: every intro still PLAYS and every cell is
	// still seated with its new art — only the awaiting stops. DETACHED, NOT SKIPPED.
	check('...with the same broadcast sequence', released.types.join(' -> '), awaited.types.join(' -> ')); // prettier-ignore
	check('...the same landings', released.landed.join(','), awaited.landed.join(','));
	check('...and the same emerge voices, so the intros still play', released.sounded.filter((cue) => cue.startsWith('symbol:intro:')).length, REELS * ROWS); // prettier-ignore
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`released emerge settled cell (${reel}, ${row}) IS the revealed symbol`,
				released.settled[reel][row],
				released.revealedBoard[reel][row],
			);
		}
	}
}

{
	// THE SWEEP. The same knob the cascade spends, spent on the same picture: a large stagger makes
	// the columns strictly sequential.
	const swept = await runReveal({
		name: 'emergeRevealBoard',
		source: emergePresentation,
		staggerMs: 5000,
	});
	for (let reelIndex = 0; reelIndex + 1 < REELS; reelIndex += 1) {
		check(
			`stagger 5000: column ${reelIndex + 1} surfaces only after column ${reelIndex} finished`,
			entryFor(swept, 'tumbleBoardAppear', reelIndex + 1).at >=
				entryFor(swept, 'tumbleBoardAppear', reelIndex).done,
			true,
		);
	}
	// A timing knob that changed the OUTCOME would be a bug, not a knob.
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`swept emerge settled cell (${reel}, ${row}) IS the revealed symbol`,
				swept.settled[reel][row],
				swept.revealedBoard[reel][row],
			);
		}
	}
	check(
		'...and a swept emerge still never travels',
		swept.moves.every((move) => move.duration === 0),
		true,
	);
}

{
	// SINK, THEN SURFACE - the pairing the style exists for. Each column clears on its own beat,
	// BEFORE its replacements are queued; without that ordering the old symbols would be gone before
	// anyone saw them leave.
	const clearing = await runReveal({
		name: 'emergeRevealBoard',
		source: emergePresentation,
		staggerMs: 0,
		clearBoard: true,
	});
	for (let reelIndex = 0; reelIndex < REELS; reelIndex += 1) {
		const explode = entryFor(clearing, 'tumbleBoardExplode', reelIndex);
		const remove = entryFor(clearing, 'tumbleBoardRemoveExploded', reelIndex);
		const queue = entryFor(clearing, 'tumbleBoardInit', reelIndex);
		const appear = entryFor(clearing, 'tumbleBoardAppear', reelIndex);
		check(`column ${reelIndex}: the outgoing symbols pop`, Boolean(explode), true);
		check(
			`column ${reelIndex}: ...and are removed before the replacements are queued`,
			Boolean(remove) && Boolean(queue) && remove.at <= queue.at,
			true,
		);
		check(
			`column ${reelIndex}: ...and the new ones surface only after that`,
			Boolean(appear) && queue.at <= appear.at,
			true,
		);
		// The clear is SCOPED: an explode must aim at this column's visible rows and nothing else.
		check(
			`column ${reelIndex}: the pop is aimed at exactly its own visible rows`,
			explode.explodingPositions.map((position) => `${position.reel}:${position.row}`).join(','),
			Array.from({ length: ROWS }, (_unused, row) => `${reelIndex}:${row + 1}`).join(','),
		);
	}
	check(
		'...and clearing first still moves nothing',
		clearing.moves.every((move) => move.duration === 0),
		true,
	);
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`clearing emerge settled cell (${reel}, ${row}) IS the revealed symbol`,
				clearing.settled[reel][row],
				clearing.revealedBoard[reel][row],
			);
		}
	}
}

// ---------------------------------------------------------------------------
// 10 - the CASCADE arrives the same way the spin does.
//
// A game that surfaces its symbols on the spin and DROPS them on a win has two behaviours, which
// is what a style is supposed to remove. So the cascade's refill follows `swapStyle` too.
//
// But only the refills. `combineTumbleReel` stacks the new symbols ABOVE the survivors - that is
// the engine's gravity model and the board the SERVER scored the next step against - so a symbol
// that did not win still changes seat. Placing it instantly would land on the right board and show
// the player a non-winning symbol teleporting down the column. The rule under test is therefore
// asymmetric, and both halves are asserted here: refills appear (duration 0, `intro`), survivors
// slide (duration 200, `land`).
//
// The cascade handler itself lives in `bookEventHandlerMap.ts`, which a Node fixture cannot stand
// up (it reaches XState, the flow interpreter and the RGS). Its BRANCH is asserted at source level;
// what the branch selects - the appear cue against a board that has survivors - is driven for real.
// ---------------------------------------------------------------------------

console.log('--- 10. the cascade arrives the same way the spin does ---');

{
	const coded = read('apps/lines/src/game/bookEventHandlerMap.ts');
	const cascade = coded.slice(coded.indexOf('tumbleBoard: async ('));
	const step = cascade.slice(0, cascade.indexOf('\n\t},'));
	check(
		'the cascade picks its arrival from the board swap STYLE',
		step.includes("stateGameDerived.boardSwapStyle() === 'emerge'") &&
			step.includes('stateGameDerived.boardSwapsInPlace()'),
		true,
	);
	check(
		'...choosing the appear cue over the slide',
		/emerges \? 'tumbleBoardAppear' : 'tumbleBoardSlideDown'/.test(step),
		true,
	);
	check(
		'...and the slide is still what every other board reaches',
		step.includes('tumbleBoardSlideDown'),
		true,
	);
	check(
		'...and the branch is read AFTER the winners are removed, not before',
		step.indexOf('tumbleBoardRemoveExploded') < step.indexOf('boardSwapStyle()'),
		true,
	);
}

{
	// A REAL CASCADE STEP against a board that HAS survivors. The bottom visible row explodes, which
	// is the case that makes both remaining symbols relocate: a survivor BELOW an exploded cell keeps
	// its seat, so exploding the top row would leave nothing moving and the assertions below would
	// pass for want of anything to catch.
	const clock = createClock();
	const landed = [];
	const sounded = [];
	const moves = [];
	const previousBoard = boardOf('old');
	const runtime = buildTumbleRuntime({
		clock,
		previousBoard,
		tileArt: undefined,
		onLand: (name) => landed.push(name),
		onSound: (cue) => sounded.push(cue),
		moves,
		// The step ends in an APPEAR, which is the emerge style's motion.
		swapStyle: 'emerge',
	});
	// One replacement per exploded cell, which is the contract a real `tumbleBoard` event holds to.
	const addingBoard = Array.from({ length: REELS }, (_u, reel) => [rawSymbol(`new${reel}`)]);
	const explodingPositions = Array.from({ length: REELS }, (_u, reel) => ({ reel, row: ROWS }));

	await clock.run(async () => {
		runtime.handlers.tumbleBoardInit({ addingBoard });
		await runtime.handlers.tumbleBoardExplode({ explodingPositions });
		runtime.handlers.tumbleBoardRemoveExploded({});
		await runtime.handlers.tumbleBoardAppear({});
	});

	const instant = moves.filter((m) => m.duration === 0);
	const travelled = moves.filter((m) => m.duration !== 0);
	check('every refill is placed instantly - one per column', instant.length, REELS);
	check(
		'...and every one of them at duration 0',
		instant.every((m) => m.duration === 0),
		true,
	);
	// Two survivors per column relocate: the pair that sat ABOVE the exploded bottom row.
	check('the survivors DO travel - two per column', travelled.length, REELS * 2);
	check(
		'...at the slide duration, not instantly',
		travelled.every((m) => m.duration === 200),
		true,
	);

	// WHAT PLAYED. A refill arrives (its own emerge voice); a survivor settles (no intro cue).
	check(
		'only the refills ask for an emerge cue',
		sounded.filter((c) => c.startsWith('symbol:intro:')).length,
		REELS,
	);
	check(
		'...and it is the REFILL that asks, not a survivor',
		sounded.filter((c) => c.startsWith('symbol:intro:new')).length,
		REELS,
	);
	// Every visible cell reports a landing whichever way it got there - the scatter counter cannot
	// depend on the presentation.
	check('every visible cell still reports a landing', landed.length, REELS * ROWS);

	// THE BOARD IS THE ONE THE ENGINE'S GRAVITY MODEL PRODUCES - refills above survivors. This is the
	// assertion that would catch a "nothing moves at all" cascade, which lands the right symbols in
	// the WRONG cells and silently diverges from the board the server scored.
	const combined = runtime.tumbleBoardCombined();
	check(
		'the refill sits ABOVE the survivors, not in the hole it filled',
		combined[0].map((sym) => sym.rawSymbol.name).join(','),
		['old0-0', 'new0', 'old0-1', 'old0-2', 'old0-4'].join(','),
	);
	// The seat stub the harness hands the runtime is `(row + 0.5) * 120`, and the runtime seats a
	// symbol at `index - PAD_ROWS_ABOVE`; restated here so the assertion is about the ARRIVAL, not
	// about agreeing with itself.
	const seatOf = (index) => (index - 1 + 0.5) * 120;
	check(
		'...and every cell comes to rest on its own seat',
		combined.every((reel) => reel.every((sym, index) => sym.cascade.y.current === seatOf(index))),
		true,
	);
	check(
		'...with nothing left mid-animation',
		combined.every((reel) => reel.every((sym) => sym.symbolState === 'static')),
		true,
	);
}

{
	// THE TWO REGRESSIONS THIS BLOCK EXISTS FOR, both reported from a live game as "very broken"
	// and "a long delay", and neither visible to any assertion that existed at the time.
	//
	//  (a) A refill was placed the instant the step began, while the survivor whose seat it was
	//      taking was still sliding out of it. The refills stack directly above the survivors, so
	//      the topmost survivor's OLD seat IS the bottom refill's new one - they overlapped for the
	//      whole 200 ms slide.
	//  (b) The arrival waited `INTRO_BEAT_CAP_MS` on art nobody had authored. An inherited `intro`
	//      falls back to `land` or to the resting art, which often report nothing, so the cap was
	//      paid IN FULL on every arrival: measured at 2650 virtual ms per cascade step against the
	//      shipped slide's 1500.
	const drive = async ({ authoredIntro, slide = false } = {}) => {
		const clock = createClock();
		const moves = [];
		const runtime = buildTumbleRuntime({
			clock,
			previousBoard: boardOf('old'),
			tileArt: undefined,
			onLand: () => {},
			onSound: () => {},
			moves,
			authoredIntro,
			// The style IS which motion the step ends in — the two this block compares.
			swapStyle: slide ? 'dropIn' : 'emerge',
		});
		const addingBoard = Array.from({ length: REELS }, (_u, reel) => [rawSymbol(`new${reel}`)]);
		const explodingPositions = Array.from({ length: REELS }, (_u, reel) => ({ reel, row: ROWS }));
		await clock.run(async () => {
			runtime.handlers.tumbleBoardInit({ addingBoard });
			await runtime.handlers.tumbleBoardExplode({ explodingPositions });
			runtime.handlers.tumbleBoardRemoveExploded({});
			await (slide
				? runtime.handlers.tumbleBoardSlideDown({})
				: runtime.handlers.tumbleBoardAppear({}));
		});
		return { moves, elapsed: clock.at() };
	};

	const emerge = await drive();
	const slide = await drive({ slide: true });

	// (a) NOTHING IS PLACED UNTIL EVERY SURVIVOR HAS ARRIVED. Stated on the clock rather than as an
	// ordering of statements, because that is the thing the player sees: the last slide must have
	// FINISHED before the first placement happens.
	const placedAt = emerge.moves.filter((m) => m.duration === 0).map((m) => m.at);
	const slidDoneAt = emerge.moves.filter((m) => m.duration === 200).map((m) => m.at + m.duration);
	check('the cascade both places and slides', placedAt.length > 0 && slidDoneAt.length > 0, true);
	check(
		'...and NO refill is placed before every survivor has vacated its seat',
		Math.min(...placedAt) >= Math.max(...slidDoneAt),
		true,
	);

	// (b) AN UN-AUTHORED EMERGE COSTS WHAT THE SLIDE COST. Not "is fast" - the same number, so the
	// assertion cannot drift as either presentation is re-timed.
	check(
		'an un-authored emerge cascade costs exactly what the shipped slide costs',
		emerge.elapsed,
		slide.elapsed,
	);

	// ...and the long cap is still there for art that earns it.
	const authored = await drive({ authoredIntro: (name) => name.startsWith('new') });
	check(
		'an AUTHORED intro is still given the long cap to play in',
		authored.elapsed > emerge.elapsed,
		true,
	);
	check(
		'...and the difference is exactly the two caps',
		authored.elapsed - emerge.elapsed,
		INTRO_CAP_MS - TRANSIT_CAP_MS,
	);
}

// ---------------------------------------------------------------------------
// THE PRE-SPIN STANDS DOWN TOO — the roll the reveal cannot unwind.
//
// `presentReveal` skipping `enhancedBoard.spin` is NOT enough to stop a swap-in-place board
// rolling, because it is not the only thing that starts a roll. `actor.ts`'s `onNewGameStart` fires
// `enhancedBoard.preSpin` on the BUTTON PRESS, before the RGS has answered, so the reveal's branch
// never unwinds it. Left in, the reels rolled from the press until the drop-in hid them — reported
// from a live game as "the reels spin, then stop mid-spin and new symbols appear", together with
// the board going FLAT for that whole roll (a rolling strip runs far past the visible rows, and the
// seat's depth ramp clamps there, so every symbol draws at front-row size).
//
// Asserted at source level: a Node fixture cannot stand up the XState actor, but it can insist the
// guard exists, sits BEFORE the call it guards, and does not swallow the rest of the handler.
// ---------------------------------------------------------------------------
{
	const actor = read('apps/lines/src/game/actor.ts');
	const guard = actor.indexOf('boardSwapsInPlace()');
	const preSpin = actor.indexOf('enhancedBoard.preSpin(');
	check('actor.ts guards the pre-spin on boardSwapsInPlace()', guard > -1, true);
	check(
		'...and the guard comes BEFORE the pre-spin it guards',
		guard > -1 && guard < preSpin,
		true,
	);
	check(
		'...and it returns rather than falling through',
		/if \(stateGameDerived\.boardSwapsInPlace\(\)\) return;/.test(actor),
		true,
	);
	// The rest of `onNewGameStart` must NOT be skipped: clearing the previous round's presentation
	// and zeroing the win amount are not the roll, and a swap-in-place board still needs both.
	check(
		'...and the win-presentation clear still runs before the guard',
		actor.indexOf('clearWinPresentation()') < guard,
		true,
	);
	check(
		'...and winBookEventAmount is still zeroed before the guard',
		actor.indexOf('winBookEventAmount = 0') < guard,
		true,
	);
}

// ---------------------------------------------------------------------------
// 11 — A SYMBOL THAT ALREADY EXPLODED IS NOT CLEARED A SECOND TIME.
// ---------------------------------------------------------------------------

console.log('--- 11. the board clear takes the seats the win blew up as it finds them ---');

/**
 * The claims that must hold for ONE ARM of the clear, driven over a board whose `removedCells` the
 * win-explosion pop already emptied.
 *
 * Both arms — the whole board at once, and one column at a time — reach the same helper, and they
 * are asserted SEPARATELY because that is the only way a difference between them becomes visible: a
 * count of call sites cannot see a per-column arm that lost its own argument.
 */
const assertClearOverRemoved = ({ label, run, removedCells }) => {
	const explodes = run.log.filter((entry) => entry.type === 'tumbleBoardExplode');
	for (let reelIndex = 0; reelIndex < REELS; reelIndex += 1) {
		const explodeAt =
			explodes.length === 1 ? explodes[0] : explodes.find((e) => e.reelIndex === reelIndex);
		const keys = explodeAt.explodingPositions.map(({ reel, row }) => `${reel}:${row}`);
		// EVERY visible seat, holes included. A seat the pop emptied is still one this step OWNS, and
		// the board-wide removal after it is keyed on what the step NAMED — so filtering it out here
		// would leave it standing in `base` while everything around it left. It costs nothing: the
		// overlay's explode handler recognises an already-gone seat and returns before it waits.
		check(
			`${label}: column ${reelIndex} pops every visible seat, the emptied ones included`,
			keys.filter((key) => key.startsWith(`${reelIndex}:`)).join(','),
			Array.from({ length: ROWS }, (_unused, row) => `${reelIndex}:${row + 1}`).join(','),
		);
	}
	// …but a seat that is already gone is never ASKED to explode. The per-symbol pop cue is the
	// audible proof: it fires inside the branch a gone seat returns before reaching, so a cue for one
	// of these seats would mean the step waited on a cell that draws nothing — the whole beat cap, on
	// the one step a swap-in-place project runs every spin.
	check(
		`${label}: a removed symbol is never given a clear-reel cue`,
		run.sounded.some((cue) =>
			removedCells.some(([reel, row]) => cue === `symbol:clearReel:old${reel}-${row}`),
		),
		false,
	);
	check(
		`${label}: while every seat that is still there gets one`,
		run.sounded.filter((cue) => cue.startsWith('symbol:clearReel:')).length,
		REELS * ROWS - removedCells.length,
	);
	// THE OVERLAY MUST NOT BRING THEM BACK. Its survivor layer is built from the RESTING board, and
	// the reel board is hidden for the whole swap — so a removed cell that arrived here drawable
	// would re-materialise the symbol the reels are hiding, for exactly the length of the clear.
	const undrawn = explodes[0].baseUndrawnBefore;
	check(
		`${label}: the survivor layer still holds one entry per seat — a removal moves no index`,
		undrawn.map((column) => column.length).join(','),
		Array.from({ length: REELS }, () => STRIP).join(','),
	);
	check(
		`${label}: and the removed seats arrive already undrawn`,
		removedCells.map(([reel, row]) => undrawn[reel][row]).join(','),
		removedCells.map(() => 'true').join(','),
	);
	check(
		`${label}: while every other seat is still there to be popped`,
		undrawn.flat().filter(Boolean).length,
		removedCells.length,
	);
};

{
	// The reported bug, driven: a swap-in-place project with "Clear the board before the new symbols
	// fall in" ON and Invisible Symbols → "Winning symbols explode" ON read Win → Explosion → Clear
	// reel, because the NEXT spin's clear popped every visible cell — the winners it had already
	// blown up included. The win-explosion pop now takes them off (`Board.svelte` marks the cell
	// `removed`), and the clear must take that board as it finds it.
	//
	// Three cells of a middle payline, in the padded rows a win can actually land on.
	const removedCells = [
		[1, 2],
		[2, 2],
		[3, 2],
	];
	const cleared = await runReveal({
		name: 'dropInRevealBoard',
		source: dropInPresentation,
		clearBoard: true,
		removedCells,
	});
	assertClearOverRemoved({ label: 'whole board', run: cleared, removedCells });
	// …and the step's removal takes them WITH the cells it popped. That is what the marking in the
	// explode handler buys: the seat is `clearReel` because THIS step named it, so the one board-wide
	// filter sweeps both. A seat left `static` would survive into the settle as a symbol the player
	// watched explode. Every column here is a padded strip whose three visible rows all leave.
	const removal = cleared.log.find((entry) => entry.type === 'tumbleBoardRemoveExploded');
	check(
		'the survivor layer arrives at the removal whole',
		removal.baseLengthsBefore.join(','),
		Array.from({ length: REELS }, () => STRIP).join(','),
	);
	check(
		'and leaves it holding nothing but the two buffer rows, removed seats included',
		removal.baseLengthsAfter.join(','),
		Array.from({ length: REELS }, () => STRIP - ROWS).join(','),
	);
	// …and the end state is untouched: the clear rewrites the very layer the settle reads, so the
	// drop-in's contract has to be re-asserted THROUGH a removal, not assumed to survive it.
	check('the run still settles one column per reel', cleared.settled?.length, REELS);
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`settled cell (${reel}, ${row}) IS the revealed symbol`,
				cleared.settled[reel][row],
				cleared.revealedBoard[reel][row],
			);
		}
	}
	// PARITY: the same run with nothing removed. The exploding SET is identical — that is the point
	// of leaving the emptied seats in it — and the difference the fixture can SEE is what the step
	// actually played, which is three fewer pops.
	const untouched = await runReveal({
		name: 'dropInRevealBoard',
		source: dropInPresentation,
		clearBoard: true,
	});
	check(
		'nothing removed ⇒ the same seats are named',
		untouched.log.find((entry) => entry.type === 'tumbleBoardExplode').explodingPositions.length,
		cleared.log.find((entry) => entry.type === 'tumbleBoardExplode').explodingPositions.length,
	);
	check(
		'…but every one of them is actually popped',
		untouched.sounded.filter((cue) => cue.startsWith('symbol:clearReel:')).length,
		REELS * ROWS,
	);
}

{
	// THE OTHER ARM. `clearOutgoingSymbols(reelIndex)` is a second call site with its own SCOPED
	// removal, and a column cascade runs its columns concurrently — so this is where a removal that
	// took a neighbour's symbols, or a column that lost its emptied seat early, would show up.
	// Driven over its own arguments rather than counted at the call site.
	const removedCells = [
		[0, 1],
		[2, 3],
		[4, 2],
	];
	const cleared = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadePresentation,
		staggerMs: 5000,
		clearBoard: true,
		removedCells,
	});
	assertClearOverRemoved({ label: 'one column at a time', run: cleared, removedCells });
	// Each column's own removal empties exactly that column and leaves its neighbours alone.
	for (const removal of cleared.log.filter((e) => e.type === 'tumbleBoardRemoveExploded')) {
		check(
			`column ${removal.reelIndex}: the removal empties its own visible rows and no others`,
			removal.baseLengthsBefore.map((length, reel) => length - removal.baseLengthsAfter[reel]).join(','), // prettier-ignore
			Array.from({ length: REELS }, (_unused, reel) => (reel === removal.reelIndex ? ROWS : 0)).join(','), // prettier-ignore
		);
	}
	check('the run still settles one column per reel', cleared.settled?.length, REELS);
	for (let reel = 0; reel < REELS; reel += 1) {
		for (let row = 0; row < STRIP; row += 1) {
			check(
				`column-cascade settled cell (${reel}, ${row}) IS the revealed symbol`,
				cleared.settled[reel][row],
				cleared.revealedBoard[reel][row],
			);
		}
	}
}

// ---------------------------------------------------------------------------
// 12 — A CASCADE STEP OWNS ONLY THE SEATS THE BOOK NAMES.
//
// A cascade removes and refills in the same step: `tumbleBoardRemoveExploded` filters `base` by
// `symbolState === 'clearReel'`, and the `adding` layer is sized to `bookEvent.explodingSymbols`. So
// the removal and the refill are two readings of ONE list, and they only stay in step while the
// removal takes exactly what the step popped.
//
// The win-explosion pop puts a second kind of gone cell on that board. If one of those were swept by
// a step that never named it, `tumbleBoardCombined()` would come up SHORT — broadcast as
// `boardSettle`, written to the reels, and from there `combineTumbleReel`'s "baseReel[0] is the top
// pad" assumption starts pointing at a real symbol and every later step of the chain addresses the
// wrong rows. Nothing about that is visible until a win frame is drawn over a symbol that never
// paid.
//
// Driven over the REAL cascade handler, the REAL survivor-layer factory and the REAL removal.
// ---------------------------------------------------------------------------

console.log('--- 12. a cascade step keeps the seats the round already emptied ---');

/** The cascade step, sliced out of the coded handler map — the one book event that keeps `base`. */
const cascadeStepSource = stripTypes(
	'the tumbleBoard handler slice',
	sliceBetween(
		read('apps/lines/src/game/bookEventHandlerMap.ts'),
		'tumbleBoard',
		'\ttumbleBoard: async (bookEvent',
		'\n\t},\n',
	)
		.replace(/^\ttumbleBoard: async \(/, 'const tumbleBoardStep = async (')
		// The slice ends on the handler map's own trailing comma; as a declaration it needs a semicolon.
		.replace(/\},\n$/, '};\n'),
);

/** Drive ONE cascade step against the real cue handlers, on the virtual clock. */
const runCascadeStep = async ({
	previousBoard,
	removedCells = [],
	explodingSymbols,
	newSymbols,
}) => {
	const clock = createClock();
	const sounded = [];
	const previousRemoved = previousBoard.map((strip, reel) =>
		strip.map((_cell, row) => removedCells.some(([r, w]) => r === reel && w === row)),
	);
	const runtime = buildTumbleRuntime({
		clock,
		previousBoard,
		previousRemoved,
		onSound: (cue) => sounded.push(cue),
		moves: [],
		swapStyle: 'dropIn',
	});
	let settled;
	const eventEmitter = {
		broadcast: (event) => {
			if (event.type === 'boardSettle') settled = event.board;
			runtime.handlers[event.type]?.(event);
		},
		broadcastAsync: async (event) => {
			await runtime.handlers[event.type]?.(event);
		},
	};
	const step = compileSlice({
		what: 'verify-swap-in-place-mode / the cascade tumbleBoardStep',
		names: ['eventEmitter', 'stateGameDerived', 'tumbleBoardCombined'],
		body: `${cascadeStepSource}\nreturn tumbleBoardStep;`,
	})(
		eventEmitter,
		{ boardSwapsInPlace: () => false, boardSwapStyle: () => 'dropIn' },
		runtime.tumbleBoardCombined,
	);
	await clock.run(() => step({ type: 'tumbleBoard', explodingSymbols, newSymbols }));
	return { settled, sounded, runtime, clock };
};

{
	// The book explodes ONE cell in each of the five columns — row 1 of the padded strip. The round's
	// pop has ALSO already emptied (2, 3), a seat this step never names.
	const previousBoard = boardOf('old');
	const explodingSymbols = Array.from({ length: REELS }, (_unused, reel) => ({ reel, row: 1 }));
	const newSymbols = Array.from({ length: REELS }, (_unused, reel) => [rawSymbol(`fresh${reel}`)]);
	const run = await runCascadeStep({
		previousBoard,
		removedCells: [[2, 3]],
		explodingSymbols,
		newSymbols,
	});

	check(
		'the settled board is still one padded strip per reel',
		run.settled.map((column) => column.length).join(','),
		Array.from({ length: REELS }, () => STRIP).join(','),
	);
	// THE SEAT THE ROUND EMPTIED IS STILL THERE, holding its own symbol at its own index. The book
	// scored the next step against a board that has it, so this is what "the book is the authority"
	// means in code.
	check(
		'the seat the win-explosion pop emptied survives the step, by identity',
		run.settled[2].includes(previousBoard[2][3]),
		true,
	);
	check(
		'…and it is never asked to explode — the step did not name it',
		run.sounded.includes('symbol:clearReel:old2-3'),
		false,
	);
	// …while the seat the BOOK named leaves and is replaced by the refill queued above it.
	check(
		'the exploded seat is gone and the refill took the column back to length',
		run.settled[2].map((cell) => cell.name).join(','),
		['old2-0', 'fresh2', 'old2-2', 'old2-3', 'old2-4'].join(','),
	);
	check('…and it DID pop', run.sounded.includes('symbol:clearReel:old2-1'), true);
	// PARITY: with nothing emptied, the same step settles the same board — the pop is a difference
	// this fixture can SEE, not a default it inherited.
	const untouched = await runCascadeStep({ previousBoard, explodingSymbols, newSymbols });
	check(
		'nothing emptied ⇒ the step settles exactly the same board',
		JSON.stringify(untouched.settled.map((c) => c.map((s) => s.name))),
		JSON.stringify(run.settled.map((c) => c.map((s) => s.name))),
	);
}

{
	// The other half: a seat the round emptied that the book DOES name. It must be swept WITH the
	// cells that popped — its replacement is already in `adding` — and must not cost a beat.
	const previousBoard = boardOf('old');
	const explodingSymbols = [
		{ reel: 1, row: 2 },
		{ reel: 3, row: 2 },
	];
	const newSymbols = Array.from({ length: REELS }, (_unused, reel) =>
		reel === 1 || reel === 3 ? [rawSymbol(`fresh${reel}`)] : [],
	);
	const run = await runCascadeStep({
		previousBoard,
		removedCells: [[1, 2]],
		explodingSymbols,
		newSymbols,
	});
	check(
		'a seat the round emptied AND the book named still leaves',
		run.settled[1].map((cell) => cell.name).join(','),
		['old1-0', 'fresh1', 'old1-1', 'old1-3', 'old1-4'].join(','),
	);
	check(
		'…without being popped a second time',
		run.sounded.includes('symbol:clearReel:old1-2'),
		false,
	);
	check(
		'…while its co-exploding neighbour on the other reel does pop',
		run.sounded.includes('symbol:clearReel:old3-2'),
		true,
	);
	check(
		'every column still settles one padded strip',
		run.settled.map((column) => column.length).join(','),
		Array.from({ length: REELS }, () => STRIP).join(','),
	);
}

console.log('');
if (failures) {
	console.log(`${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(
	`${checks} checks — the board's behaviour is authored in the game CONFIG (not per layout ratio),\n` +
		`the mode switches independently of farScale, the reel-shaped behaviours stand down with it, a\n` +
		`drop-in reveal leaves the reel board holding exactly the symbols a spin would have settled on\n` +
		`— with or without the clear step ahead of it — a columnCascade drains and refills LEFT TO\n` +
		`RIGHT onto that same end state with the stagger as the one knob, and the ground tiles never\n` +
		`blink out across a swap.`,
);
