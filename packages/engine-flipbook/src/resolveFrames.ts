/**
 * Invisible Flipbook — resolve a clip's ORDERED frame names against the engine's flat
 * `loadedAssets` map (design doc `invisible-flipbook.md`, step 5).
 *
 * Pure and texture-type-agnostic (values are `unknown`) so it lives here rather than inside the
 * Svelte component: this package is dependency-free, so the scoped/bare key precedence and the
 * missing-frame contract are verifiable in an offline Node fixture instead of only in a browser
 * ([[feedback_validate_data_contracts_offline]]).
 */

import { playbackIndices } from './playback';
import type { FlipbookClip } from './types';

/** A node `assetKey` that names an R2 atlas/sheet manifest (editor-art), vs a game-bundled key
 * like `symbolsStatic`. Mirrors `engine-layout`'s `isManifestAssetKey` — inlined so this package
 * stays dependency-free. */
const isManifestAssetKey = (k: string): boolean => k.includes('/') && k.endsWith('.json');

/**
 * Split a frame entry into its sheet + region. A bare name returns no `assetKey`, so the caller
 * falls back to the clip's primary sheet — which is how a single-sheet clip keeps behaving
 * exactly as it did.
 *
 * Mirrors `engine-layout`'s `parseScopedFrameRef`, inlined so this package stays
 * dependency-free. Kept deliberately strict: the prefix must look like a manifest path, so a
 * region whose NAME merely contains `::` is read as a bare name rather than a broken sheet ref.
 */
export function parseFrameRef(value: string): { assetKey?: string; region: string } {
	if (typeof value !== 'string' || value === '') return { region: value ?? '' };
	const i = value.indexOf('::');
	if (i <= 0) return { region: value };
	const assetKey = value.slice(0, i);
	const region = value.slice(i + 2);
	if (!region || !isManifestAssetKey(assetKey)) return { region: value };
	return { assetKey, region };
}

/**
 * Every sheet a clip's frames actually reference — its primary `assetKey` plus any sheet a
 * scoped frame names. The exporter MUST walk this rather than `clip.assetKey` alone: a clip
 * spanning four pages would otherwise ship one page and silently lose three quarters of the
 * animation, which is exactly the dangling-frame failure the bake is meant to catch.
 */
export function clipSheetKeys(clip: Pick<FlipbookClip, 'assetKey' | 'frames'>): string[] {
	const keys = new Set<string>();
	if (clip.assetKey) keys.add(clip.assetKey);
	for (const frame of clip.frames ?? []) {
		const ref = parseFrameRef(frame);
		if (ref.assetKey) keys.add(ref.assetKey);
	}
	return [...keys];
}

/**
 * A clip's frames as `(sheet, region)` pairs with the primary-sheet fallback already applied —
 * what a dangling-reference check needs, since a bare name and a scoped name for the same
 * region must be validated against different sheets.
 */
export function clipFrameRefs(
	clip: Pick<FlipbookClip, 'assetKey' | 'frames'>,
): { assetKey: string; region: string; entry: string }[] {
	return (clip.frames ?? []).map((entry) => {
		const ref = parseFrameRef(entry);
		return { assetKey: ref.assetKey ?? clip.assetKey, region: ref.region, entry };
	});
}

export interface ResolvedClipFrames {
	/** Textures for the frames that resolved, in PLAYBACK ORDER (`clip.direction` applied). */
	textures: unknown[];
	/** Frame names that resolved to nothing, in AUTHORED order, once each per authored entry. */
	missing: string[];
}

/**
 * Resolve `clip.frames` to textures, preserving order.
 *
 * Key precedence mirrors `EffectLayer`: a clip's sheet ships through the editor-art export, so
 * its frames register scoped as `<assetKey>::<frame>` when `assetKey` is a manifest path, with a
 * bare-name fallback for games whose registration predates namespacing.
 *
 * A missing frame is DROPPED from `textures` and recorded in `missing` — the caller decides how
 * loudly to complain. There is deliberately no whole-sheet fallback: `ParticleEmitter` binds the
 * entire sheet when an FX layer resolves nothing, which turns a broken reference into arbitrary
 * wrong art. For an ordered animation that would play a scramble of unrelated frames, so
 * resolving nothing must render nothing.
 *
 * `clip.direction` is applied HERE, as a walk over the authored list (`playbackIndices`), because
 * the texture array IS the playback order for `AnimatedSprite` — there is no second clock to
 * teach. Resolution itself still runs ONCE per AUTHORED frame, so a ping-pong reuses the same
 * texture object twice rather than looking it up twice, and `missing` reports each broken entry
 * once no matter how many times the walk would have visited it (an inflated count would read as
 * more art being broken than is).
 */
export function resolveClipFrames(
	clip: Pick<FlipbookClip, 'assetKey' | 'frames' | 'direction'>,
	loadedAssets: Record<string, unknown> | undefined,
): ResolvedClipFrames {
	const frames = clip.frames ?? [];
	if (frames.length === 0) return { textures: [], missing: [] };
	const loaded = loadedAssets ?? {};
	const resolved: (unknown | undefined)[] = [];
	const missing: string[] = [];
	for (const frame of frames) {
		// A frame may name its OWN sheet (`<assetKey>::<region>`); a bare name falls back to the
		// clip's primary sheet. That fallback is what lets a single-sheet clip resolve unchanged.
		const ref = parseFrameRef(frame);
		const sheet = ref.assetKey ?? clip.assetKey;
		const scoped = isManifestAssetKey(sheet);
		const tex = (scoped ? loaded[`${sheet}::${ref.region}`] : undefined) ?? loaded[ref.region];
		if (tex !== undefined && tex !== null) resolved.push(tex);
		else {
			resolved.push(undefined);
			// Report the ENTRY as authored, not the parsed region — the author needs to know which
			// sheet's frame vanished, and a bare region name alone is ambiguous across sheets.
			missing.push(frame);
		}
	}
	const textures: unknown[] = [];
	for (const i of playbackIndices(frames.length, clip.direction)) {
		const tex = resolved[i];
		if (tex !== undefined) textures.push(tex);
	}
	return { textures, missing };
}
