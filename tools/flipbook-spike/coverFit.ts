/**
 * Invisible Flipbook — headless harness for a placed clip's COVER path
 * (`LayoutNodeView`'s `flipbookCoverRef` → `bgTexture` → `bg`, the seam that makes a clip on a
 * `background` screen fill the window):
 *
 *   pnpm --filter flipbook-spike run cover
 *
 * The bug this guards: the cover math was always right, but the GATE listed `sprite | spine` in
 * five separate places, so a `flipbook` node reached none of them and a background clip drew at
 * its authored size — in the editor AND in the game. Proves the three contracts that decide
 * whether a covering clip is right or subtly wrong:
 * (1) the sizing frame is the clip's FIRST one and it is looked up with the SAME scoped→bare
 *     precedence `resolveClipFrames` uses, so the cover measures the texture that actually plays
 *     (a wrong key measures nothing and the cover silently collapses to a bare zoom);
 * (2) a covering clip resolves the IDENTICAL transform a sprite of the same art resolves — the
 *     editor previews the sprite formula, so any divergence is an editor↔game mismatch;
 * (3) a clip whose sheet has not loaded yet does NOT crash or collapse — it falls back to the
 *     centred `coverScale × stretch`, then snaps to the true cover once the texture lands.
 */

import { resolveClipFrames } from 'engine-flipbook';
import {
	coverTransform,
	editorArtTextureKey,
	isCoverArtKind,
	isCoverFitKind,
	isManifestAssetKey,
	parseScopedFrameRef,
} from 'engine-layout';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

type Clip = { assetKey: string; frames: string[] };
type Tex = { width: number; height: number };

/** MIRROR of `LayoutNodeView`'s `flipbookCoverRef`. Keep in step with it. */
const coverRef = (clip: Clip): { key?: string; fallbackKey: string } | undefined => {
	const first = clip.frames?.[0];
	if (!first) return undefined;
	const parsed = parseScopedFrameRef(first);
	const sheet = parsed.assetKey ?? clip.assetKey;
	return {
		key: isManifestAssetKey(sheet) ? editorArtTextureKey(sheet, parsed.region) : undefined,
		fallbackKey: parsed.region,
	};
};

/** MIRROR of `LayoutNodeView`'s `bgTexture` → `bg` for a covering clip. */
const coverOf = (clip: Clip, assets: Record<string, unknown>, target: Tex) => {
	const ref = coverRef(clip);
	const tex = ((ref?.key ? assets[ref.key] : undefined) ??
		(ref?.fallbackKey ? assets[ref.fallbackKey] : undefined)) as Tex | undefined;
	return coverTransform({
		artWidth: tex && tex.width > 0 ? tex.width : 0,
		artHeight: tex && tex.height > 0 ? tex.height : 0,
		targetWidth: target.width,
		targetHeight: target.height,
	});
};

const SHEET = 'borut/test6/manifests/atlas_manifest_ocean.json';
const TARGET = { width: 1280, height: 900 };
const FRAME_0: Tex = { width: 2156, height: 1078 };
// Frame 1 is a DIFFERENT size on purpose — trims differ frame to frame.
const FRAME_1: Tex = { width: 1900, height: 1000 };

console.log('flipbook cover — the gate');
assert(isCoverFitKind({ kind: 'flipbook' }), 'a flipbook is cover-capable (background + coverFit)');
assert(isCoverArtKind({ kind: 'flipbook' }), 'a flipbook covers from a texture, like a sprite');

console.log('flipbook cover — the sizing frame');
const clip: Clip = { assetKey: SHEET, frames: ['f_0000', 'f_0001'] };
const assets: Record<string, unknown> = {
	[`${SHEET}::f_0000`]: FRAME_0,
	[`${SHEET}::f_0001`]: FRAME_1,
};
const cover = coverOf(clip, assets, TARGET);
const spriteCover = coverTransform({
	artWidth: FRAME_0.width,
	artHeight: FRAME_0.height,
	targetWidth: TARGET.width,
	targetHeight: TARGET.height,
});
assert(
	cover.scaleX === spriteCover.scaleX && cover.scaleY === spriteCover.scaleY,
	'the cover measures frame 0 — identical to a SPRITE of that same art (editor == game)',
);
const frame1Cover = coverTransform({
	artWidth: FRAME_1.width,
	artHeight: FRAME_1.height,
	targetWidth: TARGET.width,
	targetHeight: TARGET.height,
});
assert(
	cover.scaleX !== frame1Cover.scaleX,
	'it is frame 0, not any later frame — a per-frame cover would pulse the backdrop at fps',
);
assert(
	cover.scaleX >= TARGET.width / FRAME_0.width && cover.scaleY >= TARGET.height / FRAME_0.height,
	'the cover really fills the window on BOTH axes (no letterbox)',
);

console.log('flipbook cover — key precedence matches what actually plays');
// The clip's first frame names its OWN sheet (a cross-page clip): the cover must follow it there,
// not fall back to the clip's primary sheet, or it measures the wrong art.
const OTHER = 'borut/test6/manifests/atlas_manifest_sky.json';
const scopedClip: Clip = { assetKey: SHEET, frames: [`${OTHER}::f_0000`] };
const scopedAssets: Record<string, unknown> = {
	[`${SHEET}::f_0000`]: FRAME_1,
	[`${OTHER}::f_0000`]: FRAME_0,
};
const scopedRef = coverRef(scopedClip);
assert(
	scopedRef?.key === `${OTHER}::f_0000`,
	'a frame scoped to another sheet is measured on THAT sheet',
);
assert(
	(resolveClipFrames(scopedClip, scopedAssets).textures[0] as Tex) ===
		(scopedAssets[scopedRef!.key!] as Tex),
	'the measured texture IS the texture <Flipbook> plays (same precedence)',
);
// Legacy bare-name registration still resolves through the fallback key.
const bareRef = coverRef({ assetKey: SHEET, frames: ['f_0000'] });
assert(bareRef?.fallbackKey === 'f_0000', 'a bare fallback key is offered for legacy registration');

console.log('flipbook cover — before the sheet loads');
const pending = coverOf(clip, {}, TARGET);
assert(
	Number.isFinite(pending.scaleX) && pending.scaleX === 1 && pending.scaleY === 1,
	'an unloaded clip falls back to a centred coverScale × stretch (never NaN, never collapsed)',
);
assert(
	pending.x === TARGET.width / 2 && pending.y === TARGET.height / 2,
	'…still centred on the window, so it snaps into place when the texture lands',
);

console.log('flipbook cover — an EMPTY clip');
assert(
	coverRef({ assetKey: SHEET, frames: [] }) === undefined,
	'a frameless clip measures nothing',
);

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.log('\n✓ flipbook cover verified (frame 0, real key precedence, sprite-identical cover).');
