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
	/** Fallback spine-bundle names (kind `spine`), tried in order when `bundle` isn't
	 * in the project. Encodes common reuse — e.g. a free-spin OUTRO that has no
	 * dedicated `fsOutro` spine and reuses the INTRO frame (`fsIntro`). */
	fallbackBundles?: string[];
	/** Convention atlas-region name (kind `sprite`), resolved against the project manifest. */
	region?: string;
}

/**
 * Where the editor draws a coded component's preview, so it lands on (≈) its
 * real in-game spot. The board-relative ones are resolved against the game's
 * board geometry — universal across games (formula, not magic numbers) — by
 * {@link computeOverlayPlacement}:
 * - `cover` — fill the canvas (full-bleed background).
 * - `centre` — fit-inside + centre on the scene (full-screen overlays: intro/
 *   outro/transition self-position centred, so this matches them).
 * - `boardCentre` — centred on the reel board (e.g. the win animation).
 * - `boardLeft` — to the LEFT of the board, top-aligned (the free-spin counter).
 * (Room to add `boardRight`/`boardTop`/… as games need them.)
 */
export type OverlayPlacement = 'cover' | 'centre' | 'boardCentre' | 'boardLeft';

export interface BoundComponentDefault {
	/** Coordinate space for a scene hosting (only) this component. */
	space?: Scene['space'];
	/** Editor-only preview art (see {@link BoundComponentPreview}). */
	preview?: BoundComponentPreview;
	/** Where the editor places the preview (see {@link OverlayPlacement}). */
	placement?: OverlayPlacement;
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
		placement: 'cover',
		preview: { kind: 'spine', bundle: 'foregroundAnimation' },
	},
	Win: {
		space: 'canvas',
		placement: 'boardCentre',
		preview: { kind: 'spine', bundle: 'bigwin' },
	},
	Transition: {
		space: 'canvas',
		placement: 'centre',
		preview: { kind: 'spine', bundle: 'transition' },
	},
	FreeSpinCounter: {
		space: 'canvas',
		placement: 'boardLeft',
		preview: { kind: 'sprite', region: 'Frame_FSCounter.png' },
	},
	FreeSpinIntro: {
		space: 'canvas',
		placement: 'centre',
		preview: { kind: 'spine', bundle: 'fsIntro' },
	},
	FreeSpinOutro: {
		space: 'canvas',
		placement: 'centre',
		// Most "book-of" games render the outro on the shared free-spin frame and ship
		// no dedicated `fsOutro` spine — fall back to the intro frame so it previews.
		preview: { kind: 'spine', bundle: 'fsOutro', fallbackBundles: ['fsIntro'] },
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
	/** Where to draw it — feed to {@link computeOverlayPlacement} with the geometry. */
	placement: OverlayPlacement;
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
	// 1. Explicit per-node override wins. Its simple `fit` maps to a placement
	//    (cover → cover, anything else → centred); a node needing a board-relative
	//    spot just leaves `art` off and lets the catalog default apply.
	const override = node.preview?.art;
	if (override) {
		return {
			kind: override.kind,
			assetKey: override.assetKey,
			region: override.region,
			placement: override.fit === 'cover' ? 'cover' : 'centre',
		};
	}
	const component = node.bind?.component;
	if (!component) return undefined;
	const def = boundComponentDefault(component);
	const preview = def?.preview;
	if (!preview) return undefined;
	const placement: OverlayPlacement = def?.placement ?? 'centre';
	if (preview.kind === 'spine') {
		const bundles = [preview.bundle, ...(preview.fallbackBundles ?? [])].filter(
			(b): b is string => !!b,
		);
		const match = bundles
			.map((name) => assets.spines.find((s) => s.name === name))
			.find((m) => m);
		if (!match) return undefined;
		return { kind: 'spine', assetKey: match.key, placement };
	}
	// sprite
	if (!preview.region) return undefined;
	const assetKey = spriteRegionIndex?.get(preview.region) ?? '';
	return { kind: 'sprite', assetKey, region: preview.region, placement };
}

/**
 * The board's geometry in the game's main-layout coords (centre + size), plus the
 * main box and the preview art's natural size — everything {@link
 * computeOverlayPlacement} needs. The editor reads the board from the project's
 * `boardFrame` node (every game's basegame has one), so this stays game-agnostic.
 */
export interface PlacementGeometry {
	main: { width: number; height: number };
	board?: { x: number; y: number; width: number; height: number };
	art?: { width: number; height: number };
}

/**
 * How the caller should draw the preview. `cover`/`contain` reuse the existing
 * fit paths; `positioned` gives an explicit MAIN-coord centre + anchor the editor
 * maps to screen (via the doc's `mainSizesMap`, like `<MainContainer>`).
 */
export type OverlayPlacementResult =
	| { mode: 'cover' }
	| { mode: 'contain' }
	| { mode: 'positioned'; x: number; y: number; anchor: { x: number; y: number } };

/**
 * Resolve an {@link OverlayPlacement} to concrete drawing instructions for the
 * editor, given the game's geometry. Board-relative placements fall back to
 * `contain` (centred) when no board is known. The formulas mirror the coded
 * components (Win = board centre; FreeSpinCounter = a panel to the left of the
 * board, top-aligned) but in terms of the board rect, so they hold for any game.
 */
export function computeOverlayPlacement(
	placement: OverlayPlacement,
	geom: PlacementGeometry,
): OverlayPlacementResult {
	if (placement === 'cover') return { mode: 'cover' };
	if (placement === 'centre') return { mode: 'contain' };
	const board = geom.board;
	if (!board) return { mode: 'contain' };
	if (placement === 'boardCentre') {
		return { mode: 'positioned', x: board.x, y: board.y, anchor: { x: 0.5, y: 0.5 } };
	}
	// boardLeft: the panel's RIGHT edge sits a small gap left of the board, its TOP
	// aligned to the board top — the free-spin counter's coded placement, expressed
	// over the board rect (gap ≈ the coded SYMBOL_SIZE*0.7 for a ~5-col board).
	const gap = board.width * 0.12;
	return {
		mode: 'positioned',
		x: board.x - board.width / 2 - gap,
		y: board.y - board.height / 2,
		anchor: { x: 1, y: 0 },
	};
}
