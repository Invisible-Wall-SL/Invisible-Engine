/**
 * Bake a rig→FX-binding manifest for Invisible FX's "rig-timeline direct FX binding"
 * (`docs/design/invisible-fx.md`). The Rigger stores, on an animation event object,
 * `event.fx = { effectId, bone? }` inside the rig `.irig` (shipped verbatim as `<stem>.json`).
 * the runtime reader discards that custom field at parse time, so the binding cannot be read through the
 * runtime event stream — it must be read from the rig data directly and baked into a small manifest,
 * exactly like `bakedEffects()` / `registerEffects()`.
 *
 * This walks the project's rig bundles (from `skeletons.json`), reads each rig's SOURCE skeleton file
 * (JSON — the `event.fx` fields are intact there; they are NOT stripped, this is not parsed by
 * the runtime), collects `{ event, animation, time, effectId, bone? }` for every
 * `animations[*].events[*]` carrying an `fx.effectId` — one binding per KEYFRAME — grouped under
 * the rig's RUNTIME assetKey.
 *
 * CRUX — the manifest key. It MUST equal the string `LayoutNodeView` passes as
 * `<SpineProvider key={node.assetKey}>` for a placed rig, so `resolveRigFx(node.assetKey)` hits. For
 * an editor-placed spine node the game's doc has that `assetKey` rewritten from the full R2 bundle
 * prefix down to the plain bundle NAME (`resolveSpineKeysForGame` → `bundleFromAssetKey`), which is
 * exactly the `skeletons.json` `folder`. So the manifest is keyed by the `folder` — the same value
 * `editorArtExport.ts` sets `result.entry.key` to for an editor-art spine.
 *
 * Embedded in the baked bundle as `rigFx` (mirrors `effects`); `bake-editor-doc.mjs` triggers this
 * and the game registers it via `registerRigFx(bakedRigFx())`. Absent / no bound events ⇒ `rigFx`
 * stays undefined ⇒ `resolveRigFx()` returns `[]` and nothing new mounts (byte-identical parity).
 *
 * v1: sprite-particle effects only. A spine-particle effect bound ONLY via a rig still needs its
 * skeleton shipped (today skeletons auto-ship only when placed) — that is a deferred follow-up; this
 * bake makes no attempt to auto-ship the referenced effect's own assets (the effect docs + their
 * atlases already travel the FX / editor-art pipeline).
 */
import { readRigFxOverrides, type RigFxBinding, type RigFxOverrides } from 'engine-layout';

import { beatsOf, walkRigSkeletons, type RawRigSkeleton } from './rigSkeletons';

/**
 * The binding shape + the override clamp are IMPORTED from `engine-layout`, not restated here. They
 * used to be a hand-mirrored `interface` with a "mirrors the engine-layout RigFxBinding" comment —
 * which is exactly the shape that has silently dropped author data in this repo before (the copied
 * `ComponentParam.kind` allowlist). One definition, one clamp, three readers.
 */
export type { RigFxBinding };

/** `Record<rig assetKey (bundle folder), RigFxBinding[]>` — only rigs with ≥1 bound event appear. */
export type RigFxManifest = Record<string, RigFxBinding[]>;

/**
 * Collect the bindings from one rig's parsed skeleton JSON — ONE PER KEYFRAME.
 *
 * WHAT IDENTIFIES A BINDING: the beat `(animation, time)` plus `(event, effectId, bone, slot)`. The
 * manifest used to be keyed by the event NAME alone, so every binding sharing a name fired on every
 * keyframe of that name (a clip keyed at 0.01s and an effect keyed at 1s played together at 0.01s)
 * and the first key's overrides won for all of them. A spine event carries its keyframe `time`,
 * and the track entry its animation, so `<RiggedEffect>` can match the exact beat — which lets each
 * keyframe keep its OWN overrides too. The only thing still de-duped is a literal duplicate: two
 * keys at one time of one animation binding the same effect at the same place.
 */
export function bindingsFromSkeleton(data: RawRigSkeleton): RigFxBinding[] {
	const seen = new Set<string>();
	const out: RigFxBinding[] = [];
	for (const { animation, time, evt } of beatsOf(data)) {
		const fx = evt?.fx as { effectId?: unknown; bone?: unknown } | undefined;
		const event = evt?.name;
		const effectId = fx?.effectId;
		if (typeof event !== 'string' || !event) continue;
		if (typeof effectId !== 'string' || !effectId) continue;
		const bone = typeof fx?.bone === 'string' && fx.bone ? fx.bone : undefined;
		const overrides = readRigFxOverrides(fx);
		const dedupe = [animation, time, event, effectId, bone ?? '', overrides.slot ?? ''].join('\0');
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		out.push({ event, animation, time, effectId, ...(bone ? { bone } : {}), ...overrides });
	}
	return out;
}

/** One TIMED rig→effect binding — {@link RigFxBinding} plus the keyframe `time` (seconds) the event
 * fires at, which the name-keyed {@link RigFxManifest} drops. */
export interface TimedRigFxBinding extends RigFxOverrides {
	time: number;
	effectId: string;
	bone?: string;
}

/** Per-animation timed fx bindings, `Record<animName, TimedRigFxBinding[]>` (sorted by time). Only
 * animations with ≥1 fx-bound event appear. */
export type RigFxTimeline = Record<string, TimedRigFxBinding[]>;

/**
 * Collect timed fx bindings grouped by ANIMATION from one rig's parsed skeleton JSON — the same
 * beats {@link bindingsFromSkeleton} bakes, shaped for a playhead. Drives the `/api/editor/rig-fx`
 * endpoint the Symbols State-Machine live FX overlay reads: that overlay tracks each cell's playhead
 * and fires an effect when it crosses a keyframe `time` (mirroring the Rigger's `view.html`), so
 * the per-keyframe time — not just the event name — is what it needs.
 */
export function fxTimelineFromSkeleton(data: RawRigSkeleton): RigFxTimeline {
	const out: RigFxTimeline = {};
	for (const { animation, time, evt } of beatsOf(data)) {
		const fx = evt?.fx as { effectId?: unknown; bone?: unknown } | undefined;
		const effectId = fx?.effectId;
		if (typeof effectId !== 'string' || !effectId) continue;
		const bone = typeof fx?.bone === 'string' && fx.bone ? fx.bone : undefined;
		(out[animation] ??= []).push({
			time,
			effectId,
			...(bone ? { bone } : {}),
			...readRigFxOverrides(fx),
		});
	}
	for (const binds of Object.values(out)) binds.sort((a, b) => a.time - b.time);
	return out;
}

/**
 * Build the rig→FX-binding manifest for a project. Reads every rig in `skeletons.json`, parses its
 * source skeleton file, and keys the collected bindings by the rig's bundle `folder` (the runtime
 * assetKey). A rig whose skeleton can't be read/parsed, or that has no `fx`-bound events, contributes
 * nothing. Only JSON-format skeletons carry the field (a binary `.skel` never does).
 */
export async function exportRigFx(clientKey: string, projectKey: string): Promise<RigFxManifest> {
	const manifest: RigFxManifest = {};
	await walkRigSkeletons(clientKey, projectKey, (folder, data) => {
		const binds = bindingsFromSkeleton(data);
		if (binds.length > 0) manifest[folder] = binds;
	});
	return manifest;
}
