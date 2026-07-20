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
	/** Manifest key of the source sheet. One sheet per clip in v1: a cross-sheet clip would need
	 * multi-atlas texture resolution at every consumer, which v1 does not earn. */
	assetKey: string;
	/** Ordered region names. Duplicates are legal — holding a frame is a real animation technique. */
	frames: string[];
	/** Playback rate. Absent ⇒ {@link DEFAULT_FLIPBOOK_FPS}. */
	fps?: number;
	/** Absent ⇒ looping. A one-shot clip sets this false explicitly. */
	loop?: boolean;
}

/** One doc per project, stored at `<client>/<project>/clips/<name>.json`. */
export interface FlipbookDoc {
	version: number;
	clips: FlipbookClip[];
}
