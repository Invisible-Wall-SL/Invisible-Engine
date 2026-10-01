import type { EffectDoc } from 'engine-fx';
import type { ResolvedArt } from '../fx/FxStage.svelte';

/**
 * The two reads an Invisible FX preview on `/symbols` needs — the effect's `EffectDoc` and its
 * art — shared by the Book-VFX / layer thumbnail (`SymbolFxPreview`) and the flight preview
 * (`FlightPreview`). The art seam is the editor's region + asset endpoints, the same one the `/fx`
 * page hands `FxStage`; the `symbols` tool is in their altTools, so both reads are in scope here.
 */

/** A `resolveArt` for `FxStage`, caching per preview instance (a remount re-reads the atlas). */
export function createFxArtResolver(): (assetKey: string) => Promise<ResolvedArt | null> {
	const artCache = new Map<string, Promise<ResolvedArt | null>>();
	return (assetKey) => {
		const hit = artCache.get(assetKey);
		if (hit) return hit;
		const p = (async (): Promise<ResolvedArt | null> => {
			const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(assetKey)}`);
			if (!res.ok) return null;
			const set = (await res.json()) as {
				pageKey: string;
				pageVersion?: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			const v = set.pageVersion ? `&v=${encodeURIComponent(set.pageVersion)}` : '';
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}${v}`,
				pageWidth: set.pageWidth,
				pageHeight: set.pageHeight,
				regions: set.regions,
			};
		})();
		artCache.set(assetKey, p);
		return p;
	};
}

/** The effect's doc, or null when it cannot be read. */
export async function fetchEffectDoc(effectId: string): Promise<EffectDoc | null> {
	try {
		const res = await fetch(`/api/editor/effect?id=${encodeURIComponent(effectId)}`);
		if (!res.ok) return null;
		return ((await res.json()) as { doc: EffectDoc }).doc;
	} catch {
		return null;
	}
}
