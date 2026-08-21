// Offline fixture for the SWAP-IN-PLACE board mode (docs/design/perspective-board-mode.md, phase 2).
//
//   node scripts/verify-swap-in-place-mode.mjs
//
// WHAT IT PROVES, in three parts.
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
// WHAT IT CANNOT PROVE. The drop-in is a PRESENTATION sequence, and a fixture is not a renderer:
//   * Nothing here draws, so "the board looks right falling in" is not tested and cannot be. The
//     seat each symbol is aimed at comes from `getSymbolSeat`, which has its own fixture
//     (`verify-symbol-seat.mjs`); here it is a monotonic stand-in, because what is under test is the
//     SEQUENCE, not the algebra.
//   * The awaits are real but the animations are not: `Tween.set` resolves immediately and the beat
//     cap resolves on the next tick, so this proves the ORDER of the steps and that each is awaited
//     before the next, NOT their durations or how they feel.
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
if (!seatBlock.includes('const boardSwapsInPlace = () =>')) {
	throw new Error('boardSwapsInPlace is no longer inside the geometry block');
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
	.replace(/ as const/g, '')
	.replace(/\$state\(/g, '(');
for (const name of ['initTumbleBoardAdding', 'initTumbleBoardNoBase', 'initTumbleBoardBase']) {
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

/** A `Tween` that lands instantly — this fixture times ORDER, not duration (see the header). */
class Tween {
	constructor(value) {
		this.current = value;
	}
	async set(value) {
		this.current = value;
	}
}

const rawSymbol = (name) => ({ name });
/** A padded strip: one buffer row, `ROWS` visible rows, one buffer row. */
const stripOf = (prefix) =>
	Array.from({ length: STRIP }, (_unused, row) => rawSymbol(`${prefix}${row}`));
const boardOf = (prefix) =>
	Array.from({ length: REELS }, (_unused, reel) => stripOf(`${prefix}${reel}-`));

const runDropIn = async () => {
	const previousBoard = boardOf('old');
	const revealedBoard = boardOf('new');
	const landed = [];
	const log = [];
	let settled;

	const build = new Function(
		'Tween',
		'backOut',
		'waitForResolve',
		'waitForTimeout',
		'getSymbolSeat',
		'stateGameDerived',
		`${tumbleStateSource}
let show = false;
${helpers}
const handlers = ${handlersSource};
return { handlers, stateTumble, tumbleBoardCombined, showing: () => show };`,
	);

	const runtime = build(
		Tween,
		(t) => t,
		(arm) => new Promise((resolve) => arm(resolve)),
		// The beat CAP, short-circuited: no symbol reports `oncomplete` here (there is no renderer), so
		// every beat resolves through this race arm — which is exactly what an unauthored `land` state
		// does in the real game, only without the 650 ms wait.
		() => new Promise((resolve) => setTimeout(resolve, 0)),
		// A monotonic stand-in. The real seat algebra has its own fixture; what is under test here is
		// which seat each symbol is AIMED at, not what that seat evaluates to.
		(reel, row) => ({ x: reel * 120, y: (row + 0.5) * 120, scale: 1 }),
		{
			boardRaw: () => previousBoard,
			onSymbolLand: ({ rawSymbol: landedSymbol }) => landed.push(landedSymbol.name),
		},
	);

	const dispatch = (event) => {
		log.push(event.type);
		if (event.type === 'boardSettle') settled = event.board;
		const handler = runtime.handlers[event.type];
		return handler ? handler(event) : undefined;
	};
	const eventEmitter = {
		broadcast: (event) => void dispatch(event),
		broadcastAsync: async (event) => void (await dispatch(event)),
	};

	const dropInRevealBoard = new Function(
		'eventEmitter',
		'tumbleBoardCombined',
		`${dropInSource}\nreturn dropInRevealBoard;`,
	)(eventEmitter, runtime.tumbleBoardCombined);

	await dropInRevealBoard({ type: 'reveal', board: revealedBoard, gameType: 'basegame' });
	return { log, settled, landed, revealedBoard, previousBoard, runtime };
};

const dropIn = await runDropIn();

// THE SEQUENCE — the cascade's, minus the two steps a reveal has nothing to do with.
check(
	'the drop-in broadcasts the cascade sequence minus the explode steps',
	dropIn.log.join(' → '),
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
	dropIn.log.indexOf('boardSettle') > dropIn.log.indexOf('tumbleBoardSlideDown'),
	true,
);
check(
	'the board is settled BEFORE the overlay is reset — a reset first would settle an empty board',
	dropIn.log.indexOf('boardSettle') < dropIn.log.indexOf('tumbleBoardReset'),
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
	const build = new Function(
		'Tween',
		'backOut',
		'waitForResolve',
		'waitForTimeout',
		'getSymbolSeat',
		'stateGameDerived',
		`${tumbleStateSource}
let show = false;
${helpers}
const handlers = ${handlersSource};
return { handlers, tumbleBoardCombined };`,
	);
	const runtime = build(
		Tween,
		(t) => t,
		(arm) => new Promise((resolve) => arm(resolve)),
		() => new Promise((resolve) => setTimeout(resolve, 0)),
		(reel, row) => ({ x: reel * 120, y: (row + 0.5) * 120, scale: 1 }),
		{ boardRaw: () => previousBoard, onSymbolLand: () => {} },
	);
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
}

console.log('');
if (failures) {
	console.log(`${failures} FAILED of ${checks} checks`);
	process.exit(1);
}
console.log(
	`${checks} checks — swapInPlace switches the board MODE independently of farScale, the reel-shaped\n` +
		`behaviours stand down with it, and a drop-in reveal leaves the reel board holding exactly the\n` +
		`symbols a spin would have settled on.`,
);
