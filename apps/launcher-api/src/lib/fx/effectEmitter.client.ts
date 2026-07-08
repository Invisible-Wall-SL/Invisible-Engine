/**
 * Shared Invisible FX emitter art helpers — the renderer-agnostic pieces the `/fx` tool's live stage
 * (`FxStage.svelte`) and the Scene Editor's live particle overlay (`EditorEffectLayer.svelte`) both
 * use to turn a layer's authored `art` (an atlas manifest key + frame names) into Pixi textures.
 *
 * The particle CONFIG → behaviors binding stays in the shared `engine-fx` `bindArt`; this module owns
 * the browser-side art loading (an authenticated `/api/editor/asset?key=…` page → a `TextureSource`)
 * and the per-frame slicing, so both stages resolve art identically and neither re-implements it.
 */
import { ImageSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { EmitterLayer } from 'engine-fx';

/** An atlas page + its per-frame rects — what a layer's `art.assetKey` resolves to. */
export interface ResolvedArt {
	pageUrl: string;
	pageWidth: number;
	pageHeight: number;
	regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
}

/** Resolve an `art.assetKey` (atlas manifest key) to its page URL + region rects. */
export type ResolveArt = (assetKey: string) => Promise<ResolvedArt | null>;

/**
 * Load an atlas page image into a Pixi `TextureSource`, robustly. We fetch the bytes ourselves
 * (same-origin, so the session cookie flows and an HTTP error is explicit) and decode via
 * `createImageBitmap`, rather than `Assets.load(url)`: Pixi's asset resolver picks a loader by the
 * URL's apparent extension, which the auth-gated `/api/editor/asset?key=…` streamer URL (a query
 * string, no clean extension) trips over — leaving the emitter textureless. Cached (by URL) in the
 * caller-supplied map so a page decodes once per stage.
 */
export async function loadPageSource(
	url: string,
	cache: Map<string, TextureSource>,
): Promise<TextureSource> {
	const cached = cache.get(url);
	if (cached) return cached;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`asset HTTP ${res.status}`);
	const blob = await res.blob();
	const bitmap = await createImageBitmap(blob);
	const source = new ImageSource({ resource: bitmap });
	cache.set(url, source);
	return source;
}

/** Slice an atlas page into the per-frame textures named by a layer's `art.frames`, in frame order. */
export async function framesToTextures(
	layer: EmitterLayer,
	resolveArt: ResolveArt,
	cache: Map<string, TextureSource>,
): Promise<Texture[]> {
	const { assetKey, frames } = layer.art;
	if (!assetKey || frames.length === 0) return [];
	const art = await resolveArt(assetKey);
	if (!art) return [];
	let source: TextureSource;
	try {
		source = await loadPageSource(art.pageUrl, cache);
	} catch (err) {
		console.warn('effectEmitter: page image load failed', art.pageUrl, err);
		return [];
	}
	const byName = new Map(art.regions.map((r) => [r.name, r]));
	const out: Texture[] = [];
	for (const name of frames) {
		const r = byName.get(name);
		if (!r) continue;
		out.push(new Texture({ source, frame: new Rectangle(r.x, r.y, r.w, r.h) }));
	}
	return out;
}
