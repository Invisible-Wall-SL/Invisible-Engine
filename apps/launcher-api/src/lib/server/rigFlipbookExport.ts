/**
 * Bake a rig→CLIP-binding manifest — the Invisible Flipbook twin of `rigFxExport.ts`. The Rigger
 * stores, on an animation event object, `event.flipbook = { clipId, bone? }` inside the rig `.irig`
 * (shipped verbatim as `<stem>.json`). spine-pixi discards that custom field at parse time, so the
 * binding cannot be read through the runtime event stream — it must be read from the rig data
 * directly and baked into a small manifest, exactly like `rigFx`.
 *
 * SHIPS NO NEW ASSETS. A binding carries only a `clipId`; the clip itself travels through
 * `flipbookExport.ts` (which ships EVERY authored clip, un-pruned) and its frames are regions of an
 * atlas the editor-art export already ships. So this rides the `export-clips` trigger and adds
 * nothing to the deploy tree.
 *
 * It does mean the bake walks the project's rig skeletons TWICE — once for `rigFx` on the effects
 * trigger, once for `rigFlipbooks` here. That is deliberate: the two exports are reached by two
 * independent HTTP triggers, so the only way to share one walk would be to hang the flipbook
 * manifest off the FX endpoint, where nobody would look for it. The read is one JSON per rig,
 * streamed one at a time, so it costs time and not memory (see the launcher-OOM note in
 * `bake-editor-doc.mjs`).
 *
 * Embedded in the baked bundle as `rigFlipbooks` (mirrors `rigFx`); the game registers it via
 * `registerRigFlipbooks(bakedRigFlipbooks())`. Absent / no bound events ⇒ `rigFlipbooks` stays
 * undefined ⇒ `resolveRigFlipbooks()` returns `[]` and nothing new mounts (byte-identical parity).
 */
import { readRigFlipbookOverrides, type RigFlipbookBinding } from 'engine-layout';

import { beatsOf, walkRigSkeletons, type RawRigSkeleton } from './rigSkeletons';

/**
 * The binding shape + the override clamp are IMPORTED from `engine-layout`, not restated here —
 * the same one-definition rule `rigFxExport` states, for the same reason: a hand-mirrored copy is
 * how a repo silently drops author data.
 */
export type { RigFlipbookBinding };

/** `Record<rig assetKey (bundle folder), RigFlipbookBinding[]>` — only rigs with ≥1 bound event
 * appear. */
export type RigFlipbookManifest = Record<string, RigFlipbookBinding[]>;

/**
 * Collect the bindings from one rig's parsed skeleton JSON — ONE PER KEYFRAME.
 *
 * WHAT IDENTIFIES A BINDING: the beat `(animation, time)` plus `(event, clipId, bone, slot)` — the
 * identical rule `bindingsFromSkeleton` states for FX, for the identical reason: a name-keyed
 * manifest fired every binding of a name on every keyframe of that name, so a clip keyed at 0.01s
 * and an effect keyed at 1s played together. With the beat baked in, `<RiggedFlipbook>` fires on its
 * own key only and each keyframe keeps its own overrides. Only a literal duplicate is de-duped.
 */
export function flipbookBindingsFromSkeleton(data: RawRigSkeleton): RigFlipbookBinding[] {
	const seen = new Set<string>();
	const out: RigFlipbookBinding[] = [];
	for (const { animation, time, evt } of beatsOf(data)) {
		const fb = evt?.flipbook as { clipId?: unknown; bone?: unknown } | undefined;
		const event = evt?.name;
		const clipId = fb?.clipId;
		if (typeof event !== 'string' || !event) continue;
		if (typeof clipId !== 'string' || !clipId) continue;
		const bone = typeof fb?.bone === 'string' && fb.bone ? fb.bone : undefined;
		const overrides = readRigFlipbookOverrides(fb);
		const dedupe = [animation, time, event, clipId, bone ?? '', overrides.slot ?? ''].join('\0');
		if (seen.has(dedupe)) continue;
		seen.add(dedupe);
		out.push({ event, animation, time, clipId, ...(bone ? { bone } : {}), ...overrides });
	}
	return out;
}

/** One TIMED rig→clip binding — {@link RigFlipbookBinding} minus the event name, plus the keyframe
 * `time` (seconds) it fires at, which the name-keyed manifest drops. */
export type TimedRigFlipbookBinding = Omit<RigFlipbookBinding, 'event'> & { time: number };

/** Per-animation timed clip bindings, `Record<animName, TimedRigFlipbookBinding[]>` (sorted by
 * time). Only animations with ≥1 clip-bound event appear. */
export type RigFlipbookTimeline = Record<string, TimedRigFlipbookBinding[]>;

/**
 * Collect timed clip bindings grouped by ANIMATION — the same beats
 * {@link flipbookBindingsFromSkeleton} bakes, shaped for a playhead. Drives the
 * `/api/editor/rig-flipbooks` endpoint the Symbols State-Machine live overlay reads: that overlay
 * tracks each cell's playhead and starts a clip when it crosses a keyframe `time` (mirroring the
 * Rigger's `view.html`), so the per-keyframe time — not just the event name — is what it needs. NOT
 * de-duped: two keyframes of the same event at different times are two beats.
 */
export function flipbookTimelineFromSkeleton(data: RawRigSkeleton): RigFlipbookTimeline {
	const out: RigFlipbookTimeline = {};
	for (const { animation, time, evt } of beatsOf(data)) {
		const fb = evt?.flipbook as { clipId?: unknown; bone?: unknown } | undefined;
		const clipId = fb?.clipId;
		if (typeof clipId !== 'string' || !clipId) continue;
		const bone = typeof fb?.bone === 'string' && fb.bone ? fb.bone : undefined;
		(out[animation] ??= []).push({
			time,
			clipId,
			...(bone ? { bone } : {}),
			...readRigFlipbookOverrides(fb),
		});
	}
	for (const binds of Object.values(out)) binds.sort((a, b) => a.time - b.time);
	return out;
}

/**
 * Build the rig→clip-binding manifest for a project. Reads every rig in `skeletons.json`, parses its
 * source skeleton file, and keys the collected bindings by the rig's bundle `folder` (the runtime
 * assetKey). A rig whose skeleton can't be read/parsed, or that has no clip-bound events, contributes
 * nothing. Only JSON-format skeletons carry the field (a binary `.skel` never does).
 */
export async function exportRigFlipbooks(
	clientKey: string,
	projectKey: string,
): Promise<RigFlipbookManifest> {
	const manifest: RigFlipbookManifest = {};
	await walkRigSkeletons(clientKey, projectKey, (folder, data) => {
		const binds = flipbookBindingsFromSkeleton(data);
		if (binds.length > 0) manifest[folder] = binds;
	});
	return manifest;
}

/** Every `clipId` a rig binding references — the bake's dangling-reference check runs these against
 * the clips actually shipped (`exportClips().clips`). A rig pointing at a clip that was deleted in
 * `/flipbook` renders NOTHING at that beat, which reads as "the animation is broken" rather than as
 * a missing reference; the warning is the only place that distinction is visible. */
export function referencedClipIds(manifest: RigFlipbookManifest): string[] {
	const ids = new Set<string>();
	for (const binds of Object.values(manifest)) for (const b of binds) ids.add(b.clipId);
	return [...ids];
}
