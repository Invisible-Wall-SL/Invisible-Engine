/**
 * Guard the KTX2 encode dimensions (`ktx2Dimensions.ts`).
 *
 *     node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-ktx2-alignment.mjs
 *
 * WHY THIS GUARD EXISTS — it is the only thing standing between this rule and a silent black board.
 *
 * BC7, ASTC 4×4 and ETC2 store pixels in 4×4 blocks. A page encoded at a size that is not a
 * multiple of 4 uploads WITHOUT ERROR and samples as fully black: no exception, no console
 * warning, nothing in the network tab, HTTP 200 on a valid-looking `.ktx2` file. From the outside
 * it is indistinguishable from art that failed to load, and it only happens on the compressed tier
 * — which is the tier phones get and desktops do not, so it does not show up in normal testing.
 *
 * It shipped exactly that way. Measured on the live Book of Borut build: of the nine KTX2 pages on
 * the board, the three whose dimensions were not 4-aligned rendered black —
 *   • 1851×2800 (R_Board)            → the reel interior and cabinet
 *   • 3250×2048 (S_Game_UI2 sheet)   → the Win/Balance panel frames
 *   • 3250×2048 (UI button rig page) → the spin button, ±, turbo, auto, buy bonus
 * — while all six 4-aligned pages on the same board rendered correctly.
 *
 * The old rule had two faults and needed both to be wrong: it aligned only when the page was being
 * DOWNSCALED, and it aligned to a multiple of 2 rather than 4. `3250` is even, so it passed the old
 * check; `3250 / 4 = 812.5`, so the GPU rejected it. Any future edit that reintroduces either fault
 * is caught below.
 */
import {
	BLOCK,
	DEFAULT_MAX_DIMENSION,
	MAX_ENCODE_PIXELS,
	alignDown,
	targetSize,
} from '../apps/launcher-api/src/lib/server/ktx2Dimensions.ts';

let checks = 0;
const ok = (label, condition, detail = '') => {
	if (!condition) {
		console.error(`\n  FAIL  ${label}${detail ? `\n        ${detail}` : ''}\n`);
		process.exit(1);
	}
	checks += 1;
	console.log(`  [ok] ${label}`);
};
const aligned = (t) => t.width % BLOCK === 0 && t.height % BLOCK === 0;

console.log('1. the block constant is 4 — not 2, which is what shipped black');
ok('BLOCK === 4', BLOCK === 4, `got ${BLOCK}`);
ok('alignDown(3250) === 3248', alignDown(3250) === 3248, String(alignDown(3250)));
ok('alignDown(1851) === 1848', alignDown(1851) === 1848, String(alignDown(1851)));
ok('alignDown(2048) === 2048 (already aligned, untouched)', alignDown(2048) === 2048);
ok('alignDown never returns 0', alignDown(1) === BLOCK && alignDown(0) === BLOCK);

console.log('\n2. the three pages that actually rendered black are now aligned');
for (const [w, h, what] of [
	[1851, 2800, 'R_Board — reel interior + cabinet'],
	[3250, 2048, 'S_Game_UI2 sheet — panel frames'],
	[3250, 2048, 'UI button rig page — spin / ± / turbo / auto'],
]) {
	const t = targetSize(w, h, DEFAULT_MAX_DIMENSION);
	ok(`${w}x${h} (${what}) → ${t.width}x${t.height}, block-aligned`, aligned(t), JSON.stringify(t));
	ok(
		`  ${w}x${h} shrinks by less than one block per axis`,
		w - t.width < BLOCK && h - t.height < BLOCK,
	);
}

console.log('\n3. the pages that rendered CORRECTLY are returned unchanged (byte-parity)');
for (const [w, h] of [
	[2048, 4096],
	[4096, 2048],
	[2048, 1100],
	[2048, 1024],
	[1024, 1800],
]) {
	const t = targetSize(w, h, DEFAULT_MAX_DIMENSION);
	ok(`${w}x${h} unchanged`, t.width === w && t.height === h, JSON.stringify(t));
}

console.log('\n4. alignment applies on the DOWNSCALE path too (it always did — keep it)');
{
	const t = targetSize(4096, 8096, DEFAULT_MAX_DIMENSION); // the oversized-cinematic case
	ok('a downscaled page is aligned', aligned(t), JSON.stringify(t));
	ok('and respects the max dimension', Math.max(t.width, t.height) <= DEFAULT_MAX_DIMENSION);
	ok('and the area cap', t.width * t.height <= MAX_ENCODE_PIXELS);
	ok('aspect ratio preserved within a block', Math.abs(t.width / t.height - 4096 / 8096) < 0.01);
}

console.log('\n5. exhaustive — NOTHING may come out unaligned');
{
	let worst = null;
	for (let w = 4; w <= 5000; w += 7) {
		for (const h of [512, 1023, 1851, 2048, 2800, 3250, 4096, 6000, 8096]) {
			const t = targetSize(w, h, DEFAULT_MAX_DIMENSION);
			if (!aligned(t)) {
				worst = `${w}x${h} -> ${t.width}x${t.height}`;
				break;
			}
			if (t.width * t.height > MAX_ENCODE_PIXELS) {
				worst = `${w}x${h} over area cap`;
				break;
			}
			if (Math.max(t.width, t.height) > DEFAULT_MAX_DIMENSION) {
				worst = `${w}x${h} over max dim`;
				break;
			}
		}
		if (worst) break;
	}
	ok(
		'every size in a 6400-case sweep is aligned and within both caps',
		worst === null,
		worst || '',
	);
}

console.log('\n6. odd and prime sizes — the shapes a hand-packed atlas actually produces');
for (const [w, h] of [
	[1851, 2800],
	[999, 1001],
	[4093, 4093],
	[1, 1],
	[3, 7],
]) {
	const t = targetSize(w, h, DEFAULT_MAX_DIMENSION);
	ok(`${w}x${h} → ${t.width}x${t.height} aligned`, aligned(t));
}

console.log(`\nPASS: ${checks} checks.\n`);
