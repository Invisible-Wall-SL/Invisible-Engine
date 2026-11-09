/**
 * Contract check for the launcher's ONE shelf packer (`$lib/shelfPack.ts`, shared by the Invisible
 * Font Maker's glyph atlas and the Rigger's rig-text page), over the REAL implementation.
 *
 *   1. TOO WIDE — an item wider than `maxWidth - 2*gap` throws (alone, or after another item has
 *      started the shelf) with the caller's `tooWideMessage`, instead of being placed anyway and
 *      reporting a page wider than `maxWidth` (the shelf wrap never fires for a shelf's first item).
 *   2. THE EDGE — an item exactly `maxWidth - 2*gap` wide fits and the page is exactly `maxWidth`.
 *   3. TOO TALL — still throws with the caller's `tooTallMessage`.
 *   4. UNCHANGED — a normal multi-item pack places items exactly as before.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/check-shelf-pack.ts  (from apps/launcher-api)
 */

import { shelfPack, type ShelfItem, type ShelfPackOptions } from '$lib/shelfPack';

let failures = 0;
let checks = 0;
const json = (value: unknown): string => JSON.stringify(value);
const check = (label: string, actual: unknown, expected: unknown): void => {
	checks += 1;
	const a = json(actual);
	const e = json(expected);
	if (a === e) return;
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};
/** The message `shelfPack` threw, or `null` if it returned. */
const thrown = (items: ShelfItem[], opts: ShelfPackOptions): string | null => {
	try {
		shelfPack(items, opts);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
};

const PAGE = { maxWidth: 2048, maxHeight: 2048, maxPages: 1 };
const MSG = { ...PAGE, tooWideMessage: 'TOO WIDE', tooTallMessage: 'TOO TALL' };

// 1. Too wide.
check('a too-wide item alone throws', thrown([{ width: 3000, height: 40 }], MSG), 'TOO WIDE');
check(
	'a too-wide item after another item throws',
	thrown(
		[
			{ width: 100, height: 40 },
			{ width: 3000, height: 40 },
		],
		MSG,
	),
	'TOO WIDE',
);
check(
	'an item one pixel over maxWidth - 2*gap throws',
	thrown([{ width: 2047, height: 40 }], MSG),
	'TOO WIDE',
);
check(
	'a too-wide item with a wider gap throws',
	thrown([{ width: 2045, height: 40 }], { ...MSG, gap: 2 }),
	'TOO WIDE',
);
const fallback = thrown([{ width: 3000, height: 40 }], PAGE);
check(
	'without a caller message the default one names the width',
	fallback !== null && fallback.includes('wider'),
	true,
);

// 2. The edge.
const edge = shelfPack([{ width: 2046, height: 40 }], MSG);
check('an item exactly maxWidth - 2*gap wide fits', edge.placements, [{ page: 0, x: 1, y: 1 }]);
check('…and the page is exactly maxWidth', edge.width, 2048);

// 3. Too tall.
check('a too-tall item still throws', thrown([{ width: 40, height: 3000 }], MSG), 'TOO TALL');
check(
	'an item one pixel over maxHeight - 2*gap throws',
	thrown([{ width: 40, height: 2047 }], MSG),
	'TOO TALL',
);

// 4. A normal pack is unchanged.
const normal = shelfPack(
	[
		{ width: 100, height: 20 },
		{ width: 100, height: 20 },
		{ width: 100, height: 30 },
		{ width: 0, height: 0 },
		{ width: 50, height: 10 },
	],
	{ maxWidth: 220, maxHeight: 512, gap: 2 },
);
check('a normal pack places every item as before', normal.placements, [
	{ page: 0, x: 2, y: 2 },
	{ page: 0, x: 104, y: 2 },
	{ page: 0, x: 2, y: 24 },
	{ page: 0, x: 0, y: 0 },
	{ page: 0, x: 104, y: 24 },
]);
check('…at the same page size', [normal.width, normal.height, normal.pageCount], [206, 56, 1]);
const paged = shelfPack(
	Array.from({ length: 3 }, () => ({ width: 60, height: 60 })),
	{ maxWidth: 64, maxHeight: 64, maxPages: 8 },
);
check(
	'a full page still rolls onto the next',
	paged.placements.map((p) => p.page),
	[0, 1, 2],
);
check(
	'a page budget is still enforced',
	thrown(
		Array.from({ length: 3 }, () => ({ width: 60, height: 60 })),
		{ maxWidth: 64, maxHeight: 64, maxPages: 1, tooManyPagesMessage: () => 'ONE PAGE ONLY' },
	),
	'ONE PAGE ONLY',
);

console.log(
	failures === 0
		? `\nshelf pack: OK (${checks} checks)`
		: `\nshelf pack: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
