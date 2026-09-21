// Offline fixture for BOARD PAINT ORDER — who draws over whom, and why it used to stop being true.
//
//   node scripts/verify-board-paint-order.mjs
//
// WHAT IT PROVES. `pixi-svelte` adds a child to its parent once, inside `onMount`, and nothing ever
// re-derives the order (`packages/pixi-svelte/src/lib/context.svelte.ts`). A component's markup
// order therefore fixes the stacking of the children that mount TOGETHER and nothing else: anything
// that unmounts and remounts is appended to the END of its parent and paints over every sibling
// until the parent itself is rebuilt.
//
// That bit twice, at two scales, and both are pinned here:
//
//   1. BOARD CELLS. A cascade splices its refills ABOVE the survivors as NEW cells
//      (`combineTumbleReel`), so the refilled top rows mounted last and drew over the board. Fixed by
//      a seat-derived `zIndex` (`apps/lines/src/game/paintOrder.ts`, imported below — this tests the
//      real rule, not a copy of it).
//   2. SYMBOL LAYERS. A cell's `layers` resolve PER STATE, so a spin binding different layers
//      unmounts them and they came back in front of the character. Fixed by an unconditional
//      container per band plus a `zIndex` within a band (`apps/lines/src/components/Symbol.svelte`).
//      Section 2 drives REAL PixiJS Containers through the exact mount sequence a spin performs, and
//      reproduces the bug on the old shape before asserting the fix on the new one.
//
// The rank arithmetic's load-bearing property is that it has NO upper bound to get wrong. A cell's
// row is its index in `reelState.symbols`, which mid-roll becomes
// `[...targetSymbols, ...paddingSymbols, ...prevSymbols]` with the padding ACCUMULATING per reel —
// a plain 5x3 board runs 16 cells deep on reel 0 and 40 on reel 4. The first version of this fix
// budgeted `rows * 2 + 2` and columns spilled into each other on every spin.

// Resolved through `pixi-svelte`, which is the workspace package that actually depends on Pixi —
// the repo root does not, so a bare `pixi.js` specifier cannot resolve from `scripts/`.
import { Container } from '../packages/pixi-svelte/node_modules/pixi.js/lib/scene/container/Container.mjs';

import { SYMBOL_Z_MAX, symbolZIndex } from '../apps/lines/src/game/paintOrder.ts';

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const PADDING_ROW = -1;
const z = ({ reelIndex, row, reels, perspective = false, offset = 0 }) => {
	const rowIndex = row + PADDING_ROW;
	return symbolZIndex({ reelIndex, rowIndex, seatRow: rowIndex + offset, perspective, reels });
};

// =================================================================================================
// 1. BOARD CELLS
// =================================================================================================

// --- flat, at rest: exactly the order BoardBase mounts a flat board in ---------------------------
{
	const reels = 5;
	const cells = [];
	for (let reelIndex = 0; reelIndex < reels; reelIndex += 1)
		for (let row = 0; row < 6; row += 1) cells.push(z({ reelIndex, row, reels }));
	check('flat/rest: strictly increasing in mount order', cells.every((v, i) => i === 0 || v > cells[i - 1])); // prettier-ignore
	check('flat/rest: inside the band', cells.every((v) => v > 0 && v < SYMBOL_Z_MAX));
}

// --- flat, mid-roll: the regression that shipped in the first version ----------------------------
{
	const reels = 5;
	const rows = 3;
	const reelLength = rows + 2;
	// previousPaddingSize + basePaddingSize() per reel; basePaddingSize = reelLength * 1.2.
	const stripLen = (reel) => Math.ceil(reelLength * 1.2 * (reel + 1)) + 2 * reelLength;
	const cells = [];
	for (let reelIndex = 0; reelIndex < reels; reelIndex += 1)
		for (let row = 0; row < stripLen(reelIndex); row += 1) cells.push(z({ reelIndex, row, reels }));
	check(
		`flat/mid-roll: still column-major with staggered strips (${stripLen(0)}..${stripLen(4)} deep)`,
		cells.every((v, i) => i === 0 || v > cells[i - 1]),
	);
	const deepest0 = z({ reelIndex: 0, row: stripLen(0) - 1, reels });
	const first1 = z({ reelIndex: 1, row: 0, reels });
	check('flat/mid-roll: deepest cell of reel 0 stays below the first of reel 1', deepest0 < first1);
	check('flat: a 100k-deep strip still cannot reach the next column',
		z({ reelIndex: 0, row: 100000, reels }) < first1);
}

// --- perspective + stepped: back-to-front by seat row, columns INTERLEAVED -----------------------
{
	// test6: 5 columns, 3/4/4/4/4, centred — the short column carries a half-row offset.
	const rowsPerReel = [3, 4, 4, 4, 4];
	const maxRows = 4;
	const offsetFor = (reel) => (maxRows - rowsPerReel[reel]) / 2;
	const cells = [];
	for (let reelIndex = 0; reelIndex < rowsPerReel.length; reelIndex += 1)
		for (let row = 1; row <= rowsPerReel[reelIndex]; row += 1)
			cells.push({
				reelIndex,
				seatRow: row + PADDING_ROW + offsetFor(reelIndex),
				v: z({ reelIndex, row, reels: 5, perspective: true, offset: offsetFor(reelIndex) }),
			});
	const bySeat = [...cells].sort((a, b) => a.seatRow - b.seatRow);
	const byZ = [...cells].sort((a, b) => a.v - b.v);
	check('perspective+stepped: z order === seat-row order', bySeat.every((c, i) => byZ[i].v === c.v));
	const short = cells.filter((c) => c.reelIndex === 0).sort((a, b) => a.seatRow - b.seatRow);
	const tall = cells.filter((c) => c.reelIndex === 1).sort((a, b) => a.seatRow - b.seatRow);
	check('perspective+stepped: the 3-row column interleaves with its 4-row neighbour',
		short[0].v > tall[0].v && short[0].v < tall[1].v);
	check('perspective+stepped: inside the band', cells.every((c) => c.v > 0 && c.v < SYMBOL_Z_MAX));
}

// --- a cascade refill draws BEHIND the survivor below it -----------------------------------------
{
	const refill = z({ reelIndex: 2, row: 1, reels: 5, perspective: true });
	const survivor = z({ reelIndex: 2, row: 3, reels: 5, perspective: true });
	check('cascade: a spliced refill draws behind the survivor below it', refill < survivor);
}

// --- band neighbours: BoardTiles/BoardMask 0, StackedPicture 0.75, BookVfx fg +1 -----------------
{
	const worst = z({ reelIndex: 9, row: 500, reels: 10 });
	check('band: a 10-reel board never reaches StackedPicture (0.75)', worst < 0.75, `${worst}`);
	check('band: never touches the ground layers (0)', z({ reelIndex: 0, row: 0, reels: 10 }) > 0);
}

// =================================================================================================
// 2. SYMBOL LAYERS — real PixiJS containers, driven through a spin's mount sequence
// =================================================================================================

const named = (label, zIndex) => {
	const c = new Container();
	c.label = label;
	if (zIndex !== undefined) c.zIndex = zIndex;
	return c;
};
/** What `pixi-svelte`'s `addToParent` does on mount. */
const mount = (parent, child) => { parent.addChild(child); parent.sortChildren(); }; // prettier-ignore
/** What Pixi does at render time when the parent is sortable (`collectRenderablesMixin`). */
const order = (parent) => { parent.sortChildren(); return parent.children.map((c) => c.label).join('>'); }; // prettier-ignore

// --- the bug, on the shape that shipped: layers are direct children of the cell ------------------
{
	const cell = named('cell');
	const ripple = named('ripple');
	const shadow = named('shadow');
	const art = named('art');
	mount(cell, ripple); mount(cell, shadow); mount(cell, art); // prettier-ignore
	check('layers/old shape, first land: shadow is behind the character',
		order(cell) === 'ripple>shadow>art', order(cell));
	// A spin: the spin state binds no layers, so they unmount…
	cell.removeChild(ripple); cell.removeChild(shadow);
	// …and land again on the next state.
	mount(cell, ripple); mount(cell, shadow);
	check('layers/old shape, after a spin: the shadow has jumped IN FRONT (the reported bug)',
		order(cell) === 'art>ripple>shadow', order(cell));
}

// --- the fix: one unconditional container per band, zIndex within a band ------------------------
const buildCell = () => {
	const cell = named('cell');
	const bands = { behind: named('behind'), art: named('artBand'), over: named('over'), frame: named('frame') }; // prettier-ignore
	for (const band of [bands.behind, bands.art, bands.over, bands.frame]) mount(cell, band);
	mount(bands.art, named('art'));
	return { cell, ...bands };
};
const BANDS = 'behind>artBand>over>frame';

{
	const { cell, behind } = buildCell();
	const ripple = named('ripple', 1);
	const shadow = named('shadow', 2);
	mount(behind, ripple); mount(behind, shadow); // prettier-ignore
	check('layers/new shape, first land: bands in markup order', order(cell) === BANDS, order(cell));
	check('layers/new shape, first land: ripple under shadow', order(behind) === 'ripple>shadow');

	// The spin: both behind-layers unmount, then remount in the OPPOSITE order (a re-keyed {#each}
	// promises nothing about which lands first).
	behind.removeChild(ripple); behind.removeChild(shadow);
	mount(behind, shadow); mount(behind, ripple); // prettier-ignore
	check('layers/new shape, after a spin: the band is still behind the art', order(cell) === BANDS, order(cell)); // prettier-ignore
	check('layers/new shape, after a spin: zIndex restores ripple under shadow',
		order(behind) === 'ripple>shadow', order(behind));
}

// --- a band that empties completely and comes back ------------------------------------------------
{
	const { cell, over } = buildCell();
	const a = named('a', 1);
	mount(over, a);
	over.removeChild(a);
	check('layers: an emptied band keeps its slot', order(cell) === BANDS);
	mount(over, a);
	check('layers: …and its layer comes back in the right band', order(cell) === BANDS && order(over) === 'a'); // prettier-ignore
}

// --- many layers, remounted fully reversed --------------------------------------------------------
{
	const { behind } = buildCell();
	const layers = [0, 1, 2, 3, 4].map((i) => named(`L${i}`, i + 1));
	for (const l of layers) mount(behind, l);
	check('layers: five mount in array order', order(behind) === 'L0>L1>L2>L3>L4');
	for (const l of layers) behind.removeChild(l);
	for (const l of [...layers].reverse()) mount(behind, l);
	check('layers: …and survive a fully reversed remount', order(behind) === 'L0>L1>L2>L3>L4', order(behind)); // prettier-ignore
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
