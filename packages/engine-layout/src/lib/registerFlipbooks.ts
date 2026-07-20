/**
 * Invisible Flipbook clip registry — the render-time lookup that resolves an authored frame
 * animation for whatever references it by `clipId` (an FX emitter layer, a symbol cell, or a
 * `flipbook` scene node). Mirrors {@link registerEffects}: the game supplies the baked clips ONCE
 * at boot (from `bakedFlipbooks()`), and each consumer resolves `clipId` → clip here.
 *
 * The clip type is declared structurally rather than imported from `engine-flipbook`, matching how
 * `registerEffects` takes `EffectDoc` from `<EffectPlayer>`'s own props instead of adding a package
 * dependency just for a type. Keeps this package's dep graph unchanged.
 *
 * Module-scoped, exactly like `registerEffects` / `registerRigFx` — in a pnpm workspace each game
 * bundles its own copy of this package, so the top-level `Map` never leaks across games.
 */

/** One authored clip: an ordered run of region names within a single sheet. Mirrors
 * `engine-flipbook`'s `FlipbookClip` (kept structural — see the note above). */
export type FlipbookClipEntry = {
	id: string;
	name: string;
	assetKey: string;
	frames: string[];
	fps?: number;
	loop?: boolean;
};

const registry = new Map<string, FlipbookClipEntry>();

/** Register the project's baked clips (id → clip). Later calls override an id (parity with
 * `registerEffects`' latest-wins). Call once at boot with `bakedFlipbooks()`. */
export function registerFlipbooks(clips: FlipbookClipEntry[]): void {
	if (!Array.isArray(clips)) return;
	for (const clip of clips) {
		if (clip && typeof clip.id === 'string' && clip.id) registry.set(clip.id, clip);
	}
}

/** Resolve a `clipId` → its clip, or `undefined` when not registered (an un-baked project, or a
 * dangling id — the consumer then renders its static fallback, never crashing). */
export function resolveFlipbook(clipId: string): FlipbookClipEntry | undefined {
	return registry.get(clipId);
}

export function clearFlipbooks(): void {
	registry.clear();
}
