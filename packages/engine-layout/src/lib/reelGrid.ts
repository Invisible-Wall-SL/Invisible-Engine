import { resolveTransform } from './resolveTransform';
import type { GameTemplate, LayoutDoc, LayoutType, ReelGridNode } from './types';

/**
 * Phase 2 of the "configurable grid primitive" (§8.7). Shared, game-agnostic
 * readers so each game bridges the editor doc's `reelGrid` node the same way —
 * LAYOUT ONLY (position + cell size + reel padding). `reels`/`rows` are
 * RGS/data-coupled and deliberately NOT surfaced here. When no node exists every
 * reader returns `undefined`, so the consuming game keeps its coded constants
 * (byte-identical parity).
 */

/** Resolved board-layout overrides read from a `reelGrid` node. */
export interface ReelGridLayout {
	x: number;
	y: number;
	cellSize: number;
	reelPadding: number;
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
	const scaleX = transform.scale?.x;
	const cellScale = Number.isFinite(scaleX) && (scaleX as number) > 0 ? (scaleX as number) : 1;
	return { x: transform.x, y: transform.y, cellSize: node.cellSize * cellScale, reelPadding };
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
 * Non-blocking editor validation: a `reelGrid` node whose `reels`/`rows` diverge
 * from the game's real board ({@link GameTemplate.board}) is flagged at save.
 * Phase 2 drives only LAYOUT (cell size / padding / position) into the live
 * board; reels/rows are RGS/data-coupled and stay descriptive, so a mismatch is
 * a warning (the editor preview would show a different grid than the game). No
 * template board or no node → no warning.
 */
export function reelGridWarnings(doc: LayoutDoc, template: GameTemplate): string[] {
	if (!template.board) return [];
	const node = findReelGridNode(doc);
	if (!node) return [];
	const reels = Math.max(1, Math.round(node.reels));
	const rows = Math.max(1, Math.round(node.rows));
	if (reels === template.board.reels && rows === template.board.rows) return [];
	return [
		`Reel grid is ${reels}×${rows} but the game's board is ${template.board.reels}×${template.board.rows}. ` +
			`Cell size, padding and position drive the live board; reels/rows are descriptive only.`,
	];
}
