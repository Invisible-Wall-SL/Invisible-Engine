/**
 * Client-side Invisible Flipbook clip list for the editor family (Scene Editor + Component
 * Editor). Mirrors the `/api/editor/flipbooks` response shape.
 *
 * ONE module-scoped promise, so the four surfaces that need the same list — the Library section
 * that drags a clip in, the Properties picker that re-targets it, the 2D canvas that plays it, and
 * the page's dangling-reference warning — share a single request instead of each running its own
 * `onMount` fetch (which is what the Effects section and its Properties picker do today, and why
 * they can disagree after a re-author).
 *
 * EDITOR-SIDE preview data only: a node stores just `clipId` plus its own playback overrides;
 * frames and the clip's authored timing stay in the clip doc and reach the game through the
 * flipbook bake, never through the layout doc.
 */

import { applyClipBounds } from 'engine-flipbook';

/** One authored clip — the server's `FlipbookClip`, restated structurally so this client module
 * never imports a server module (the `editorRegions.client.ts` convention). */
export interface EditorClip {
	id: string;
	name: string;
	/** Manifest key of the clip's PRIMARY sheet — what a bare frame name resolves against. */
	assetKey: string;
	/** ORDERED frames: a bare region name, or an `<assetKey>::<region>` ref for a multi-sheet clip. */
	frames: string[];
	fps?: number;
	loop?: boolean;
	/** How the authored frames are WALKED (`engine-flipbook`'s `FlipbookDirection`). */
	direction?: ClipDirection;
	flipX?: boolean;
	flipY?: boolean;
	/** The clip's declared box (art pixels, top-left relative to the clip origin). */
	bounds?: { x: number; y: number; w: number; h: number };
}

/** Mirrors `engine-flipbook`'s `FlipbookDirection` — restated here for the same reason
 * {@link EditorClip} is: a client module never imports a server one. */
export type ClipDirection = 'forward' | 'reverse' | 'pingpong';

/** Playback default when a clip omits `fps` — mirrors `engine-flipbook`'s `DEFAULT_FLIPBOOK_FPS`. */
export const DEFAULT_CLIP_FPS = 24;

let pending: Promise<EditorClip[]> | null = null;

/**
 * Fetch (once per page load) the project's clips. A failed/forbidden request resolves to `[]` —
 * the Library then shows its empty hint rather than a broken section, matching how the Effects
 * section degrades.
 */
export function fetchClips(): Promise<EditorClip[]> {
	if (pending) return pending;
	pending = (async (): Promise<EditorClip[]> => {
		try {
			const res = await fetch('/api/editor/flipbooks');
			if (!res.ok) return [];
			const body = (await res.json()) as { clips?: EditorClip[] };
			return Array.isArray(body.clips) ? body.clips : [];
		} catch {
			return [];
		}
	})();
	return pending;
}

/** Drop the cache so the next `fetchClips` re-reads — paired with the editor's "Reload art", since
 * a clip authored in another tab is exactly as stale as a re-packed atlas. */
export function clearClipCache(): void {
	pending = null;
}

/**
 * One frame entry resolved to `(assetKey, region)`. A bare name scopes against the clip's primary
 * sheet; an `<assetKey>::<region>` entry names its own — which a multipacked clip genuinely needs,
 * because a real export interleaves one animation across several atlas pages.
 *
 * Mirrors `engine-flipbook`'s `parseFrameRef` (kept deliberately strict: the prefix must look like
 * a manifest path, so a region whose NAME merely contains `::` stays a bare name).
 */
export function clipFrameAt(clip: EditorClip, index: number): { assetKey: string; region: string } {
	const entry = clip.frames[index] ?? '';
	const at = entry.indexOf('::');
	if (at > 0) {
		const assetKey = entry.slice(0, at);
		const region = entry.slice(at + 2);
		if (region && assetKey.includes('/') && assetKey.endsWith('.json')) return { assetKey, region };
	}
	return { assetKey: clip.assetKey, region: entry };
}

/**
 * Which frame of `clip` is showing at wall-clock `nowMs`, for the editor's in-place playback.
 *
 * The editor preview LOOPS every clip, including a one-shot (`loop: false`). That is deliberate:
 * the canvas clock is the page's, not a per-node playhead, so honouring `loop` here would leave a
 * one-shot frozen on its last frame from the moment the author opened the document — they would
 * never see the animation they placed. The `loop` flag is authored in `/flipbook` and shown in the
 * Properties panel; the GAME honours it. Same trade the `/flipbook` tool's own scrub preview makes.
 */
export function clipFrameIndexAt(clip: EditorClip, nowMs: number, override?: ClipPlayback): number {
	const count = clip.frames.length;
	if (count <= 1) return 0;
	const rate = override?.fps ?? clip.fps;
	const fps = rate && rate > 0 ? rate : DEFAULT_CLIP_FPS;
	const step = Math.floor((nowMs / 1000) * fps);
	// The walk, not the authored list: a ping-pong of n frames has 2n−2 ticks per cycle, and the
	// tick lands on an AUTHORED index. Same rule as `engine-flipbook`'s `playbackIndices`, which is
	// what the game walks — so the canvas shows the frame the game would show at that moment.
	const direction = override?.direction ?? clip.direction;
	if (direction === 'reverse') return count - 1 - (((step % count) + count) % count);
	if (direction === 'pingpong' && count >= 3) {
		const cycle = 2 * count - 2;
		const at = ((step % cycle) + cycle) % cycle;
		return at < count ? at : cycle - at;
	}
	return ((step % count) + count) % count;
}

/** A placement's playback overrides (a `flipbook` node's own `fps` / `direction`), so the canvas
 * previews what THAT placement plays rather than the clip's authored defaults. */
export interface ClipPlayback {
	fps?: number;
	direction?: ClipDirection;
}

/**
 * A clip frame's geometry once the clip's declared BOX is applied — `null` for a clip with no
 * box, which then draws exactly as it always did.
 *
 * `region` supplies the frame's own packed geometry in the editor's terms (`origW`/`origH` the
 * declared size, `offX`/`offY` the art's offset inside it, `w`/`h` the art). The result is what
 * the 2D canvas needs: the box to size against, and where the art sits inside it.
 *
 * Runs through `engine-flipbook`'s `applyClipBounds` — the SAME function the runtime re-states
 * its textures with — so the canvas cannot drift from the game on where a boxed frame lands.
 */
export function clipFrameBox(
	clip: EditorClip,
	region: { w: number; h: number; origW?: number; origH?: number; offX?: number; offY?: number },
): { origW: number; origH: number; offX: number; offY: number } | null {
	const bounds = clip.bounds;
	if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return null;
	const box = applyClipBounds(
		{
			origW: region.origW ?? region.w,
			origH: region.origH ?? region.h,
			offX: region.offX ?? 0,
			offY: region.offY ?? 0,
			artW: region.w,
			artH: region.h,
		},
		bounds,
	);
	return { origW: box.origW, origH: box.origH, offX: box.offX, offY: box.offY };
}
