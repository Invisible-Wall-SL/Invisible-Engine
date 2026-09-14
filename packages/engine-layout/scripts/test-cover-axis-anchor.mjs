// Verify the two authoring knobs a background cover gained on top of cover/contain:
//
//   1. PER-AXIS FIT (`fit: 'width' | 'height'`) — pin the fit to ONE axis whatever the window
//      ratio, where `cover`/`contain` pick the axis by aspect and so silently flip as the ratio
//      crosses the art's.
//   2. COVER ANCHOR — the node's `anchor` ALIGNS the fitted art in the window (0 = left/top,
//      0.5 = centred, 1 = right/bottom) instead of meaning nothing (every cover path used to
//      overwrite it with 0.5).
//
// …and that BOTH — plus the cover zoom and the stretch — take a per-layoutType override, so a
// backdrop can fit on X for desktop and on Y for portrait.
//
//   node scripts/test-cover-axis-anchor.mjs
//
// Same esbuild-bundle trick as test-cover-fit.mjs: bundle the REAL cover module into one ESM file
// Node can run, so these are the shipped functions, not a re-implementation.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

const bundled = await esbuild.build({
	stdin: {
		contents: `export {
			coverTransform,
			coverAnchorOffset,
			backgroundCoverAnchor,
			backgroundCoverScale,
			backgroundCoverStretch,
			backgroundFit,
		} from '../src/lib/coverTransform.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-cover-axis-anchor.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `cover-axis-anchor-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

const {
	coverTransform,
	coverAnchorOffset,
	backgroundCoverAnchor,
	backgroundCoverScale,
	backgroundCoverStretch,
	backgroundFit,
} = mod;

let failures = 0;
const assert = (cond, msg) => {
	if (cond) {
		console.info(`  ✓ ${msg}`);
	} else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

// A 16:9 art over a WIDER-than-art target and a TALLER-than-art target: the two cases where
// `cover`/`contain` swap which axis drives the scale.
const ART = { artWidth: 1920, artHeight: 1080 };
const WIDE = { targetWidth: 2400, targetHeight: 1000 };
const TALL = { targetWidth: 1000, targetHeight: 1600 };

// ---- (a) per-axis fit pins the named axis, in BOTH orientations ----
for (const [name, target] of [
	['wide window', WIDE],
	['tall window', TALL],
]) {
	const w = coverTransform({ ...ART, ...target, fit: 'width' });
	const h = coverTransform({ ...ART, ...target, fit: 'height' });
	assert(
		close(ART.artWidth * w.scaleX, target.targetWidth),
		`${name}: fit 'width' makes the art exactly as wide as the window`,
	);
	assert(
		close(ART.artHeight * h.scaleY, target.targetHeight),
		`${name}: fit 'height' makes the art exactly as tall as the window`,
	);
	// The fitted scale stays UNIFORM (no distortion) — only the driving axis changes.
	assert(close(w.scaleX, w.scaleY), `${name}: fit 'width' is uniform (no stretch)`);
	assert(close(h.scaleX, h.scaleY), `${name}: fit 'height' is uniform (no stretch)`);
}

// …and that is exactly what cover/contain CANNOT express: which axis they pin flips with the ratio.
{
	const coverWide = coverTransform({ ...ART, ...WIDE, fit: 'cover' });
	const coverTall = coverTransform({ ...ART, ...TALL, fit: 'cover' });
	const widthWide = coverTransform({ ...ART, ...WIDE, fit: 'width' });
	const widthTall = coverTransform({ ...ART, ...TALL, fit: 'width' });
	assert(
		close(coverWide.scaleX, widthWide.scaleX) && !close(coverTall.scaleX, widthTall.scaleX),
		"'cover' happens to fit width in a wide window but NOT in a tall one — 'width' pins it in both",
	);
}

// ---- (b) the anchor aligns the fitted art; it never changes the fit ----
{
	const base = { ...ART, ...TALL, fit: 'cover' };
	const centred = coverTransform(base);
	const left = coverTransform({ ...base, anchorX: 0, anchorY: 0 });
	const right = coverTransform({ ...base, anchorX: 1, anchorY: 1 });
	assert(
		close(centred.x, TALL.targetWidth / 2) && close(centred.y, TALL.targetHeight / 2),
		'default anchor (0.5) is centred — byte-identical to the old behaviour (parity)',
	);
	assert(
		close(left.scaleX, centred.scaleX) && close(right.scaleX, centred.scaleX),
		'the anchor does not perturb the fitted scale (fit is computed centred, then aligned)',
	);
	const drawnW = ART.artWidth * centred.scaleX;
	const drawnH = ART.artHeight * centred.scaleY;
	assert(
		close(left.x - drawnW / 2, 0) && close(left.y - drawnH / 2, 0),
		'anchor 0 puts the art’s left/top edge on the window’s left/top edge',
	);
	assert(
		close(right.x + drawnW / 2, TALL.targetWidth) && close(right.y + drawnH / 2, TALL.targetHeight),
		'anchor 1 puts the art’s right/bottom edge on the window’s right/bottom edge',
	);
	// The offset helper (used by the spine cover paths, which place the art themselves) must be
	// the SAME slide — one formula, so a spine background can't align differently from a sprite.
	const off = coverAnchorOffset({ ...base, anchorX: 0, anchorY: 0 });
	assert(
		close(off.dx, left.x - TALL.targetWidth / 2) && close(off.dy, left.y - TALL.targetHeight / 2),
		'coverAnchorOffset == coverTransform’s slide off the window centre',
	);
	const noOff = coverAnchorOffset(base);
	assert(close(noOff.dx, 0) && close(noOff.dy, 0), 'a centred anchor shifts nothing (parity)');
}

// ---- (c) the canonical readers resolve BASE values when no layout is named (parity) ----
{
	const node = {
		kind: 'sprite',
		fit: 'width',
		coverScale: 1.2,
		scale: { x: 1, y: 1.1 },
		anchor: { x: 0.25, y: 0.75 },
	};
	assert(backgroundFit(node) === 'width', 'base fit reads the node');
	assert(backgroundCoverScale(node) === 1.2, 'base cover scale reads the node');
	assert(backgroundCoverStretch(node).y === 1.1, 'base stretch reads the node scale');
	assert(
		backgroundCoverAnchor(node).x === 0.25 && backgroundCoverAnchor(node).y === 0.75,
		'base anchor reads the node',
	);
	const bare = { kind: 'sprite' };
	assert(backgroundFit(bare) === 'cover', 'no fit ⇒ cover');
	assert(backgroundCoverScale(bare) === 1, 'no cover scale ⇒ 1');
	assert(
		backgroundCoverAnchor(bare).x === 0.5 && backgroundCoverAnchor(bare).y === 0.5,
		'no anchor ⇒ centred (so every pre-anchor doc renders exactly as before)',
	);
}

// ---- (d) per-layoutType overrides win for THAT layout only ----
{
	const node = {
		kind: 'sprite',
		fit: 'width',
		coverScale: 1,
		scale: { x: 1, y: 1 },
		anchor: { x: 0.5, y: 0.5 },
		overrides: {
			portrait: {
				fit: 'height',
				coverScale: 1.3,
				scale: { x: 1, y: 1.15 },
				anchor: { x: 0.5, y: 1 },
			},
		},
	};
	assert(backgroundFit(node, 'portrait') === 'height', 'portrait overrides the fit');
	assert(backgroundCoverScale(node, 'portrait') === 1.3, 'portrait overrides the cover scale');
	assert(backgroundCoverStretch(node, 'portrait').y === 1.15, 'portrait overrides the stretch');
	assert(backgroundCoverAnchor(node, 'portrait').y === 1, 'portrait overrides the alignment');
	assert(backgroundFit(node, 'desktop') === 'width', 'an un-overridden layout keeps the base fit');
	assert(
		backgroundCoverScale(node, 'desktop') === 1 &&
			backgroundCoverStretch(node, 'desktop').y === 1 &&
			backgroundCoverAnchor(node, 'desktop').y === 0.5,
		'an un-overridden layout keeps every base cover value (parity)',
	);
	// And the resolved values really do produce two different covers.
	const desktop = coverTransform({
		...ART,
		...WIDE,
		fit: backgroundFit(node, 'desktop'),
		coverScale: backgroundCoverScale(node, 'desktop'),
		anchorY: backgroundCoverAnchor(node, 'desktop').y,
	});
	const portrait = coverTransform({
		...ART,
		...TALL,
		fit: backgroundFit(node, 'portrait'),
		coverScale: backgroundCoverScale(node, 'portrait'),
		anchorY: backgroundCoverAnchor(node, 'portrait').y,
	});
	assert(
		close(ART.artWidth * desktop.scaleX, WIDE.targetWidth) &&
			close(ART.artHeight * portrait.scaleY, TALL.targetHeight * 1.3),
		'desktop spans the window width while portrait spans (and zooms past) its height',
	);
	assert(
		close(portrait.y + (ART.artHeight * portrait.scaleY) / 2, TALL.targetHeight),
		'the portrait override also pins the art to the window BOTTOM (anchor.y = 1)',
	);
}

// ---- (e) a preview-art bind anchor: base fit lives on the preview, an override still wins ----
{
	const node = { kind: 'container', fit: 'contain', preview: { art: { fit: 'cover' } } };
	assert(backgroundFit(node) === 'cover', 'preview.art.fit is the BASE fit for a bind anchor');
	const overridden = { ...node, overrides: { portrait: { fit: 'height' } } };
	assert(
		backgroundFit(overridden, 'portrait') === 'height',
		'a per-layout override beats the preview-art fit too',
	);
	assert(
		backgroundFit(overridden, 'desktop') === 'cover',
		'…and only for the layout it was set on (parity)',
	);
}

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ per-axis cover fit + cover anchor + per-layout overrides verified.');
