/**
 * Invisible Flipbook rig-timeline binding registry — the render-time lookup that resolves the CLIPS
 * a placed rig plays directly off its OWN animation events (`event.flipbook = { clipId, bone? }`
 * authored in the Rigger). The exact sibling of {@link registerRigFx}: the game supplies the baked
 * bindings ONCE at boot (from `bakedRigFlipbooks()`), and `LayoutNodeView` / `SymbolSpineMain`
 * resolve a rig's `assetKey` → its bindings here to mount a `<RiggedFlipbook>` per binding INSIDE
 * the rig's `<SpineProvider>`.
 *
 * WHY THIS EXISTS BESIDE THE FX ONE, rather than as a third `kind` on it. A binding's overrides are
 * the vocabulary of the thing it plays: an effect has emitters (`speed`, an emission `duration`), a
 * clip has frames (`fps`, `loop`, `direction`, mirroring). Folding both into one union would give
 * every author six fields that mean nothing for what they picked, and would put the two clamps in
 * one function where a widened bound silently widens the other. What IS shared — the placement half
 * (`slot`/`bone`), the burst half (`alpha`/`scale`/`delay`/`duration`/`continuous`), and the
 * folder-tolerant key reduction — is shared as code (`bundleFolderOf`), not as a merged type.
 *
 * Same manifest rationale as FX: spine-pixi discards the custom `event.flipbook` field at parse
 * time, so the binding cannot travel through the rebroadcast bus — it is baked from the rig
 * `.irig`/`.json` directly.
 *
 * Module-scoped, exactly like `registerEffects` / `registerRigFx` — in a pnpm workspace each game
 * bundles its own copy of this package, so the top-level `Map` never leaks across games.
 */

import type { FlipbookClipEntry, FlipbookPlaybackOverride } from './registerFlipbooks';
import { readRigBeat, type RigBeat } from './rigBeat';
import { bundleFolderOf } from './rigBundleKey';

/**
 * The per-binding OVERRIDES an author sets on the keyframe, beside the clip itself. Every one is
 * optional and every one is absent by default — a binding with none plays the clip exactly as
 * `/flipbook` authored it, which is what keeps every already-baked rig byte-identical.
 *
 * Two halves, and the split matters:
 *
 *  - **PLACEMENT + BURST** (`slot`, `alpha`, `scale`, `delay`, `duration`, `continuous`) — the same
 *    six an FX binding has, with the same meanings, because they are about the beat rather than
 *    about particles. An author who has bound an effect already knows them.
 *  - **PLAYBACK** ({@link FlipbookPlaybackOverride}: `fps`, `loop`, `direction`, `flipX`, `flipY`) —
 *    the SAME per-use override vocabulary a placed `flipbook` node and a `flipbook` symbol cell
 *    carry, folded through the SAME `foldFlipbookPlayback`. Deliberately not re-invented as a
 *    `speed` multiplier: an author setting `fps` here means the number they set in `/flipbook`,
 *    `/symbols` and the Scene Editor, and one clip walked two ways in two places must not need two
 *    mental models.
 */
export interface RigFlipbookOverrides extends FlipbookPlaybackOverride {
	/**
	 * Draw the clip at this SLOT's depth in the skeleton's draw order (spine-pixi `addSlotObject`),
	 * instead of on top of the whole rig. Absent ⇒ on top.
	 *
	 * Also becomes the clip's HOST when no `bone` is given — a slot is a bone plus a depth, so
	 * "draw it at the hand slot" reads as "at the hand". With a `bone` set, the bone still wins for
	 * position; the slot then only decides depth.
	 */
	slot?: string;
	/** Opacity multiplier, 0–1. */
	alpha?: number;
	/** Size multiplier on the whole clip. */
	scale?: number;
	/** Milliseconds to wait AFTER the beat before the clip starts. */
	delay?: number;
	/**
	 * Milliseconds on screen, then the clip is taken down.
	 *
	 * The flipbook reading of FX's `duration`, and NOT the same thing as `loop: false`: a one-shot
	 * clip already ends itself after one cycle, while this bounds a LOOPING one (or cuts a long
	 * one-shot short). Absent ⇒ the clip decides — which for a looping clip means it runs until the
	 * rig unmounts.
	 */
	duration?: number;
	/**
	 * Play ONCE and keep going, instead of restarting on every beat.
	 *
	 * The default binding is a one-shot per beat: each time the event crosses, the clip re-mounts
	 * and plays from frame 0. On a LOOPING rig animation that restarts it once per lap, which is
	 * right for an impact and wrong for anything ambient — a drifting cloud, a shimmer — where the
	 * reset is visible as a stutter. The FIRST fire then starts it and later fires are ignored.
	 *
	 * It stops when the RIG unmounts (or when `duration` bounds it), NOT when the animation changes,
	 * so an ambient animation keeps running across a state change rather than dying on it. Key it
	 * ONCE (on the animation that starts it): a binding is one keyframe, so the same clip keyed
	 * continuous in a second animation is a second, independent instance.
	 */
	continuous?: boolean;
}

/** One rig→clip binding: on a spine event named `event` — at the {@link RigBeat} it was keyed on —
 * (re)play `clipId` from frame 0, hosted on `bone` (or the rig origin when absent), with any
 * authored {@link RigFlipbookOverrides} applied. One binding per KEYFRAME, as for FX. */
export type RigFlipbookBinding = RigFlipbookOverrides &
	RigBeat & {
		event: string;
		clipId: string;
		bone?: string;
	};

/** The NUMERIC override keys, in the order the Rigger shows them. Exported as a VALUE so the bake,
 * the runtime and the live preview iterate ONE list instead of three hand-copied ones — the same
 * rule `RIG_FX_OVERRIDE_KEYS` exists for. */
export const RIG_FLIPBOOK_NUMERIC_KEYS = ['alpha', 'scale', 'delay', 'duration', 'fps'] as const;

/** Numeric override bounds. `null` upper bound = unbounded above (still finite + non-negative). */
const NUMERIC_BOUNDS: Record<string, { min: number; max: number | null }> = {
	alpha: { min: 0, max: 1 },
	scale: { min: 0, max: null },
	delay: { min: 0, max: null },
	duration: { min: 0, max: null },
	// A clip at 0 fps would never advance, so the floor is exclusive — see the read below.
	fps: { min: 0, max: null },
};

const isDirection = (v: unknown): v is FlipbookClipEntry['direction'] =>
	v === 'forward' || v === 'reverse' || v === 'pingpong';

/**
 * Read the overrides off a RAW `event.flipbook` object (or an already-baked binding) into a clean,
 * clamped set. Absent, malformed, non-finite and out-of-range values are DROPPED rather than
 * coerced, so a hand-edited rig can never push `alpha: -3` or `fps: NaN` into a sprite — the field
 * simply reverts to "not set", which is the behaviour that always worked.
 *
 * Shared by all three readers (the bake in `rigFlipbookExport`, `<RiggedFlipbook>` at runtime, and
 * the live preview overlay), because a value the bake accepts and the runtime rejects is a bug that
 * only shows up in the shipped game.
 *
 * `false` IS a value here and is carried. `loop`, `flipX` and `flipY` all default to something other
 * than "off" somewhere in the chain (a clip may be authored looping or mirrored), so a binding must
 * be able to say `loop: false` — dropping it, the way `continuous: false` is dropped, would make
 * "play it once" unauthorable. `continuous` is the one boolean whose default really is `false`, so
 * only its opt-IN is stored.
 */
export function readRigFlipbookOverrides(raw: unknown): RigFlipbookOverrides {
	const out: RigFlipbookOverrides = {};
	if (!raw || typeof raw !== 'object') return out;
	const src = raw as Record<string, unknown>;
	if (typeof src.slot === 'string' && src.slot) out.slot = src.slot;
	if (src.continuous === true) out.continuous = true;
	if (typeof src.loop === 'boolean') out.loop = src.loop;
	if (typeof src.flipX === 'boolean') out.flipX = src.flipX;
	if (typeof src.flipY === 'boolean') out.flipY = src.flipY;
	if (isDirection(src.direction)) out.direction = src.direction;
	for (const key of RIG_FLIPBOOK_NUMERIC_KEYS) {
		const bounds = NUMERIC_BOUNDS[key];
		const value = src[key];
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		if (value < bounds.min) continue;
		// A zero framerate is not a slow clip, it is a stopped one — and `<Flipbook>` reads
		// `fps ?? DEFAULT`, so a stored 0 would freeze the animation with no way to tell from the
		// doc that it was ever authored. Refuse it here rather than at each renderer.
		if (key === 'fps' && value <= 0) continue;
		if (bounds.max !== null && value > bounds.max) continue;
		(out as Record<string, number>)[key] = value;
	}
	return out;
}

const registry = new Map<string, RigFlipbookBinding[]>();

/**
 * Register the project's baked rig→clip bindings (rig assetKey → bindings). Later calls override a
 * key (parity with `registerEffects`' latest-wins). Call once at boot with `bakedRigFlipbooks()`.
 *
 * The overrides are clamped HERE, at the one choke point every consumer reads through, rather than
 * at each mount: `pixi-svelte` sits BELOW this package (`engine-layout` imports it, not the other
 * way), so `<RiggedFlipbook>` cannot share this module and would otherwise need its own copy of the
 * rules — the exact hand-mirrored-validation shape that has bitten this repo before.
 */
export function registerRigFlipbooks(map: Record<string, RigFlipbookBinding[]>): void {
	if (!map || typeof map !== 'object') return;
	for (const [rigKey, binds] of Object.entries(map)) {
		if (!rigKey || !Array.isArray(binds)) continue;
		const clean: RigFlipbookBinding[] = [];
		for (const b of binds) {
			if (!b || typeof b.event !== 'string' || !b.event) continue;
			if (typeof b.clipId !== 'string' || !b.clipId) continue;
			const bone = typeof b.bone === 'string' && b.bone ? b.bone : undefined;
			clean.push({
				event: b.event,
				clipId: b.clipId,
				...(bone ? { bone } : {}),
				...readRigBeat(b),
				...readRigFlipbookOverrides(b),
			});
		}
		registry.set(rigKey, clean);
	}
}

/**
 * Resolve a placed rig's `assetKey` → its bindings, or `[]` when none are registered (an un-baked
 * project, or a rig with no bound events — the render branch then mounts nothing). Never throws.
 *
 * Folder-tolerant through the shared `bundleFolderOf`, so a rig shipped through the Symbols State
 * Machine (whose `assetKey` is the full R2 bundle prefix) resolves the same way it does for FX.
 */
export function resolveRigFlipbooks(rigKey: string): RigFlipbookBinding[] {
	const exact = registry.get(rigKey);
	if (exact) return exact;
	const folder = bundleFolderOf(rigKey);
	return (folder !== rigKey ? registry.get(folder) : undefined) ?? [];
}

export function clearRigFlipbooks(): void {
	registry.clear();
}
