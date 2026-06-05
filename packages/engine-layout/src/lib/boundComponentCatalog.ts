import type { LayoutNode, LayoutType, Scene } from './types';

/**
 * Shared, game-agnostic catalog of how the editor treats well-known **coded**
 * components (the ones mounted via a `bind` anchor — Background, Win, free-spins,
 * …). It exists so a coded component is previewed + spaced THE SAME WAY in every
 * game and on every screen, instead of each game's seed hand-mapping each item.
 *
 * - `space`: the coordinate space a scene hosting this component should author in
 *   (these are full-screen/self-positioning coded overlays → `canvas`).
 * - `preview`: the editor-only stand-in art the editor draws in the anchor's
 *   place (the game always ignores `preview` and mounts the real component). The
 *   asset is referenced by a CONVENTION name (`bundle` for a spine, `region` for
 *   an atlas frame) that the editor resolves against the active project's assets,
 *   so it works across games WITHOUT a per-game asset list here.
 *
 * Precedence: an explicit `node.preview.art` on a placement always wins; this
 * catalog is the default when a node has none. A project whose assets don't
 * follow the convention either renames them or sets `preview.art` explicitly.
 *
 * The asset-naming convention this encodes (the home for documenting it is
 * `docs/conventions/`): the base background spine is `foregroundAnimation`, the
 * big-win spine `bigwin`, the transition spine `transition`, the free-spin intro/
 * outro spines `fsIntro`/`fsOutro`, and the free-spin counter panel frame the
 * atlas region `Frame_FSCounter.png`.
 */

export interface BoundComponentPreview {
	kind: 'spine' | 'sprite';
	/** Convention spine-bundle name (kind `spine`), resolved against project spines. */
	bundle?: string;
	/** Convention atlas-region name (kind `sprite`), resolved against the project manifest. */
	region?: string;
	/** How the editor fits the art to the scene frame. Absent = natural size. */
	fit?: 'cover' | 'contain';
}

export interface BoundComponentDefault {
	/** Coordinate space for a scene hosting (only) this component. */
	space?: Scene['space'];
	/** Editor-only preview art (see {@link BoundComponentPreview}). */
	preview?: BoundComponentPreview;
	/** Default render order when the component is dropped as an anchor. */
	zIndex?: number;
	/** layoutTypes the component is shown for (absent = all). */
	visibleFor?: LayoutType[];
}

/**
 * Default editor treatment per coded component name. Keyed by the SAME name a
 * game passes to `registerBoundComponents` and writes into `bind.component`.
 */
export const BOUND_COMPONENT_DEFAULTS: Record<string, BoundComponentDefault> = {
	Background: {
		space: 'canvas',
		zIndex: -10,
		preview: { kind: 'spine', bundle: 'foregroundAnimation', fit: 'cover' },
	},
	Win: {
		space: 'canvas',
		preview: { kind: 'spine', bundle: 'bigwin', fit: 'contain' },
	},
	Transition: {
		space: 'canvas',
		preview: { kind: 'spine', bundle: 'transition', fit: 'contain' },
	},
	FreeSpinCounter: {
		space: 'canvas',
		preview: { kind: 'sprite', region: 'Frame_FSCounter.png', fit: 'contain' },
	},
	FreeSpinIntro: {
		space: 'canvas',
		preview: { kind: 'spine', bundle: 'fsIntro', fit: 'contain' },
	},
	FreeSpinOutro: {
		space: 'canvas',
		preview: { kind: 'spine', bundle: 'fsOutro', fit: 'contain' },
	},
};

/** The default editor treatment for a coded component name, if known. */
export function boundComponentDefault(name: string): BoundComponentDefault | undefined {
	return BOUND_COMPONENT_DEFAULTS[name];
}

/**
 * The render-ready preview art shape both editor draw paths (the 2D canvas and the
 * spine WebGL overlay) already consume — i.e. what a node's `preview.art` is. The
 * resolver below produces this from the catalog so the two paths agree on ONE art.
 */
export interface ResolvedPreviewArt {
	kind: 'spine' | 'sprite';
	/** The asset key the draw path resolves: a spine bundle prefix, or the manifest
	 * key that contains the sprite `region`. Empty when a sprite region isn't located
	 * yet (the caller draws a placeholder until its region index fills in). */
	assetKey: string;
	region?: string;
	fit?: 'cover' | 'contain';
}

/**
 * Minimal view of a project's assets the resolver needs — kept structural so
 * `engine-layout` doesn't depend on launcher-api's asset types. `spines[].name`
 * is the bundle name (the last path segment of the bundle key); `spines[].key`
 * is the bundle prefix the editor's spine preview loads.
 */
export interface PreviewAssets {
	spines: { name: string; key: string }[];
}

/**
 * Resolve the editor stand-in art for a node, with this precedence:
 *  1. an explicit `node.preview.art` (a per-node override) always wins;
 *  2. else the catalog default for `node.bind.component`, resolved against the
 *     project's `assets`:
 *     - **spine**: the project spine whose bundle name === the catalog `bundle`;
 *       its key becomes the spine `assetKey`.
 *     - **sprite**: the catalog `region` resolved against `spriteRegionIndex`
 *       (region name → manifest key) — supplied by the caller, which scans the
 *       project manifests lazily. Until the region is located the art is returned
 *       with an empty `assetKey` so callers draw a placeholder (never crash).
 * Returns `undefined` when there's no override and no catalog default (or the
 * default's asset isn't in the project) → the caller falls back to a placeholder.
 */
export function resolveAnchorPreviewArt(
	node: LayoutNode,
	assets: PreviewAssets,
	spriteRegionIndex?: Map<string, string>,
): ResolvedPreviewArt | undefined {
	const override = node.preview?.art;
	if (override) return override;
	const component = node.bind?.component;
	if (!component) return undefined;
	const preview = boundComponentDefault(component)?.preview;
	if (!preview) return undefined;
	if (preview.kind === 'spine') {
		if (!preview.bundle) return undefined;
		const match = assets.spines.find((s) => s.name === preview.bundle);
		if (!match) return undefined;
		return { kind: 'spine', assetKey: match.key, fit: preview.fit };
	}
	// sprite
	if (!preview.region) return undefined;
	const assetKey = spriteRegionIndex?.get(preview.region) ?? '';
	return { kind: 'sprite', assetKey, region: preview.region, fit: preview.fit };
}
