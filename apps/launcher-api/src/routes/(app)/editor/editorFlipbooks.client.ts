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
 * EDITOR-SIDE preview data only: a node stores just `clipId`; frames, fps and loop stay in the
 * clip doc and reach the game through the flipbook bake, never through the layout doc.
 */

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
}

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
export function clipFrameIndexAt(clip: EditorClip, nowMs: number): number {
	const count = clip.frames.length;
	if (count <= 1) return 0;
	const fps = clip.fps && clip.fps > 0 ? clip.fps : DEFAULT_CLIP_FPS;
	const step = Math.floor((nowMs / 1000) * fps);
	return ((step % count) + count) % count;
}
