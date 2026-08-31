/**
 * Invisible FX rig-timeline binding registry — the render-time lookup that resolves the effects a
 * placed rig plays directly off its OWN animation events (`event.fx = { effectId, bone? }` authored
 * in the Rigger). Mirrors {@link registerEffects}: the game supplies the baked bindings ONCE at boot
 * (from `bakedRigFx()`), and `LayoutNodeView` resolves a rig's `assetKey` → its bindings here to
 * mount a `<RiggedEffect>` per binding INSIDE the rig's `<SpineProvider>`.
 *
 * Why a manifest (not read from the event stream): spine-pixi discards the custom `event.fx` field
 * at parse time, so the binding cannot travel through the rebroadcast bus — it is baked from the rig
 * `.irig`/`.json` directly (see `invisible-fx.md` "rig-timeline direct FX binding").
 *
 * The map is keyed by the SAME string `LayoutNodeView` passes as `<SpineProvider key={node.assetKey}>`
 * for a placed rig — i.e. the plain bundle NAME (`bundleFromAssetKey` = the `skeletons.json` `folder`),
 * since `resolveSpineKeysForGame` rewrites an editor-placed spine node's `assetKey` down to that name.
 *
 * Module-scoped, exactly like `registerEffects` — in a pnpm workspace each game bundles its own copy
 * of this package, so the top-level `Map` never leaks across games.
 */

import { bundleFolderOf } from './rigBundleKey';

/**
 * The per-binding OVERRIDES an author sets on the keyframe, beside the effect itself. Every one is
 * optional and every one is absent by default — a binding with none behaves exactly as it did before
 * they existed, which is what keeps every already-baked rig byte-identical.
 *
 * They are overrides, not authoring: the `EffectDoc` in `/fx` stays the effect's definition, and
 * these adjust ONE use of it on ONE beat. Two rigs can fire the same effect dimmer/slower/deeper
 * without forking the doc.
 */
export type RigFxOverrides = {
	/**
	 * Draw the burst at this SLOT's depth in the skeleton's draw order (spine-pixi `addSlotObject`),
	 * instead of on top of the whole rig. Absent ⇒ on top, the original behaviour.
	 *
	 * Also becomes the burst's HOST when no `bone` is given — a slot is a bone plus a depth, and
	 * "draw it at the head slot" reads as "at the head", not "at the rig origin, drawn near the head".
	 * With a `bone` set, the bone still wins for position; the slot then only decides depth.
	 */
	slot?: string;
	/** Opacity multiplier, 0–1. */
	alpha?: number;
	/** Size multiplier on the whole burst. */
	scale?: number;
	/** Milliseconds to wait AFTER the beat before the burst starts. */
	delay?: number;
	/** Milliseconds of EMISSION, then stop. Particles already emitted still live out their own
	 * lifetime, so this shortens the burst without cutting it off mid-flight. Absent ⇒ the effect's
	 * own `emitterLifetime` decides, which for a continuous effect means it never stops on its own. */
	duration?: number;
	/** Time-scale multiplier on the emitters (2 = twice as fast). */
	speed?: number;
	/**
	 * Play ONCE and keep going, instead of restarting on every beat.
	 *
	 * The default binding is a one-shot per beat: each time the event crosses, the effect re-mounts
	 * and plays from t=0. On a LOOPING animation that means the burst is cut off and restarted every
	 * lap, which is right for a thump or an impact and wrong for anything ambient — drifting smoke,
	 * bubbles, a glow — where the reset is visible as a stutter.
	 *
	 * With this set, the FIRST fire starts the effect and later fires of the same event are ignored,
	 * so the emitter runs uninterrupted. It stops when the rig unmounts (or when `duration` bounds it),
	 * NOT when the animation changes — the binding is keyed by event name, not by clip, so an ambient
	 * effect keeps running across a state change rather than dying on it.
	 */
	continuous?: boolean;
};

/** One rig→effect binding: on a spine event named `event`, (re)play `effectId` from t=0, hosted on
 * `bone` (or the rig origin when absent), with any authored {@link RigFxOverrides} applied. */
export type RigFxBinding = RigFxOverrides & {
	event: string;
	effectId: string;
	bone?: string;
};

/** The override keys, in the order the Rigger shows them. Exported as a VALUE so the bake, the
 * runtime and the live preview iterate ONE list instead of three hand-copied ones — the same rule
 * `COMPONENT_PARAM_KINDS` exists for (a copied allowlist silently dropped author params twice). */
export const RIG_FX_OVERRIDE_KEYS = [
	'slot',
	'alpha',
	'scale',
	'delay',
	'duration',
	'speed',
] as const;

/** Numeric override bounds. `null` upper bound = unbounded above (still finite + non-negative). */
const NUMERIC_BOUNDS: Record<string, { min: number; max: number | null }> = {
	alpha: { min: 0, max: 1 },
	scale: { min: 0, max: null },
	delay: { min: 0, max: null },
	duration: { min: 0, max: null },
	speed: { min: 0, max: null },
};

/**
 * Read the overrides off a RAW `event.fx` object (or an already-baked binding) into a clean,
 * clamped set. Absent, malformed, non-finite and out-of-range values are DROPPED rather than
 * coerced, so a hand-edited rig can never push `alpha: -3` or `speed: NaN` into an emitter — the
 * field simply reverts to "not set", which is the behaviour that always worked.
 *
 * Shared by all three readers (the bake in `rigFxExport`, `<RiggedEffect>` at runtime, and the live
 * preview overlay), because a value the bake accepts and the runtime rejects is a bug that only
 * shows up in the shipped game.
 */
export function readRigFxOverrides(raw: unknown): RigFxOverrides {
	const out: RigFxOverrides = {};
	if (!raw || typeof raw !== 'object') return out;
	const src = raw as Record<string, unknown>;
	if (typeof src.slot === 'string' && src.slot) out.slot = src.slot;
	// Only TRUE is carried: `continuous: false` is the default, and writing it would bloat every
	// binding with a field that means nothing (same sparse rule as the rest of this object).
	if (src.continuous === true) out.continuous = true;
	for (const key of RIG_FX_OVERRIDE_KEYS) {
		const bounds = NUMERIC_BOUNDS[key];
		if (!bounds) continue; // `slot` is the one non-numeric key
		const value = src[key];
		if (typeof value !== 'number' || !Number.isFinite(value)) continue;
		if (value < bounds.min) continue;
		if (bounds.max !== null && value > bounds.max) continue;
		(out as Record<string, number>)[key] = value;
	}
	return out;
}

const registry = new Map<string, RigFxBinding[]>();

/**
 * Register the project's baked rig→FX bindings (rig assetKey → bindings). Later calls override a
 * key (parity with `registerEffects`' latest-wins). Call once at boot with `bakedRigFx()`.
 *
 * The overrides are clamped HERE, at the one choke point every consumer reads through, rather than
 * at each mount: `pixi-svelte` sits BELOW this package (`engine-layout` imports it, not the other
 * way), so `<RiggedEffect>` cannot share this module and would otherwise need its own copy of the
 * rules — the exact hand-mirrored-validation shape that has bitten this repo before. Clamping on the
 * way in means `resolveRigFx` only ever hands out values a renderer can use as-is.
 */
export function registerRigFx(map: Record<string, RigFxBinding[]>): void {
	if (!map || typeof map !== 'object') return;
	for (const [rigKey, binds] of Object.entries(map)) {
		if (!rigKey || !Array.isArray(binds)) continue;
		const clean: RigFxBinding[] = [];
		for (const b of binds) {
			if (!b || typeof b.event !== 'string' || !b.event) continue;
			if (typeof b.effectId !== 'string' || !b.effectId) continue;
			const bone = typeof b.bone === 'string' && b.bone ? b.bone : undefined;
			clean.push({
				event: b.event,
				effectId: b.effectId,
				...(bone ? { bone } : {}),
				...readRigFxOverrides(b),
			});
		}
		registry.set(rigKey, clean);
	}
}

/** Resolve a placed rig's `assetKey` → its bindings, or `[]` when none are registered (an un-baked
 * project, or a rig with no bound events — the render branch then mounts nothing). Never throws.
 *
 * Folder-tolerant: tries the exact key first (LayoutNodeView passes the bare folder — exact hit),
 * then retries with the key reduced to its bundle folder so a SYMBOL whose `assetKey` is the full
 * R2 bundle prefix still resolves. Mirrors `EffectLayer`'s `bundleFolderOf` fallback for
 * `skeletonParticle.skeletonKey`. */
export function resolveRigFx(rigKey: string): RigFxBinding[] {
	const exact = registry.get(rigKey);
	if (exact) return exact;
	const folder = bundleFolderOf(rigKey);
	return (folder !== rigKey ? registry.get(folder) : undefined) ?? [];
}

export function clearRigFx(): void {
	registry.clear();
}
