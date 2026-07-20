/**
 * Invisible Flipbook — resolve a clip's ORDERED frame names against the engine's flat
 * `loadedAssets` map (design doc `invisible-flipbook.md`, step 5).
 *
 * Pure and texture-type-agnostic (values are `unknown`) so it lives here rather than inside the
 * Svelte component: this package is dependency-free, so the scoped/bare key precedence and the
 * missing-frame contract are verifiable in an offline Node fixture instead of only in a browser
 * ([[feedback_validate_data_contracts_offline]]).
 */

import type { FlipbookClip } from './types';

/** A node `assetKey` that names an R2 atlas/sheet manifest (editor-art), vs a game-bundled key
 * like `symbolsStatic`. Mirrors `engine-layout`'s `isManifestAssetKey` — inlined so this package
 * stays dependency-free. */
const isManifestAssetKey = (k: string): boolean => k.includes('/') && k.endsWith('.json');

export interface ResolvedClipFrames {
	/** Textures for the frames that resolved, in AUTHORED ORDER. */
	textures: unknown[];
	/** Frame names that resolved to nothing, in authored order. */
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
 */
export function resolveClipFrames(
	clip: Pick<FlipbookClip, 'assetKey' | 'frames'>,
	loadedAssets: Record<string, unknown> | undefined,
): ResolvedClipFrames {
	const frames = clip.frames ?? [];
	if (frames.length === 0) return { textures: [], missing: [] };
	const loaded = loadedAssets ?? {};
	const scoped = isManifestAssetKey(clip.assetKey);
	const textures: unknown[] = [];
	const missing: string[] = [];
	for (const frame of frames) {
		const tex = (scoped ? loaded[`${clip.assetKey}::${frame}`] : undefined) ?? loaded[frame];
		if (tex !== undefined && tex !== null) textures.push(tex);
		else missing.push(frame);
	}
	return { textures, missing };
}
