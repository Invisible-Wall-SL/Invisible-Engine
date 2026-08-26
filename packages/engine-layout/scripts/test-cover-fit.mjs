// Verify the per-node COVER-FIT opt-in (`node.coverFit`) resolves to the SAME cover transform in a
// flow-gated `canvas`-space scene as the identical art does in a `background`-space scene — and that
// an UN-flagged node keeps its normal (non-cover) transform.
//
//   node scripts/test-cover-fit.mjs
//
// Same esbuild-bundle trick as test-signal-gates.mjs: bundle the REAL cover module (`coverTransform`
// + the canonical `backgroundCoverScale`/`backgroundCoverStretch`/`backgroundFit` readers, no
// `.svelte`) into one ESM file Node can run. The `isCover` GATE + the sprite/spine cover-input
// construction below MIRROR the runtime `LayoutNodeView.svelte` (`isCanvasCoverFit` / `isCover` / the
// `bg` derived) exactly, so this is the offline proof that:
//  (a) a `coverFit` sprite/spine/flipbook in a `canvas` scene cover-fits identically to a
//      `background` node (same `coverTransform` output for identical art / target / cover params);
//  (b) `coverFit` unset ⇒ the node uses its authored transform, no cover (byte-identical parity);
//  (c) `background` space still covers regardless of the flag (unchanged);
//  (d) the flag is scoped to the cover-capable kinds (`rect`/`container`/`componentInstance` never
//      cover through it).
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
			backgroundCoverScale,
			backgroundCoverStretch,
			backgroundFit,
			isCoverArtKind,
			isCoverFitKind,
		} from '../src/lib/coverTransform.ts';`,
		resolveDir: HERE,
		loader: 'ts',
		sourcefile: 'test-cover-fit.entry.ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	write: false,
	logLevel: 'silent',
});

const tmp = join(tmpdir(), `cover-fit-test-${process.pid}.mjs`);
await writeFile(tmp, bundled.outputFiles[0].text, 'utf8');
let mod;
try {
	mod = await import(pathToFileURL(tmp).href);
} finally {
	await rm(tmp, { force: true });
}

const {
	coverTransform,
	backgroundCoverScale,
	backgroundCoverStretch,
	backgroundFit,
	isCoverArtKind,
	isCoverFitKind,
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

// ---- runtime mirror: the `isCover` gate from LayoutNodeView.svelte (`isCanvasCoverFit || isBackground`) ----
const isCover = (space, node) =>
	space === 'background' || (space === 'canvas' && node.coverFit === true && isCoverFitKind(node));

// ---- runtime mirror: resolve the on-screen transform of a sprite/spine node in a scene ----
// When `isCover`, the runtime replaces the authored transform with a centred true-cover (the `bg`
// derived for a sprite; the spine takes the same cover via `fit`/`bgSpineBox`, whose scale equals
// `coverTransform` — proven here at the shared-math level). Otherwise it uses x/y + scale verbatim.
const resolveTransform = (space, node, art, target) => {
	if (isCover(space, node)) {
		const stretch = backgroundCoverStretch(node);
		const cover = coverTransform({
			artWidth: art.width,
			artHeight: art.height,
			targetWidth: target.width,
			targetHeight: target.height,
			coverScale: backgroundCoverScale(node),
			stretchX: stretch.x,
			stretchY: stretch.y,
			fit: backgroundFit(node),
		});
		return { cover: true, x: cover.x, y: cover.y, scaleX: cover.scaleX, scaleY: cover.scaleY };
	}
	return {
		cover: false,
		x: node.x,
		y: node.y,
		scaleX: node.scale?.x ?? 1,
		scaleY: node.scale?.y ?? 1,
	};
};

const eq = (a, b) =>
	a.cover === b.cover &&
	a.x === b.x &&
	a.y === b.y &&
	a.scaleX === b.scaleX &&
	a.scaleY === b.scaleY;

// A non-square art on a differently-shaped target so cover math actually crops/zooms (not identity).
const ART = { width: 1920, height: 1080 };
const TARGET = { width: 1280, height: 900 };

// ---- (a) EQUIVALENCE: coverFit sprite in a canvas scene == the same node in a background scene ----
for (const kind of ['sprite', 'spine', 'flipbook']) {
	// Authored transform values that MUST be ignored once cover kicks in — a raw offset + a free
	// per-axis stretch (`scale`) + a cover zoom + a fit. If cover honoured x/y the two would differ.
	const node = { kind, x: 137, y: -42, scale: { x: 1, y: 1.2 }, coverScale: 1.1, fit: 'cover' };
	const canvasT = resolveTransform('canvas', { ...node, coverFit: true }, ART, TARGET);
	const bgT = resolveTransform('background', { ...node }, ART, TARGET);
	assert(canvasT.cover === true, `${kind}: a coverFit ${kind} in a canvas scene cover-fits`);
	assert(bgT.cover === true, `${kind}: a background ${kind} cover-fits`);
	assert(
		eq(canvasT, bgT),
		`${kind}: canvas coverFit resolves the IDENTICAL cover transform to background`,
	);
	// And the cover really is centred on the target (independent of the node's authored x/y).
	assert(
		canvasT.x === TARGET.width / 2 && canvasT.y === TARGET.height / 2,
		`${kind}: cover is centred on the canvas, ignoring the authored offset`,
	);
	// The free stretch + zoom rode through: scaleY carries the 1.2 stretch, scaleX does not.
	assert(
		canvasT.scaleY !== canvasT.scaleX,
		`${kind}: per-axis stretch (scale.y) survives the cover`,
	);
}

// ---- (b) PARITY: coverFit unset in a canvas scene ⇒ the authored transform, NO cover ----
const plain = { kind: 'sprite', x: 137, y: -42, scale: { x: 1, y: 1.2 }, coverScale: 1.1 };
const plainT = resolveTransform('canvas', plain, ART, TARGET);
assert(plainT.cover === false, 'coverFit UNSET ⇒ no cover in a canvas scene (parity)');
assert(
	plainT.x === 137 && plainT.y === -42 && plainT.scaleX === 1 && plainT.scaleY === 1.2,
	'unset ⇒ x/y + scale used verbatim (byte-identical to today)',
);

// ---- (c) background space is unchanged by the flag (still covers, flag or not) ----
const bgOn = resolveTransform('background', { ...plain, coverFit: true }, ART, TARGET);
const bgOff = resolveTransform('background', { ...plain }, ART, TARGET);
assert(
	bgOn.cover === true && bgOff.cover === true,
	'background covers whether or not coverFit is set',
);
assert(eq(bgOn, bgOff), 'the flag does not perturb a background node (parity)');

// ---- (d) SCOPE: the flag only covers sprite/spine — never rect / container / componentInstance ----
for (const kind of ['rect', 'container', 'componentInstance']) {
	const node = { kind, x: 5, y: 6, coverFit: true };
	const t = resolveTransform('canvas', node, ART, TARGET);
	assert(
		t.cover === false,
		`coverFit on a ${kind} in a canvas scene does NOT cover (out of scope)`,
	);
}

// ---- (d2) the SHARED kind predicates — the single list every cover gate reads ----
// These exist because the kind list used to be spelled out at each gate (runtime `isCanvasCoverFit`,
// `EditorCanvas.nodeTransform` + `isBackgroundCover`, `+page.svelte` `isBackgroundCoverSelected`,
// `EditorProperties.canCoverFit`): adding the `flipbook` kind updated none of them, so a placed clip
// on a background screen kept its authored size instead of filling the window. Assert the membership
// directly so a future kind can't be half-added again.
for (const kind of ['sprite', 'spine', 'flipbook']) {
	assert(isCoverFitKind({ kind }), `${kind} is a cover-fit kind (every gate reads this list)`);
}
for (const kind of ['rect', 'container', 'componentInstance', 'text', 'effect']) {
	assert(!isCoverFitKind({ kind }), `${kind} is NOT a cover-fit kind`);
}
// The texture-measured subset — a spine covers through its own `fit`, not `bgTexture`.
assert(isCoverArtKind({ kind: 'sprite' }), 'sprite covers from its texture (bg path)');
assert(isCoverArtKind({ kind: 'flipbook' }), 'flipbook covers from its first frame (bg path)');
assert(!isCoverArtKind({ kind: 'spine' }), 'spine does NOT take the texture cover path');

// ---- extra: fit:'contain' flows through identically too (not just 'cover') ----
{
	const node = { kind: 'sprite', x: 0, y: 0, coverScale: 1, fit: 'contain' };
	const canvasT = resolveTransform('canvas', { ...node, coverFit: true }, ART, TARGET);
	const bgT = resolveTransform('background', { ...node }, ART, TARGET);
	assert(eq(canvasT, bgT), "fit:'contain' also matches background exactly");
}

// ---- runtime mirror: the RESOLVED SPINE POSITION from LayoutNodeView.svelte's <SpineProvider> ----
// `<SpineProvider>` places the spine's art CENTRE at (x, y). The template resolves:
//   x = bg ? bg.x : spineCoverCenter ? spineCoverCenter.x : posX
// `bg` is SPRITE-only (undefined for a spine); `spineCoverCenter` is the canvas centre when the
// node is a `canvas` `coverFit` spine, else undefined; `posX` is `anchoredPosition` (= authored x/y
// with no screenAnchor). This is the exact logic that was buggy — a coverFit spine fell to the
// authored x/y and rendered off-centre. `canvas` = the window, so its centre IS the cover centre.
const CANVAS = { width: 1920, height: 1080 };
const resolveSpinePosition = (space, node, canvas) => {
	const spineCoverCenter =
		space === 'canvas' && node.coverFit === true && node.kind === 'spine'
			? { x: canvas.width / 2, y: canvas.height / 2 }
			: undefined; // background spines have none ⇒ fall to posX/posY (parity)
	// bg is sprite-only ⇒ always undefined for a spine.
	return spineCoverCenter ?? { x: node.x, y: node.y };
};

// (e) a coverFit spine authored OFF-CENTRE resolves to the CANVAS CENTRE (the bug's fix).
const offCenterSpine = { kind: 'spine', x: 711, y: 400, coverFit: true };
const spinePos = resolveSpinePosition('canvas', offCenterSpine, CANVAS);
assert(
	spinePos.x === 960 && spinePos.y === 540,
	'coverFit spine authored at (711,400) resolves to the canvas centre (960,540), NOT its authored x/y',
);
// It matches the CENTRE a sprite cover produces over the same canvas (coverTransform.x/y = centre).
const spriteCenter = coverTransform({
	artWidth: 800,
	artHeight: 600,
	targetWidth: CANVAS.width,
	targetHeight: CANVAS.height,
});
assert(
	spinePos.x === spriteCenter.x && spinePos.y === spriteCenter.y,
	'coverFit spine centre == the sprite cover centre (runtime == sprite path)',
);
// It matches what a background spine authored AT centre resolves to (editor↔runtime agreement).
const bgCenteredSpine = resolveSpinePosition(
	'background',
	{ kind: 'spine', x: 960, y: 540 },
	CANVAS,
);
assert(
	spinePos.x === bgCenteredSpine.x && spinePos.y === bgCenteredSpine.y,
	'coverFit spine centre == a background spine authored at centre',
);
// Parity: coverFit UNSET ⇒ the spine keeps its authored x/y verbatim (byte-identical to today).
const plainSpinePos = resolveSpinePosition('canvas', { kind: 'spine', x: 711, y: 400 }, CANVAS);
assert(
	plainSpinePos.x === 711 && plainSpinePos.y === 400,
	'coverFit UNSET ⇒ spine keeps its authored x/y (parity)',
);
// A background spine is UNCHANGED — still uses its authored position (not force-centred).
const bgOffSpine = resolveSpinePosition('background', { kind: 'spine', x: 711, y: 400 }, CANVAS);
assert(
	bgOffSpine.x === 711 && bgOffSpine.y === 400,
	'background spine still uses authored x/y (background path untouched)',
);

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ cover-fit opt-in verified (canvas coverFit == background; unset == parity).');
