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
	/** How the authored frames are walked — `engine-flipbook`'s `FlipbookDirection`, restated as
	 * a union for the same structural reason as the rest of this type. */
	direction?: 'forward' | 'reverse' | 'pingpong';
	flipX?: boolean;
	flipY?: boolean;
	/** The clip's declared box — `engine-flipbook`'s `FlipbookBounds`. */
	bounds?: { x: number; y: number; w: number; h: number };
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

/** Playback default when a clip omits `fps`. Mirrors `engine-flipbook`'s `DEFAULT_FLIPBOOK_FPS` —
 * duplicated as a literal for the SAME reason `FlipbookClipEntry` is declared structurally above:
 * this package must not gain a dependency just for one constant. */
const DEFAULT_FPS = 24;

/**
 * How long ONE pass of a registered clip takes, in wall-clock ms — the flipbook analogue of a spine
 * animation's `duration`. `loopOverride` is a placement's own `loop` (absent ⇒ the clip's authored
 * value).
 *
 * `directionOverride` is a placement's own `direction` (absent ⇒ the clip's), and it MATTERS: a
 * ping-pong cycle is ~twice the authored frame count, so measuring the walk rather than the list
 * is the difference between a beat that waits for the animation and one that cuts it in half.
 *
 * Returns `undefined` for an unregistered id, an empty clip, AND — deliberately — an effectively
 * LOOPING one. A loop has no end, so reporting one cycle as its length would let a caller treat an
 * ambient background as "the screen's animation" and hold a flow beat on it forever-in-miniature.
 * Callers that genuinely want one cycle of a looping clip (a symbol state timing its own revert)
 * measure it themselves; a duration WALK must not.
 */
export function flipbookCycleMs(
	clipId: string,
	loopOverride?: boolean,
	directionOverride?: FlipbookClipEntry['direction'],
): number | undefined {
	const clip = registry.get(clipId);
	if (!clip || !Array.isArray(clip.frames) || clip.frames.length === 0) return undefined;
	if (loopOverride ?? clip.loop ?? true) return undefined;
	const fps = typeof clip.fps === 'number' && clip.fps > 0 ? clip.fps : DEFAULT_FPS;
	const direction = directionOverride ?? clip.direction;
	return (flipbookPlaybackFrameCount(clip.frames.length, direction) / fps) * 1000;
}

/**
 * Frames in ONE cycle once `direction` is applied — a ping-pong walks back through its interior
 * frames, so it is very nearly twice as long as the authored list.
 *
 * Duplicated from `engine-flipbook`'s `playbackFrameCount` for the SAME reason `DEFAULT_FPS` and
 * `FlipbookClipEntry` are: this package must not gain a dependency for one formula. It is two
 * lines, it is fixtured on both sides, and the alternative — a duration computed from
 * `frames.length` — reverts a ping-pong symbol state halfway through its own animation.
 *
 * EXPORTED because the games need it too and `engine-layout` is already their dependency:
 * `SymbolFlipbook` times a symbol state's revert off one cycle of its clip, so it must count the
 * same walked frames this does. Reaching for `engine-flipbook` there instead would add a package
 * dependency to every game just to re-derive these two lines.
 */
export function flipbookPlaybackFrameCount(
	count: number,
	direction?: FlipbookClipEntry['direction'],
): number {
	const n = Math.max(0, Math.floor(count));
	return direction === 'pingpong' && n >= 3 ? 2 * n - 2 : n;
}
