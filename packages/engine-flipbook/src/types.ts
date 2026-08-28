/**
 * Invisible Flipbook — the `FlipbookDoc` schema (design doc `invisible-flipbook.md`).
 *
 * A **clip** is a named, ORDERED, timed group of regions packed in one atlas sheet — the concept
 * that exists nowhere else in the pipeline. Every other surface treats a sheet as an unordered bag
 * of independently-named cells (TexturePacker's `frames` is a name→rect hash), and the only
 * frame-sequence path that ships today is locked inside an FX emitter, where the order is whatever
 * order the author happened to tick the checkboxes in and the timing is hardcoded.
 *
 * Clips live in their OWN doc, not in the sheet manifest, because three consumers want the same
 * clip and only one is FX: a `clipId` reference lets one authored animation serve an emitter, a
 * symbol state, and a scene element. Putting them in the manifest would drag ordering and timing
 * through `build_manifest`, `loadRegionSet`, and the Atlas Maker round-trip — none of which have
 * any reason to know about time.
 *
 * This package is deliberately dependency-FREE (no pixi, no engine imports) so it stays
 * Node-resolvable for offline fixtures — see [[gotcha_constants_shared_not_node_resolvable]],
 * where a VALUE import into an engine package broke every spike harness while all builds
 * stayed green.
 */

import type { FlipbookBounds } from './bounds';
import type { FlipbookDirection } from './playback';

export const FLIPBOOK_DOC_VERSION = 1;

/** Playback default when a clip omits `fps`. 24 is the animation convention and divides evenly
 * into 60Hz-ish frame budgets; an author who wants otherwise sets it explicitly. */
export const DEFAULT_FLIPBOOK_FPS = 24;

/**
 * One authored animation: an ordered run of region names within a single sheet.
 *
 * `frames` is the whole point — it is ORDERED, and that order is authored rather than inherited
 * from click sequence or atlas packing order. The join to the atlas is by region NAME, which is
 * what makes a clip survive re-packing (the packer's identity is the source filename; display
 * names never enter it) but NOT a rename (see the design doc's referential-integrity section).
 */
export interface FlipbookClip {
	/** Stable id — what every consumer stores as `clipId`. Never re-derive it from `name`. */
	id: string;
	/** Author-facing label. Free to change without breaking a reference. */
	name: string;
	/**
	 * Manifest key of the clip's PRIMARY sheet — the default a bare frame name resolves against,
	 * and what the picker starts on. Frames may override it individually (see {@link frames}).
	 */
	assetKey: string;
	/**
	 * Ordered frames. Duplicates are legal — holding a frame is a real animation technique.
	 *
	 * An entry is EITHER a bare region name (resolved against {@link assetKey}) OR an
	 * atlas-scoped ref `<assetKey>::<region>`, so ONE clip can span SEVERAL sheets. That is not
	 * a nicety: a real multipacked export routinely interleaves an animation across pages — a
	 * 49-frame sequence arrived split over four, frame 0 on page 0, frames 1-7 on page 1, frame
	 * 11 on page 3 — so a single-sheet clip simply cannot express it.
	 *
	 * The `<assetKey>::<region>` encoding is the SAME one the Scene Editor's image params use
	 * (`scopedFrameRef` / `parseScopedFrameRef` in `engine-layout`), and the same key the
	 * editor-art loader registers textures under — so a scoped frame needs no new resolution
	 * path, and a bare name still behaves exactly as before.
	 */
	frames: string[];
	/** Playback rate. Absent ⇒ {@link DEFAULT_FLIPBOOK_FPS}. */
	fps?: number;
	/** Absent ⇒ looping. A one-shot clip sets this false explicitly. */
	loop?: boolean;
	/**
	 * How the authored frames are WALKED — forward, reversed, or ping-ponged. Absent ⇒
	 * {@link DEFAULT_FLIPBOOK_DIRECTION} (`forward`), which is what every clip authored before
	 * this field existed did, so an untouched clip round-trips byte-identical.
	 *
	 * A walk over the one authored order, deliberately not a second clip: reversing or bouncing
	 * an animation is a presentation choice made per use, and copying 49 frame names to express
	 * it would fork the clip's referential integrity too (a renamed region would then have to be
	 * repaired in both). See `playback.ts`.
	 */
	direction?: FlipbookDirection;
	/**
	 * Mirror the drawn frames horizontally / vertically. Absent ⇒ not mirrored.
	 *
	 * A RENDER transform, not a frame transform: it flips the sprite about its own anchor, so it
	 * costs nothing per frame and needs no second set of art — the same reason `CinematicActor`
	 * mirrors a rig with `scaleX` instead of shipping a mirrored skeleton.
	 */
	flipX?: boolean;
	flipY?: boolean;
	/**
	 * The clip's declared BOX — the frame-animation twin of a rig's `skeleton.{x,y,width,height}`.
	 * Absent ⇒ every frame is sized by its own packed rect, exactly as before.
	 *
	 * Art pixels, top-left relative to the clip's origin (so a centred box is `x = -w/2`). One box
	 * for the whole clip, not one per frame, for the same reason a rig has one: it is what stops
	 * the animation changing scale between frames, and what lets an author size a clip by the part
	 * of it that reads rather than by the margin the packer left. See `bounds.ts`.
	 */
	bounds?: FlipbookBounds;
}

/** One doc per project, stored at `<client>/<project>/clips/<name>.json`. */
export interface FlipbookDoc {
	version: number;
	clips: FlipbookClip[];
}
