/**
 * Offline check that a flipbook symbol cell's PER-STATE playback overrides survive the real
 * server schema, over the REAL module.
 *
 * It cannot be run directly — `symbolsStorage.ts` imports `engine-layout` (extensionless imports)
 * and the R2 client. Bundle it first, from THIS directory:
 *
 *   echo "export const env = {};" > .env-stub.mjs
 *   pnpm exec esbuild symbolClipPlayback.fixture.ts --bundle --platform=node --format=esm \
 *     --outfile=.fixture.run.mjs "--alias:\$env/dynamic/private=./.env-stub.mjs" \
 *     --external:@aws-sdk/client-s3 --external:@aws-sdk/s3-request-presigner \
 *     --external:drizzle-orm --external:postgres
 *   node .fixture.run.mjs && rm -f .fixture.run.mjs .env-stub.mjs
 *
 * WHY this is worth a fixture rather than a type-check: `symbolCellSchema` is `.strict()`, and the
 * page's `applyDraft` is a hand-written whitelist that rebuilds the cell field by field. Those two
 * lists have to agree, and nothing makes them: a field added to the UI but not the schema is a 400
 * on a save the author has every reason to think is valid, and a field added to the schema but not
 * the whitelist is silently dropped on save — drawn in the panel, gone after a reload, with the
 * launcher's `vite build` green either way (it is not a type-check).
 */

import { normalizeSymbolsDoc } from './src/lib/server/symbolsStorage.ts';

let failures = 0;
const check = (label: string, cond: boolean): void => {
	if (cond) {
		console.log(`  ✓ ${label}`);
	} else {
		console.error(`  ✗ ${label}`);
		failures++;
	}
};

const doc = (cell: Record<string, unknown>): unknown => ({
	version: 1,
	symbols: { H1: { win: cell } },
});
const winCell = (parsed: ReturnType<typeof normalizeSymbolsDoc>): Record<string, unknown> =>
	(parsed.symbols?.H1?.win ?? {}) as Record<string, unknown>;

console.log('\nflipbook symbol cell — per-state playback overrides\n');

// --- the shape the page's applyDraft actually writes -------------------------
const full = winCell(
	normalizeSymbolsDoc(
		doc({
			type: 'flipbook',
			assetKey: 'manifests/sym.json',
			clipId: 'wave',
			fps: 30,
			direction: 'pingpong',
			flipX: false,
			flipY: true,
		}),
	),
);
check('the full override block is ACCEPTED by the strict schema', Object.keys(full).length > 0);
check('fps survives', full.fps === 30);
check('direction survives', full.direction === 'pingpong');
check('an explicit flipX:false survives (it is an override, not an absence)', full.flipX === false);
check('flipY survives', full.flipY === true);

// --- sparseness: an untouched cell gains nothing -----------------------------
const bare = winCell(
	normalizeSymbolsDoc(doc({ type: 'flipbook', assetKey: 'manifests/sym.json', clipId: 'wave' })),
);
check(
	'a cell that overrides nothing stays sparse (no defaults written in)',
	!('fps' in bare) && !('direction' in bare) && !('flipX' in bare) && !('flipY' in bare),
);

// --- the guards --------------------------------------------------------------
const rejects = (label: string, cell: Record<string, unknown>): void => {
	let threw = false;
	try {
		normalizeSymbolsDoc(doc(cell));
	} catch {
		threw = true;
	}
	check(label, threw);
};
rejects('an unknown direction is rejected, not coerced', {
	type: 'flipbook',
	assetKey: 'a.json',
	clipId: 'c',
	direction: 'backwards',
});
rejects('a zero/negative fps is rejected', {
	type: 'flipbook',
	assetKey: 'a.json',
	clipId: 'c',
	fps: 0,
});
rejects('a typo\u2019d field is still rejected \u2014 the schema is strict', {
	type: 'flipbook',
	assetKey: 'a.json',
	clipId: 'c',
	flipx: true,
});

// A sprite cell carrying them is NOT rejected: the schema is one shape for three kinds (as it
// already is for `animationName`/`clipId`), and the UI is what keeps them off a sprite. Pinned so
// a future tightening is a deliberate decision rather than a surprise.
const onSprite = winCell(
	normalizeSymbolsDoc(doc({ type: 'sprite', assetKey: 'a.json::f0', direction: 'reverse' })),
);
check(
	'the schema does not police kind-vs-field (documented, matches animationName/clipId)',
	onSprite.direction === 'reverse',
);

console.log('');
if (failures > 0) {
	console.error(`SYMBOL CLIP PLAYBACK: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('SYMBOL CLIP PLAYBACK: PASSED');
