/**
 * Invisible Flipbook — `FlipbookDoc` normalization (design doc `invisible-flipbook.md`).
 *
 * The canonicalizer both the save endpoint and the loader run, mirroring `engine-fx`'s
 * `normalizeEffectDoc` and `engine-flow`'s `normalizeFlowDoc`. It strips anything outside the
 * schema so editor-only state can never leak into the shipped doc, and drops a malformed clip
 * rather than letting it poison the runtime.
 *
 * It is idempotent: re-normalizing a normalized doc yields an identical doc (the save→reload
 * fixed point the offline fixture asserts).
 *
 * What it deliberately does NOT do: validate that a frame name still exists in its sheet. A
 * canonicalizer runs at SAVE time, when the author may legitimately be mid-edit, and it has no
 * region set to check against anyway. Dangling frames are caught loudly at bake — the correct
 * ship-time gate — and surfaced in the tool at author time. Same division as `normalizeEffectDoc`,
 * which keeps an unbound layer rather than destroying work in progress.
 */

import { FLIPBOOK_DOC_VERSION, type FlipbookClip, type FlipbookDoc } from './types';

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

/** A usable frame rate: finite and > 0. A 0 or negative fps would divide by zero or run backwards
 * at the consumer, so it is dropped and the default applies. */
const fps = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/**
 * Canonicalize ONE clip, or `undefined` when it is unusable. Exported because storage is
 * per-clip (`<id>.clip.json`) while {@link normalizeFlipbookDoc} canonicalizes the assembled
 * collection — the save path needs the single-clip gate, the bake needs the collection.
 */
export const normalizeFlipbookClip = (raw: unknown): FlipbookClip | undefined => {
	if (!isObject(raw)) return undefined;
	const id = str(raw.id);
	const assetKey = str(raw.assetKey);
	// No id ⇒ nothing can reference it; no assetKey ⇒ no sheet to resolve frames against. Either
	// way the clip is unusable rather than merely incomplete, so it is dropped.
	if (!id || !assetKey) return undefined;

	// Empty strings are filtered but duplicates are KEPT: repeating a region is how an author holds
	// a frame, so de-duplicating here would silently retime the animation.
	const frames = Array.isArray(raw.frames)
		? raw.frames.filter((f): f is string => typeof f === 'string' && f.length > 0)
		: [];

	const clip: FlipbookClip = { id, name: str(raw.name) ?? id, assetKey, frames };
	const rate = fps(raw.fps);
	if (rate !== undefined) clip.fps = rate;
	const loop = bool(raw.loop);
	if (loop !== undefined) clip.loop = loop;
	return clip;
};

/**
 * Canonicalize an arbitrary value into a valid `FlipbookDoc`. An absent or garbage doc yields an
 * empty clip list — the parity-safe fall-through, matching `normalizeEffectDoc`.
 *
 * Clips are de-duplicated by id, LAST wins, matching `registerEffects`/`registerComponents`
 * latest-wins semantics so a doc and its registry never disagree about which clip an id names.
 */
export const normalizeFlipbookDoc = (raw: unknown): FlipbookDoc => {
	const obj = isObject(raw) ? raw : {};
	const list = Array.isArray(obj.clips)
		? obj.clips.map(normalizeFlipbookClip).filter((c): c is FlipbookClip => c !== undefined)
		: [];
	const byId = new Map<string, FlipbookClip>();
	for (const clip of list) byId.set(clip.id, clip);
	return { version: FLIPBOOK_DOC_VERSION, clips: [...byId.values()] };
};
