/**
 * Offline fixture for the art tier a device loads (`artTier.ts`, `docs/design/arcade-4k-builds.md`
 * Phase 4). Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../lines/src/game/artTier.fixture.ts
 *
 * Pins, on real device sizes:
 *   1. a 4K game on a 4K cabinet loads `full`, and on a 1440p desktop too (its art shows above half);
 *   2. the same game on a 1080p desktop or a phone loads `half`; a 2× iPad shows it above half and keeps `full`;
 *   3. a 1920×1080 game never picks `half` on any of them — there is nothing smaller to need — which
 *      is what keeps every game that publishes no tiers loading what it always did;
 *   4. the render tier's resolution cap and the device pixel ratio enter the sum;
 *   5. the box comes from the window's bucket: a portrait phone fits the portrait box;
 *   6. `?tier=` forces either answer, and an unknown value is ignored.
 */

import { DEFAULT_LAYOUT_PROFILE } from 'constants-shared/layoutProfile';
import { artScreenScale, chooseArtTier, type ArtTierInput } from './artTier';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	if (actual === expected) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}: got ${String(actual)}, expected ${String(expected)}`);
	}
};

const box = (w: number, h: number) => ({ width: w, height: h });
const k4 = {
	mainSizesMap: {
		desktop: box(3840, 2160),
		landscape: box(3840, 2160),
		portrait: box(2160, 3840),
		tablet: box(3840, 3840),
	},
	layoutProfile: {
		...DEFAULT_LAYOUT_PROFILE,
		buckets: DEFAULT_LAYOUT_PROFILE.buckets.map((b) => ({
			...b,
			box: box(b.box.width * 2, b.box.height * 2),
		})),
	},
};
const hd = { mainSizesMap: { desktop: box(1920, 1080), portrait: box(1080, 1920) } };

const device = (width: number, height: number, devicePixelRatio: number, maxResolution = 2) => ({
	window: { width, height, devicePixelRatio },
	maxResolution,
});
const DEVICES: Record<string, ReturnType<typeof device>> = {
	'4K cabinet (3840×2160 @1)': device(3840, 2160, 1),
	'1440p desktop (2560×1300 @1)': device(2560, 1300, 1),
	'1080p desktop (1920×950 @1)': device(1920, 950, 1),
	'iPhone portrait (390×844 @3)': device(390, 844, 3),
	'Android landscape (915×412 @2.6)': device(915, 412, 2.6),
	'iPad (1024×1366 @2)': device(1024, 1366, 2),
};
const tierOf = (name: string, doc: ArtTierInput['doc'], forced?: string) =>
	chooseArtTier({ ...DEVICES[name], doc, forced });

console.log('1-2. a 4K game');
check('cabinet → full', tierOf('4K cabinet (3840×2160 @1)', k4), 'full');
check('1440p desktop → full', tierOf('1440p desktop (2560×1300 @1)', k4), 'full');
check('1080p desktop → half', tierOf('1080p desktop (1920×950 @1)', k4), 'half');
check('iPhone → half', tierOf('iPhone portrait (390×844 @3)', k4), 'half');
check('Android landscape → half', tierOf('Android landscape (915×412 @2.6)', k4), 'half');
// A portrait iPad at 2× fits the 2160×3840 box at 0.356 and shows the art at 71%: half would blur.
check('iPad → full', tierOf('iPad (1024×1366 @2)', k4), 'full');

console.log('3. a 1920×1080 game never asks for less');
for (const name of Object.keys(DEVICES)) check(`${name} → full`, tierOf(name, hd), 'full');
check(
	'no doc at all → full',
	chooseArtTier({ ...DEVICES['1080p desktop (1920×950 @1)'], doc: null }),
	'full',
);

console.log('4. the device pixel ratio and the render cap count');
check(
	'a 1080p desktop at 2× shows the 4K art at full size',
	chooseArtTier({ ...device(1920, 1080, 2), doc: k4 }),
	'full',
);
check(
	'… but not when the reduced render tier caps it at 1.5 and the window is smaller',
	chooseArtTier({ ...device(1600, 900, 2, 1.5), doc: k4 }),
	'full',
);
check(
	'a 1280×720 window at 1× → half',
	chooseArtTier({ ...device(1280, 720, 1), doc: k4 }),
	'half',
);
check(
	'the scale is the fit times the capped ratio',
	artScreenScale({ ...device(1920, 1080, 3, 2), doc: k4 }),
	1,
);

console.log('5. the window’s bucket picks the box');
check(
	'a portrait phone fits the portrait box (2160×3840)',
	Number(artScreenScale({ ...device(390, 844, 3), doc: k4 }).toFixed(4)),
	Number((Math.min(390 / 2160, 844 / 3840) * 2).toFixed(4)),
);

console.log('6. ?tier= forces it');
check('?tier=half on the cabinet', tierOf('4K cabinet (3840×2160 @1)', k4, 'half'), 'half');
check('?tier=full on a phone', tierOf('iPhone portrait (390×844 @3)', k4, 'full'), 'full');
check('?tier=quarter is ignored', tierOf('iPhone portrait (390×844 @3)', k4, 'quarter'), 'half');

if (failures) throw new Error(`${failures} art tier check(s) failed`);
console.log('\n✓ art tier: all checks pass');
