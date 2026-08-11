// Verify the authorable-layout-profile bucket selection reproduces the LEGACY hardcoded
// `layoutType()` decision tree, so the layout-profiles change is behaviour-identical for
// shipped games (which ship no authored profile ⇒ DEFAULT_LAYOUT_PROFILE).
//
//   node scripts/test-layout-profile-parity.mjs
//
// Same esbuild-bundle trick as test-cover-fit.mjs: bundle the REAL `selectBucket` +
// `DEFAULT_LAYOUT_PROFILE` (pure TS in constants-shared, no `.svelte`) into one ESM file
// Node can run, then compare its bucket choice against a verbatim copy of the OLD classifier
// across a grid of real device sizes. The old code's exact treatment of the ratio === 0.8
// boundary (measure-zero) is intentionally NOT hit by the grid — see the half-open note in
// constants-shared/layoutProfile.ts.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export { selectBucket, DEFAULT_LAYOUT_PROFILE } from '../../constants-shared/layoutProfile.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
});
const tmp = join(tmpdir(), `layout-profile-parity-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text);
const { selectBucket, DEFAULT_LAYOUT_PROFILE } = await import(pathToFileURL(tmp).href);
await rm(tmp, { force: true });

// --- verbatim copy of the LEGACY classifier (createLayout.svelte.ts before this change) ---
const RATIO = { wideSquare: 1.3, narrowSquare: 0.8 };
const SIZE = { smallMobile: 375, mobile: 480 };
const legacyLayoutType = (w, h) => {
	const ratio = w / (h || 1);
	const ratioType =
		ratio >= RATIO.wideSquare
			? 'longWidth'
			: ratio <= RATIO.narrowSquare
				? 'longHeight'
				: 'almostSquare';
	const deviceWidth = Math.min(w, h);
	const sizeType =
		deviceWidth <= SIZE.smallMobile ? 'smallMobile' : deviceWidth <= SIZE.mobile ? 'mobile' : 'big';
	if (ratioType === 'almostSquare') return 'tablet';
	if (ratioType === 'longHeight') return 'portrait';
	if (sizeType === 'mobile' || sizeType === 'smallMobile') return 'landscape';
	return 'desktop';
};

// A grid of real window sizes (none landing exactly on ratio 0.8 — see note above).
const GRID = [
	[1920, 1080], // 16:9 desktop
	[2560, 1080], // 21:9 ultrawide
	[3440, 1440], // 21:9 large
	[1366, 768], // laptop
	[1280, 800], // laptop
	[1024, 768], // 4:3 largeTablet landscape
	[768, 1024], // iPad portrait
	[820, 1180], // iPad Air portrait
	[1180, 820], // iPad Air landscape (square-ish → tablet)
	[1024, 1024], // exactly square
	[375, 812], // iPhone portrait
	[812, 375], // iPhone landscape (wide + small → landscape)
	[390, 844], // iPhone 14 portrait
	[844, 390], // iPhone 14 landscape
	[414, 896], // large phone portrait
	[896, 414], // large phone landscape
	[360, 640], // small android portrait
	[640, 360], // small android landscape
	[600, 962], // narrow tablet portrait (ratio 0.62 → portrait)
	[1440, 900], // 16:10 desktop
];

let failures = 0;
for (const [w, h] of GRID) {
	const got = selectBucket(DEFAULT_LAYOUT_PROFILE, { width: w, height: h }).id;
	const want = legacyLayoutType(w, h);
	const ok = got === want;
	if (!ok) failures++;
	console.log(
		`  ${ok ? '✓' : '✗'} ${w}×${h} (r=${(w / h).toFixed(3)}) → ${got}${ok ? '' : ` (legacy: ${want})`}`,
	);
}

if (failures) {
	console.error(`\n✗ ${failures} bucket-selection mismatch(es) vs legacy classifier.`);
	process.exit(1);
}
console.log(
	'\n✓ layout-profile selection is byte-identical to the legacy layoutType() across the grid.',
);
