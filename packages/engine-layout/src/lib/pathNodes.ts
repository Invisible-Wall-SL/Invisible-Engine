/**
 * The `path` node's fields, read defensively (`docs/design/game-families.md` §4.3, P10.11), and the
 * paths of a screen as the arcade loop walks them. Svelte-free, so a Node gate and the game both
 * load it from the bare `engine-layout` entry.
 */

import { resolveTransform } from './resolveTransform';
import type { LayoutType, PathNode, Point2D, Scene } from './types';

/** A path needs two points to have a direction. */
export const PATH_MIN_POINTS = 2;

/** A path as the loop reads it: points in its screen's space, open unless `closed`. */
export interface ScenePath {
	points: Point2D[];
	closed: boolean;
	smoothing: number;
}

const isPoint = (p: unknown): p is Point2D =>
	typeof p === 'object' &&
	p !== null &&
	Number.isFinite((p as Point2D).x) &&
	Number.isFinite((p as Point2D).y);

/** The node's usable points (each a finite x / y), in order. */
export const pathPoints = (node: PathNode): Point2D[] =>
	Array.isArray(node.points) ? node.points.filter(isPoint) : [];

/** The node's smoothing, clamped to 0 … 1 (absent or not a number ⇒ 0). */
export const pathSmoothing = (node: PathNode): number => {
	const s = node.smoothing;
	return typeof s === 'number' && Number.isFinite(s) ? Math.min(Math.max(s, 0), 1) : 0;
};

/**
 * A stored `path` node as the save keeps it, or `undefined` to drop it: fewer than
 * {@link PATH_MIN_POINTS} usable points. Every other field stays as written (keep-unknown); an
 * unusable point is dropped, `closed` is kept only when `true`, `smoothing` only when it is above 0
 * (clamped to 1). A node already in that shape comes back with the same fields in the same order.
 */
export function normalizePathNode(input: Record<string, unknown>): PathNode | undefined {
	const node = input as unknown as PathNode;
	const points = pathPoints(node);
	if (points.length < PATH_MIN_POINTS) return undefined;
	const out: Record<string, unknown> = { ...input, points };
	if (out.closed !== true) delete out.closed;
	const smoothing = pathSmoothing(node);
	if (smoothing > 0) out.smoothing = smoothing;
	else delete out.smoothing;
	return out as unknown as PathNode;
}

/**
 * Every top-level `path` node of a screen, by node id, its points in the screen's space: each point
 * turned by the node's scale and rotation, then moved to its x / y (`layoutType`'s override when
 * one is given, as the editor places it there). A path nested in a container or a component is
 * not read: a brain names paths of the screen it plays on. A path with fewer than two usable points
 * is skipped.
 */
export function scenePaths(scene: Scene, layoutType: LayoutType = ''): Record<string, ScenePath> {
	const out: Record<string, ScenePath> = {};
	for (const node of scene.nodes ?? []) {
		if (node.kind !== 'path') continue;
		const local = pathPoints(node);
		if (local.length < PATH_MIN_POINTS) continue;
		const t = resolveTransform(node, layoutType);
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		const cos = Math.cos(t.rotation ?? 0);
		const sin = Math.sin(t.rotation ?? 0);
		out[node.id] = {
			points: local.map((p) => ({
				x: t.x + cos * p.x * sx - sin * p.y * sy,
				y: t.y + sin * p.x * sx + cos * p.y * sy,
			})),
			closed: node.closed === true,
			smoothing: pathSmoothing(node),
		};
	}
	return out;
}
