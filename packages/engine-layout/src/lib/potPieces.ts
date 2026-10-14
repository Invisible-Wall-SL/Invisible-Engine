import type { LayoutNode } from './types';

/**
 * A POT BUILT FROM PIECES (`docs/guides/pot-from-pieces.md`): the pot's body is N placements of one
 * piece component (a firecracker), each lighting when the pot's fill share reaches its own
 * `lightAt` — the piece's state machine compares `meter.{meter}.share` against `{lightAt}`. The
 * pieces light bottom → top, the highest one (the coin head) at a full pot.
 */
export const POT_PIECE_LIGHT_PARAM = 'lightAt';

/** A piece placed somewhere under a container, with its y in that container's space. */
export interface PotPiece {
	node: LayoutNode & { kind: 'componentInstance' };
	y: number;
}

/**
 * Every component instance under `root` whose def is a piece (`isPiece`), its y summed through the
 * containers between (a group's rotation or scale is not followed — the order is what matters).
 */
export function potPieces(root: LayoutNode, isPiece: (componentId: string) => boolean): PotPiece[] {
	const out: PotPiece[] = [];
	const walk = (node: LayoutNode, offset: number): void => {
		if (node.kind === 'componentInstance') {
			if (isPiece(node.componentId)) out.push({ node, y: offset + node.y });
			return;
		}
		if (node.kind === 'container') for (const child of node.children) walk(child, offset + node.y);
	};
	if (root.kind === 'container') for (const child of root.children) walk(child, 0);
	return out;
}

/**
 * Each piece's light threshold, bottom → top: of N pieces the k-th lowest lights at k/N, so the
 * lowest lights at the first share step and the highest at a full pot. Pieces at the same height
 * share a threshold (they light together). Returned in the input order, rounded to 3 places.
 */
export function lightOrderThresholds(ys: readonly number[]): number[] {
	const levels = [...new Set(ys)].sort((a, b) => b - a);
	return ys.map((y) => Math.round(((levels.indexOf(y) + 1) / levels.length) * 1000) / 1000);
}
