// Offline fixture for the SWAP-IN-PLACE board mode (docs/design/perspective-board-mode.md, phase 2).
//
//   node scripts/verify-swap-in-place-mode.mjs
//
// WHAT IT PROVES, in five parts.
//
//   1. `swapInPlace` IS INDEPENDENT OF `farScale`. This is the trap the whole phase turns on. The
//      seat algebra calls a board FLAT — and `boardPerspective()` returns `undefined` — whenever
//      `farScale` is absent, non-finite, `<= 0` or exactly `1`. That is correct for geometry and
//      wrong for the mode, because the design keeps the two knobs separate on purpose: "a stylised
//      game may want a converging grid that still rolls, or a flat board that swaps". So
//      `{ swapInPlace: true }` with NO `farScale` is a legal, intended configuration, and a
//      `boardSwapsInPlace` derived from `boardPerspective()` would make it do nothing at all, with
//      no error anywhere to find. Both functions are sliced out of the real module and asserted
//      against each other over the whole cross-product of the two knobs.
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
//      "exactly one tile layer at a time": the overlay's own `overlayTileArt` is sampled after every
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
//
// Everything under test is SLICED OUT OF THE SHIPPED SOURCE — the modules are runes/Svelte and
// cannot be imported from Node — so a rename or a reordering fails loudly here rather than leaving
// the fixture quietly asserting nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

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

const constantsSource = read('packages/engine-game/src/game/constants.ts');
const readConst = (name) => {
	const match = constantsSource.match(new RegExp(`export const ${name} = ([\\d.]+);`));
	if (!match) throw new Error(`constants.ts no longer exports ${name}`);
	return Number(match[1]);
};

const buildEngine = new Function(
	'SYMBOL_SIZE',
	'REEL_PADDING',
	'resolveReelGridFromNode',
	'boardOverride',
	'deps',
	'stateGame',
	`${resolverSource}
${seatBlock}
${standDownBlock}
return {
	boardPerspective,
	boardSwapsInPlace,
	boardSwapStyle,
	boardColumnStaggerMs,
	getSymbolSeat,
	anticipationActive,
	sequentialStopActive,
	stackedPicturesActive,
};`,
);

/**
 * @param perspective the authored `perspective` block, or undefined for "no block at all"
 * @param flags the three reel-shaped runtime flags, as a game's `stateGame` carries them
 */
const engineFor = (perspective, flags = {}) =>
	buildEngine(
		readConst('SYMBOL_SIZE'),
		readConst('REEL_PADDING'),
		() => null,
		{ node: perspective === undefined ? null : { perspective } },
		{
			layout: { layoutType: () => 'desktop' },
			boardDimensions: () => ({ x: 5, y: 3 }),
		},
		{
			anticipationMode: false,
			sequentialReelStop: false,
			stackedPictureMode: false,
			...flags,
		},
	);

console.log('--- 1. the mode switch is independent of the geometry ---');

// THE TRAP, stated as the assertion: a bare `swapInPlace` switches the MODE on while leaving the
// board geometrically flat. Both halves matter — an implementation gated on `boardPerspective()`
// fails the first line, and one that quietly turned the geometry on fails the second.
{
	const engine = engineFor({ swapInPlace: true });
	check('bare swapInPlace: the mode is ON', engine.boardSwapsInPlace(), true);
	check('bare swapInPlace: the board is still FLAT', engine.boardPerspective(), undefined);
	const flat = engineFor(undefined);
	check(
		'bare swapInPlace: the seat is byte-identical to a board with no perspective at all',
		engine.getSymbolSeat(3, 2).y,
		flat.getSymbolSeat(3, 2).y,
	);
	check(
		'bare swapInPlace: and so is its x',
		engine.getSymbolSeat(3, 2).x,
		flat.getSymbolSeat(3, 2).x,
	);
	check('bare swapInPlace: and its scale', engine.getSymbolSeat(3, 2).scale, 1);
}

// The mirror image: a converging grid that still ROLLS. `farScale` alone must not switch the mode.
{
	const engine = engineFor({ farScale: 0.6 });
	check('bare farScale: the mode is OFF', engine.boardSwapsInPlace(), false);
	check('bare farScale: the geometry is ON', typeof engine.boardPerspective(), 'object');
}

// Both together, and neither.
{
	const both = engineFor({ farScale: 0.6, swapInPlace: true });
	check('both knobs: the mode is ON', both.boardSwapsInPlace(), true);
	check('both knobs: the geometry is ON', typeof both.boardPerspective(), 'object');

	const none = engineFor(undefined);
	check('no block: the mode is OFF', none.boardSwapsInPlace(), false);
	check('no block: the geometry is OFF', none.boardPerspective(), undefined);
}

// Every "flat" `farScale` the seat algebra rejects must STILL leave `swapInPlace` alone — this is
// the regression that a shared early-return would reintroduce.
for (const farScale of [1, 0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
	const engine = engineFor({ farScale, swapInPlace: true });
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
	const engine = engineFor({ swapInPlace });
	check(
		`swapInPlace=${JSON.stringify(swapInPlace)} is not the mode`,
		engine.boardSwapsInPlace(),
		false,
	);
}

// THE SWAP STYLE — a sibling of the mode switch, with the same defensive shape. Absent ⇒ `'dropIn'`
// ⇒ the shipped presentation, which is the parity claim for every board authored before it existed.
{
	const none = engineFor(undefined);
	check('no block at all ⇒ the shipped drop-in', none.boardSwapStyle(), 'dropIn');
	check('no block at all ⇒ no authored stagger', none.boardColumnStaggerMs(), undefined);

	const swapping = engineFor({ swapInPlace: true });
	check('swapInPlace with no style ⇒ the shipped drop-in', swapping.boardSwapStyle(), 'dropIn');

	const cascade = engineFor({ swapInPlace: true, swapStyle: 'columnCascade' });
	check(
		'an authored columnCascade survives the resolver',
		cascade.boardSwapStyle(),
		'columnCascade',
	);
	check('and it does not switch the geometry on', cascade.boardPerspective(), undefined);
	check('and the mode is still on', cascade.boardSwapsInPlace(), true);

	// The style is authored DATA, so anything that is not one of the two recognised literals must
	// read as the shipped drop-in rather than reach a presentation branch that does not exist.
	for (const swapStyle of ['columncascade', 'cascade', '', 0, 1, true, null, undefined, {}]) {
		check(
			`swapStyle=${JSON.stringify(swapStyle)} ⇒ the shipped drop-in`,
			engineFor({ swapInPlace: true, swapStyle }).boardSwapStyle(),
			'dropIn',
		);
	}
	// A style with no mode beside it is INERT, not an error: the reveal reaches no swap presentation
	// at all, so this is only ever read on a board that swaps.
	check(
		'a style with no swapInPlace leaves the mode off',
		engineFor({ swapStyle: 'columnCascade' }).boardSwapsInPlace(),
		false,
	);
}

// THE STAGGER — passed through raw (the presentation owns the default), and `0` must survive, since
// "every column at once" is a legal authoring choice that a truthiness test would silently replace.
{
	check(
		'an authored stagger survives',
		engineFor({ swapInPlace: true, columnStaggerMs: 320 }).boardColumnStaggerMs(),
		320,
	);
	check(
		'a zero stagger survives — it means "no sweep", not "unset"',
		engineFor({ swapInPlace: true, columnStaggerMs: 0 }).boardColumnStaggerMs(),
		0,
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
			engineFor({ swapInPlace: true, columnStaggerMs }).boardColumnStaggerMs(),
			undefined,
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

		const swapping = engineFor({ swapInPlace: true }, { [flag]: flagValue });
		check(
			`${accessor} with ${flag}=${flagValue}, swapInPlace ⇒ stood down`,
			swapping[accessor](),
			false,
		);

		// And it stands down on a FLAT swapping board too — the same trap, one level down: gating a
		// stand-down on the geometry would leave every reel behaviour live on exactly the board that
		// has no reels.
		const flatSwapping = engineFor({ farScale: 1, swapInPlace: true }, { [flag]: flagValue });
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

// The real cascade board's helpers + cue handlers, sliced out of `TumbleBoard.svelte`. Only the
// module's TYPE annotations are removed; the bodies are the shipped ones.
const tumbleComponent = read('apps/lines/src/components/TumbleBoard.svelte');
const componentScript = tumbleComponent.slice(tumbleComponent.lastIndexOf('<script lang="ts">'));
const helpers = (
	sliceBetween(componentScript, 'PADDING_ROW', '\tconst PADDING_ROW =', ';\n') +
	sliceBetween(
		componentScript,
		'the TumbleBoard helpers',
		'\tconst CASCADE_BEAT_CAP_MS =',
		'\tcontext.eventEmitter.subscribeOnMount({',
	)
)
	.replace('\tcontext.eventEmitter.subscribeOnMount({', '')
	.replace(/\(arm: \(resolve: \(\) => void\) => void\)/, '(arm)')
	.replace(/\}: \{[\s\S]*?\}\): TumbleSymbol => \{/, '}) => {')
	.replace(/\}: \{ addingBoard: AddingBoard \}\)/, '})')
	.replace(/\(\): TumbleSymbol\[\]\[\] =>/g, '() =>')
	.replace(/\(reelIndex: number, addingReel: RawSymbol\[\]\)/g, '(reelIndex, addingReel)')
	.replace(/\(reelIndex: number\)/g, '(reelIndex)')
	.replace(/ as const/g, '')
	.replace(/\$state\(/g, '(')
	.replace(/\$derived\(/g, '(');
for (const name of [
	'initTumbleBoardAddingReel',
	'initTumbleBoardAdding',
	'initTumbleBoardNoBase',
	'initTumbleBoardBaseReel',
	'initTumbleBoardBase',
	'overlayTileArt',
]) {
	if (!helpers.includes(`const ${name} = `)) {
		throw new Error(`the TumbleBoard slice no longer declares ${name}`);
	}
}
// The strippers above are hand-written, so an annotation this fixture does not know about would be
// evaluated as JavaScript and throw somewhere unhelpful. Fail on the annotation instead.
if (/:\s*(number|RawSymbol|TumbleSymbol|AddingBoard)\b/.test(helpers)) {
	throw new Error('the TumbleBoard helper slice grew a type annotation this fixture cannot strip');
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

// The cascade board's own state, sliced too — `tumbleBoardCombined` is the function that decides
// what the drop-in settles on, so it must be the real one.
const tumbleState = read('apps/lines/src/game/stateTumble.svelte.ts');
const tumbleStateSource = [
	sliceBetween(tumbleState, 'stateTumble', 'export const stateTumble = ', '});\n'),
	sliceBetween(tumbleState, 'tumbleBoardCombined', 'export const tumbleBoardCombined = ', ';\n'),
	sliceBetween(tumbleState, 'resetTumbleBoard', 'export const resetTumbleBoard = ', '\n};\n'),
]
	.join('\n')
	.replace(/export const /g, 'const ')
	.replace(/\$state\(/g, '(')
	.replace(/ as TumbleSymbol\[\]\[\]/g, '')
	.replace(/\(\): TumbleSymbol\[\]\[\] =>/g, '() =>');

// The reveal presentation itself, sliced out of the shared module both drivers now call.
const flowEffects = read('apps/lines/src/game/flowEffects.ts');
const dropInSource = sliceBetween(
	flowEffects,
	'dropInRevealBoard',
	'const dropInRevealBoard = async (',
	'\n};\n',
).replace(": BookEventOfType<'reveal'>", '');
if (dropInSource.includes('tumbleBoardExplode') || dropInSource.includes('RemoveExploded')) {
	throw new Error('dropInRevealBoard explodes symbols — a reveal has nothing to explode yet');
}
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
const columnCascadeSource = sliceBetween(
	flowEffects,
	'columnCascadeRevealBoard',
	'const columnCascadeRevealBoard = async (',
	'\n};\n',
).replace(": BookEventOfType<'reveal'>", '');
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
	presentReveal.includes("stateGameDerived.boardSwapStyle() === 'columnCascade'") &&
		presentReveal.includes('await columnCascadeRevealBoard(bookEvent);'),
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
const tweenClass = (clock) =>
	class Tween {
		constructor(value) {
			this.current = value;
		}
		async set(value, options) {
			await clock.wait(options?.duration);
			this.current = value;
		}
	};

const rawSymbol = (name) => ({ name });
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
 */
const buildTumbleRuntime = ({ clock, previousBoard, tileArt, onLand }) => {
	const build = new Function(
		'Tween',
		'backOut',
		'cubicIn',
		'waitForResolve',
		'waitForTimeout',
		'getSymbolSeat',
		'stateGameDerived',
		`${tumbleStateSource}
let show = false;
let reelBoardShown = true;
${helpers}
const handlers = ${handlersSource};
return {
	handlers,
	stateTumble,
	tumbleBoardCombined,
	overlayTileArt,
	showing: () => show,
	reelsShowing: () => reelBoardShown,
};`,
	);
	return build(
		tweenClass(clock),
		(t) => t,
		(t) => t,
		(arm) => new Promise((resolve) => arm(resolve)),
		// The beat CAP on the virtual clock: no symbol reports `oncomplete` here (there is no
		// renderer), so every beat resolves through this race arm — which is exactly what an
		// unauthored `land` state does in the real game.
		(ms) => clock.wait(ms),
		// A monotonic stand-in. The real seat algebra has its own fixture; what is under test here is
		// which seat each symbol is AIMED at, not what that seat evaluates to. With `ROWS = 3` the
		// board window bottom is 360, so anything a drain leaves below that is out of the window.
		(reel, row) => ({ x: reel * 120, y: (row + 0.5) * 120, scale: 1 }),
		{
			boardRaw: () => previousBoard,
			boardTileArt: () => tileArt,
			onSymbolLand: ({ rawSymbol: landedSymbol }) => onLand?.(landedSymbol.name),
		},
	);
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
	tileArt,
	previousBoard = boardOf('old'),
	revealedBoard = boardOf('new'),
}) => {
	const clock = createClock();
	const landed = [];
	const log = [];
	let settled;

	const runtime = buildTumbleRuntime({
		clock,
		previousBoard,
		tileArt,
		onLand: (symbolName) => landed.push(symbolName),
	});

	const logEvent = (event) => {
		const entry = { type: event.type, reelIndex: event.reelIndex, at: clock.at() };
		if (event.type === 'boardSettle') settled = event.board;
		// The survivor layer of the column being refilled, SAMPLED BEFORE the handler runs — that is
		// the "did this column drain first" question, asked at the only moment it can be asked.
		if (event.type === 'tumbleBoardInit' && event.reelIndex !== undefined) {
			entry.baseLengthBefore = runtime.stateTumble.base[event.reelIndex]?.length;
		}
		// The symbols a drain is about to move, held by reference so their FINAL y can be read after
		// the fall — the overlay drops them out of its own layers, so there is nowhere else to look.
		if (event.type === 'tumbleBoardDrain') {
			entry.draining = [...(runtime.stateTumble.base[event.reelIndex] ?? [])];
		}
		log.push(entry);
		return entry;
	};
	const sample = (entry) => {
		entry.overlayTile = runtime.overlayTileArt()?.key ?? null;
		entry.reelsShowing = runtime.reelsShowing();
		if (entry.draining) entry.drainedY = entry.draining.map((symbol) => symbol.symbolY.current);
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

	const present = new Function(
		'eventEmitter',
		'tumbleBoardCombined',
		'stateGameDerived',
		'waitForTimeout',
		'COLUMN_CASCADE_STAGGER_MS',
		`${source}\nreturn ${name};`,
	)(
		eventEmitter,
		runtime.tumbleBoardCombined,
		{ boardColumnStaggerMs: () => staggerMs },
		(ms) => clock.wait(ms),
		COLUMN_CASCADE_STAGGER_MS,
	);

	await clock.run(() => present({ type: 'reveal', board: revealedBoard, gameType: 'basegame' }));
	const types = log.map((entry) => entry.type);
	return { log, types, settled, landed, revealedBoard, previousBoard, runtime, clock };
};

const dropIn = await runReveal({ name: 'dropInRevealBoard', source: dropInSource });

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
// stays as the survivor layer and the adding layer sits on top of it.
{
	const previousBoard = boardOf('old');
	const runtime = buildTumbleRuntime({ clock: createClock(), previousBoard });
	const adding = [[rawSymbol('a0')], [rawSymbol('a1')], [], [], []];
	runtime.handlers.tumbleBoardInit({ type: 'tumbleBoardInit', addingBoard: adding });
	const combined = runtime.tumbleBoardCombined();
	check('keepBase absent ⇒ the survivors stay', combined[0].length, 1 + STRIP);
	check('keepBase absent ⇒ the adding layer is on top', combined[0][0].rawSymbol.name, 'a0');
	check(
		'keepBase absent ⇒ the survivor below it is the old board',
		combined[0][1].rawSymbol.name,
		'old0-0',
	);

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

const cascade = await runReveal({ name: 'columnCascadeRevealBoard', source: columnCascadeSource });

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
		source: columnCascadeSource,
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
		source: columnCascadeSource,
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
		source: columnCascadeSource,
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
// 6 — the ground tiles survive the swap.
// ---------------------------------------------------------------------------

console.log('--- 6. the ground tiles survive the swap ---');

const TILE = { key: 'ground::tile', fallbackKey: 'tile' };

{
	const tiled = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadeSource,
		tileArt: TILE,
	});
	// The invariant, checked at EVERY step rather than at a chosen moment: the overlay draws the
	// ground exactly when it owns the screen, and never while the reel board is up.
	check(
		'the overlay never draws the ground while the reel board is showing',
		tiled.log.every((entry) => !(entry.reelsShowing && entry.overlayTile)),
		true,
	);
	const afterShow = tiled.log.findIndex((entry) => entry.type === 'tumbleBoardShow');
	const atHide = tiled.log.findIndex((entry) => entry.type === 'tumbleBoardHide');
	check('the overlay picks the ground up as it mounts', tiled.log[afterShow].overlayTile, TILE.key);
	check(
		'and holds it for every beat of the swap — the ground never blinks out',
		tiled.log.slice(afterShow, atHide).every((entry) => entry.overlayTile === TILE.key),
		true,
	);
	check('the overlay drops the ground as it unmounts', tiled.log[atHide].overlayTile, null);
	check(
		'and the reel board has it back at the end',
		tiled.log[tiled.log.length - 1].reelsShowing,
		true,
	);
	check(
		'the overlay draws no ground once it is hidden',
		tiled.log[tiled.log.length - 1].overlayTile,
		null,
	);

	// The drop-in gets the identical treatment — the tile fix is the OVERLAY's, not the cascade's.
	const tiledDropIn = await runReveal({
		name: 'dropInRevealBoard',
		source: dropInSource,
		tileArt: TILE,
	});
	check(
		'the drop-in overlay carries the ground too',
		tiledDropIn.log
			.slice(
				tiledDropIn.log.findIndex((entry) => entry.type === 'tumbleBoardShow'),
				tiledDropIn.log.findIndex((entry) => entry.type === 'tumbleBoardHide'),
			)
			.every((entry) => entry.overlayTile === TILE.key),
		true,
	);

	// NO AUTHORED `tileRegion` ⇒ no tile layer anywhere, at any point. This is the parity claim, and
	// it is not optional: `apps/lines` is the shared `_runtime/lines` bundle every online game runs.
	const untiled = await runReveal({
		name: 'columnCascadeRevealBoard',
		source: columnCascadeSource,
	});
	check(
		'a board with no tileRegion mounts no tile layer at any point of the swap',
		untiled.log.every((entry) => entry.overlayTile === null),
		true,
	);

	// The double-draw guard, exercised DIRECTLY: an authored flow can broadcast `tumbleBoardShow`
	// without `boardHide` (both are standard-vocabulary Broadcast cues), which holds both boards on
	// screen for as long as it likes. The overlay must still refuse the ground.
	const runtime = buildTumbleRuntime({
		clock: createClock(),
		previousBoard: boardOf('old'),
		tileArt: TILE,
	});
	check('before anything, the reel board owns the ground', runtime.overlayTileArt(), undefined);
	runtime.handlers.tumbleBoardShow({ type: 'tumbleBoardShow' });
	check(
		'the overlay shown WITHOUT hiding the reels still draws no ground — one layer, never two',
		runtime.overlayTileArt(),
		undefined,
	);
	runtime.handlers.boardHide({ type: 'boardHide' });
	check('once the reels are hidden it takes the ground over', runtime.overlayTileArt(), TILE);
	runtime.handlers.boardShow({ type: 'boardShow' });
	check('and hands it straight back when they return', runtime.overlayTileArt(), undefined);
}

// The markup side of the same claim — the answer above is only worth anything if it is what mounts.
{
	const markup = tumbleComponent.slice(tumbleComponent.indexOf('{#if show}'));
	check(
		'the overlay mounts BoardTiles behind its guard',
		markup.includes('{#if tileArt}') && markup.includes('<BoardTiles art={tileArt} />'),
		true,
	);
	check(
		'and the guard is the overlay’s own answer, not a second policy',
		componentScript.includes('const tileArt = $derived(overlayTileArt());'),
		true,
	);
	// The reel board's own layer is untouched — the fix ADDS a layer to the overlay, it does not move
	// the existing one, so a board that never swaps is byte-identical.
	const boardComponent = read('apps/lines/src/components/Board.svelte');
	check(
		'the reel board still mounts its own tile layer',
		boardComponent.includes('{#if tileArt}') &&
			boardComponent.includes('<BoardTiles art={tileArt} />'),
		true,
	);
}

console.log('');
if (failures) {
	console.log(`${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(
	`${checks} checks — swapInPlace switches the board MODE independently of farScale, the reel-shaped\n` +
		`behaviours stand down with it, a drop-in reveal leaves the reel board holding exactly the symbols\n` +
		`a spin would have settled on, a columnCascade drains and refills LEFT TO RIGHT onto the same end\n` +
		`state with the stagger as the one knob, and the ground tiles never blink out across a swap.`,
);
