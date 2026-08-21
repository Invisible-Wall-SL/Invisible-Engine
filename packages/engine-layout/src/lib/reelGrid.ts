import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
import { resolveTransform } from './resolveTransform';
import type {
	AnticipationProfile,
	LayoutDoc,
	LayoutType,
	ReelGridNode,
	ReelGridPerspective,
	ReelSpinProfile,
} from './types';

/**
 * Phase 2 of the "configurable grid primitive" (§8.7). Shared, game-agnostic
 * readers so each game bridges the editor doc's `reelGrid` node the same way —
 * LAYOUT ONLY (position + cell size + inter-cell gaps + non-square cell size +
 * reel/row padding). `reels`/`rows` are RGS/data-coupled and deliberately NOT
 * surfaced here. When no node exists every
 * reader returns `undefined`, so the consuming game keeps its coded constants
 * (byte-identical parity).
 */

/** Resolved board-layout overrides read from a `reelGrid` node. */
export interface ReelGridLayout {
	x: number;
	y: number;
	/** Square cell pitch (the uniform board-zoom base) — folds the transform scale. */
	cellSize: number;
	/** Per-axis cell size in px (non-square). Defaults to {@link cellSize}. Folds scale. */
	cellWidth: number;
	cellHeight: number;
	/** Inter-cell spacing in px (column pitch = `cellWidth + gapX`, etc.). Folds scale. */
	gapX: number;
	gapY: number;
	/**
	 * Reel/row LEAD — first column/row centre seat, in cell-size fractions (the
	 * `getSymbolX/Y` lead term). Default 0.5 each = symmetric. Seats the cluster only.
	 */
	reelPadding: number;
	rowPadding: number;
	/** Per-cell art seat alignment (0..1 each axis). Default 0.5 = centred. */
	symbolAlignX: number;
	symbolAlignY: number;
	/**
	 * Whole-board fine px offset, added to the node position. In the node's transform
	 * units (NOT folded through the cell scale — it lives in layout space). Default 0.
	 */
	boardNudgeX: number;
	boardNudgeY: number;
}

/** Scan every scene's top-level nodes for the first `reelGrid` node. */
export function findReelGridNode(doc: LayoutDoc): ReelGridNode | undefined {
	for (const scene of doc.scenes) {
		for (const node of scene.nodes) {
			if (node.kind === 'reelGrid') return node;
		}
	}
	return undefined;
}

/**
 * Resolve a `reelGrid` node's layout for `layoutType` (position + size via
 * `resolveTransform`, so per-layoutType overrides apply). Defensive: a missing
 * or malformed node (non-finite `cellSize`) yields `undefined` so the game falls
 * back to its constants.
 *
 * The editor's drag-resize writes the node's transform `scale` (like every other
 * node — the resize handles scale the footprint), NOT `cellSize`. The board scale
 * is uniform, so fold that (uniform) transform scale INTO the effective cell size
 * — "what you size in the editor is what the game shows". `scale {1,1}` (no
 * resize) leaves `cellSize` untouched = byte-parity. A non-uniform scale isn't
 * representable on a uniform board, so the horizontal axis (`scale.x`) wins.
 */
export function resolveReelGridFromNode(
	node: ReelGridNode | undefined,
	layoutType: LayoutType,
): ReelGridLayout | undefined {
	if (!node || !Number.isFinite(node.cellSize) || node.cellSize <= 0) return undefined;
	const transform = resolveTransform(node, layoutType);
	const reelPadding = Number.isFinite(node.reelPadding) ? (node.reelPadding as number) : 0.5;
	const rowPadding = Number.isFinite(node.rowPadding) ? (node.rowPadding as number) : 0.5;
	const symbolAlignX = Number.isFinite(node.symbolAlignX) ? (node.symbolAlignX as number) : 0.5;
	const symbolAlignY = Number.isFinite(node.symbolAlignY) ? (node.symbolAlignY as number) : 0.5;
	const boardNudgeX = Number.isFinite(node.boardNudgeX) ? (node.boardNudgeX as number) : 0;
	const boardNudgeY = Number.isFinite(node.boardNudgeY) ? (node.boardNudgeY as number) : 0;
	const scaleX = transform.scale?.x;
	const cellScale = Number.isFinite(scaleX) && (scaleX as number) > 0 ? (scaleX as number) : 1;
	// Non-square cell size + inter-cell gaps fold the same (uniform) scale as cellSize,
	// so an editor resize zooms them coherently. Absent fields ⇒ square/flush (parity).
	const cw = node.cellWidth && node.cellWidth > 0 ? node.cellWidth : node.cellSize;
	const ch = node.cellHeight && node.cellHeight > 0 ? node.cellHeight : node.cellSize;
	const gapX = Number.isFinite(node.gapX) ? (node.gapX as number) : 0;
	const gapY = Number.isFinite(node.gapY) ? (node.gapY as number) : 0;
	return {
		x: transform.x,
		y: transform.y,
		cellSize: node.cellSize * cellScale,
		cellWidth: cw * cellScale,
		cellHeight: ch * cellScale,
		gapX: gapX * cellScale,
		gapY: gapY * cellScale,
		reelPadding,
		rowPadding,
		symbolAlignX,
		symbolAlignY,
		boardNudgeX,
		boardNudgeY,
	};
}

/** Find + resolve in one step from a whole doc. */
export function resolveReelGridLayout(
	doc: LayoutDoc | undefined,
	layoutType: LayoutType,
): ReelGridLayout | undefined {
	if (!doc) return undefined;
	return resolveReelGridFromNode(findReelGridNode(doc), layoutType);
}

/**
 * Resolve a `reelGrid` node's spin-FEEL override for one profile (`normal` =
 * default/anticipated, `fast` = turbo). Returns only the FINITE numeric fields
 * the author set, so the game can `{ ...codedOptions, ...override }`. No node /
 * no `spin` / empty profile ⇒ `undefined`, so the game keeps its coded
 * `SPIN_OPTIONS_*` unchanged (parity).
 */
export function resolveReelSpinProfile(
	node: ReelGridNode | undefined,
	which: 'normal' | 'fast',
): ReelSpinProfile | undefined {
	const profile = node?.spin?.[which];
	if (!profile) return undefined;
	const out: ReelSpinProfile = {};
	for (const [key, value] of Object.entries(profile)) {
		if (Number.isFinite(value)) out[key as keyof ReelSpinProfile] = value as number;
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * Read the authored free-spin anticipation overlay overrides off a `reelGrid`
 * node. Returns only the fields the author actually set (non-empty strings /
 * finite numbers), so the game can `{ ...codedConfig, ...override }`. No node /
 * no `anticipation` / empty ⇒ `undefined`, so the game keeps its coded
 * `ANTICIPATION` config unchanged (parity).
 */
export function resolveAnticipationProfile(
	node: ReelGridNode | undefined,
): AnticipationProfile | undefined {
	const p = node?.anticipation;
	if (!p) return undefined;
	const out: AnticipationProfile = {};
	const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
	const num = (v: unknown): v is number => Number.isFinite(v);
	if (str(p.spineKey)) out.spineKey = p.spineKey;
	if (num(p.widthRatio)) out.widthRatio = p.widthRatio;
	if (num(p.heightRatio)) out.heightRatio = p.heightRatio;
	if (num(p.yOffsetRatio)) out.yOffsetRatio = p.yOffsetRatio;
	if (str(p.introAnimation)) out.introAnimation = p.introAnimation;
	if (str(p.loopAnimation)) out.loopAnimation = p.loopAnimation;
	if (str(p.outAnimation)) out.outAnimation = p.outAnimation;
	if (str(p.sound)) out.sound = p.sound;
	return Object.keys(out).length ? out : undefined;
}

/**
 * Read the authored PERSPECTIVE block off a `reelGrid` node
 * (`docs/design/perspective-board-mode.md`). Same defensive shape as the two resolvers above: only
 * the fields the author actually set, and only when they are readable, so an unreadable value
 * leaves the board exactly as it is today rather than being clamped into something the author never
 * asked for. No node / no `perspective` / nothing usable in it ⇒ `undefined`.
 *
 * `farScale` is range-checked because it is the geometry's ON switch and a `<= 0` would collapse
 * the back row to a point or mirror it. A `1` is deliberately KEPT (it is a legal authored value that
 * happens to mean flat, and the editor should read back what the author typed) — the flat decision
 * is made once, by the engine's seat function, not smuggled in here.
 *
 * SHAPE ONLY — the board's behaviour (roll vs swap, the swap style, the per-column stagger) is
 * resolved from the game config's `reelBehaviour` block instead, because it is one fact about the
 * game rather than about one ratio's layout.
 */
export function resolveReelGridPerspective(
	node: ReelGridNode | undefined,
): ReelGridPerspective | undefined {
	const p = node?.perspective;
	if (!p) return undefined;
	const out: ReelGridPerspective = {};
	const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
	if (num(p.farScale) && p.farScale > 0) out.farScale = p.farScale;
	if (num(p.vanishX)) out.vanishX = p.vanishX;
	return Object.keys(out).length ? out : undefined;
}

/**
 * The two `loadedAssets` keys a ground TILE resolves to: the ATLAS-SCOPED editor-art key
 * (`<assetKey>::<frame>`) and the bare frame name to fall back to. Exactly the pair
 * `LayoutNodeView` hands a sprite node's `<Sprite key= fallbackKey=>`, because a tile IS an
 * ordinary sprite frame — anything else would be a second lookup policy to keep in step with the
 * first.
 */
export interface ReelGridTileArt {
	/** Scoped key first, so a frame name packed by two atlases resolves to the one the author picked. */
	key: string;
	/** The bare frame name — parity for game-bundled sheets and for any registration predating the
	 *  editor-art namespacing. Absent when the ref carries no scopeable atlas to begin with. */
	fallbackKey?: string;
}

/**
 * Read the authored GROUND TILE art off a `reelGrid` node and resolve it to texture keys
 * (`docs/design/perspective-board-mode.md` §"The tiles"). Same defensive shape as the resolvers
 * above: `undefined` unless there is something actually drawable, so a board with no tile art
 * mounts no tile layer at all rather than a layer of empty textures.
 *
 * The split goes through `parseScopedFrameRef` rather than a hand-rolled `::` search: that function
 * already knows the three prefix shapes apart (a real manifest key, an un-scopeable atlas ref that
 * degrades to the bare frame, and a frame name that merely CONTAINS `::`), and a second parser is a
 * second thing to get wrong. The resolution below then mirrors `LayoutNodeView`'s `spriteRef`
 * step for step, so a tile and a sprite bound to the same frame can never resolve differently.
 */
export function resolveReelGridTileArt(
	node: ReelGridNode | undefined,
): ReelGridTileArt | undefined {
	const raw = node?.tileRegion;
	if (typeof raw !== 'string' || raw === '') return undefined;
	const { assetKey, region } = parseScopedFrameRef(raw);
	if (!region) return undefined;
	if (isManifestAssetKey(assetKey)) {
		return { key: editorArtTextureKey(assetKey, region), fallbackKey: region };
	}
	// No scopeable atlas in the ref — a legacy bare frame name, or a game-bundled sheet's frame.
	// The bare key is what the flat texture map holds, so it IS the lookup (atlas-blind, exactly as
	// a bare sprite region is today).
	return { key: region };
}

/** The board's grid COUNT — `{ reels, rows }`. The one dimension both the game and the editor now
 *  size off: Invisible Game Config's `numReels` / `max(numRows)`. */
export interface GridDimensions {
	reels: number;
	rows: number;
}

/**
 * Non-blocking editor validation: a `reelGrid` node whose `reels`/`rows` diverge from the
 * AUTHORED game config (Invisible Game Config's `numReels`/`numRows`) is flagged at save.
 *
 * The board count is driven by the config now — both the game and the editor preview size off it,
 * so the node's `reels`/`rows` are descriptive (the node still owns LAYOUT: cell size, gaps,
 * position). A mismatch means the author left stale numbers on the node; the config wins either
 * way, so it is a warning, not an error. No grid or no node → no warning.
 */
export function reelGridWarnings(doc: LayoutDoc, grid: GridDimensions | undefined): string[] {
	if (!grid) return [];
	const node = findReelGridNode(doc);
	if (!node) return [];
	const reels = Math.max(1, Math.round(node.reels));
	const rows = Math.max(1, Math.round(node.rows));
	if (reels === grid.reels && rows === grid.rows) return [];
	return [
		`Reel grid node is ${reels}×${rows} but the game config is ${grid.reels}×${grid.rows}. ` +
			`The config drives the board size (cell size, padding and position still come from the node); ` +
			`update the node's reels/rows to match, or leave it — the config wins.`,
	];
}
