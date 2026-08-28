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

/**
 * A BINDING's per-use playback overrides of a clip's own values — what a placed `flipbook` node
 * and a `flipbook` symbol cell each carry, so one authored clip can serve several uses.
 *
 * A caller that owns one of these by another route LEAVES IT OUT of the object it passes. That is
 * the caller's call to state, not this type's to assume: a symbol cell resolves `loop` through
 * `<Flipbook>`'s own `props.loop ?? clip.loop ?? true` chain (which the Book expand/reveal riders
 * drive), while a placed node passes no `loop` prop at all and therefore folds it here.
 */
export interface FlipbookPlaybackOverride {
	fps?: number;
	loop?: boolean;
	direction?: FlipbookClipEntry['direction'];
	flipX?: boolean;
	flipY?: boolean;
}

/**
 * One clip with one binding's overrides folded in — the single definition of that precedence,
 * shared by the two consumers that have it (a placed node, a symbol state).
 *
 * It has to be a FOLD rather than props passed beside the clip, because `direction` decides the
 * texture ARRAY `<Flipbook>` hands `AnimatedSprite`: two answers in flight would mean the frames
 * walk one way while the duration is computed for another — which is exactly how a ping-ponged
 * state reverts at its own turnaround.
 *
 * `undefined` means inherit; `false` does NOT. A binding can un-mirror a clip that is authored
 * mirrored, and can un-loop one authored looping, which is why every field is read with `??` and
 * never with `||`.
 *
 * Returns the clip UNTOUCHED when nothing is overridden — the common case. Not an optimisation:
 * `<Flipbook>` derives its texture array from this object, so keeping the identity stable when
 * nothing changed keeps that derivation from re-running for no reason.
 *
 * Lives HERE, next to the `flipbookPlaybackFrameCount` duplication and for the same stated
 * reason: `engine-layout` must not gain a dependency on `engine-flipbook`, and every consumer
 * that needs this already depends on `engine-layout`.
 */
export function foldFlipbookPlayback<T extends FlipbookPlaybackOverride>(
	clip: T,
	override: FlipbookPlaybackOverride | undefined,
): T {
	if (
		!override ||
		(override.fps === undefined &&
			override.loop === undefined &&
			override.direction === undefined &&
			override.flipX === undefined &&
			override.flipY === undefined)
	) {
		return clip;
	}
	return {
		...clip,
		fps: override.fps ?? clip.fps,
		loop: override.loop ?? clip.loop,
		direction: override.direction ?? clip.direction,
		flipX: override.flipX ?? clip.flipX,
		flipY: override.flipY ?? clip.flipY,
	};
}
