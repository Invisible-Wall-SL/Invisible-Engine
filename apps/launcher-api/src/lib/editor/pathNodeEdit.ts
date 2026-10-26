/**
 * Editing a `path` node in the Scene Editor (`docs/design/game-families.md` §4.3, P10.11): its
 * selectable box, the mapping between the stage and the node's own point space, and the point
 * edits the canvas and Properties share. Plain functions over the node, so a Node gate runs them.
 */
import {
	PATH_MIN_POINTS,
	pathPoints,
	pathSmoothing,
	type PathNode,
	type Point2D,
	type ResolvedTransform,
} from 'engine-layout';
import { samplePath } from 'engine-mechanics';

/** Local px around the points' bounds, so a straight path still has a box to grab. */
export const PATH_BOX_PAD = 16;

/** A new path: a horizontal line 300 px long, centred on its origin. */
export function newPathNode(id: string, x: number, y: number): PathNode {
	return {
		id,
		kind: 'path',
		label: 'Path',
		x,
		y,
		points: [
			{ x: -150, y: 0 },
			{ x: 150, y: 0 },
		],
	};
}

/** The box the canvas selects and frames: the points' bounds, padded, around the node origin. */
export function pathBox(node: PathNode): { w: number; h: number; ax: number; ay: number } {
	const pts = pathPoints(node);
	if (!pts.length) return { w: 2 * PATH_BOX_PAD, h: 2 * PATH_BOX_PAD, ax: 0.5, ay: 0.5 };
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const minX = Math.min(...xs) - PATH_BOX_PAD;
	const minY = Math.min(...ys) - PATH_BOX_PAD;
	const w = Math.max(...xs) + PATH_BOX_PAD - minX;
	const h = Math.max(...ys) + PATH_BOX_PAD - minY;
	return { w, h, ax: -minX / w, ay: -minY / h };
}

/** The line a character walks, in the node's space: the polyline, or its smoothed curve. */
export function pathCurve(node: PathNode): Point2D[] {
	const points = pathPoints(node);
	if (points.length < PATH_MIN_POINTS) return points;
	return samplePath({ points, closed: node.closed === true, smoothing: pathSmoothing(node) })
		.points;
}

/** A node-space point on the stage, through the node's drawn transform (origin, rotation, scale). */
export function pathLocalToWorld(t: ResolvedTransform, p: Point2D): Point2D {
	const sx = (t.scale?.x ?? 1) * p.x;
	const sy = (t.scale?.y ?? 1) * p.y;
	const r = t.rotation ?? 0;
	return {
		x: t.x + Math.cos(r) * sx - Math.sin(r) * sy,
		y: t.y + Math.sin(r) * sx + Math.cos(r) * sy,
	};
}

/** {@link pathLocalToWorld} undone: a stage point in the node's space. */
export function pathWorldToLocal(t: ResolvedTransform, w: Point2D): Point2D {
	const dx = w.x - t.x;
	const dy = w.y - t.y;
	const r = t.rotation ?? 0;
	const lx = Math.cos(r) * dx + Math.sin(r) * dy;
	const ly = -Math.sin(r) * dx + Math.cos(r) * dy;
	const sx = t.scale?.x || 1;
	const sy = t.scale?.y || 1;
	return { x: lx / sx, y: ly / sy };
}

/** The index of the point within `radius` of `at` (the nearest), or -1. Same space for all. */
export function nearestPathPoint(points: readonly Point2D[], at: Point2D, radius: number): number {
	let best = -1;
	let bestD = radius;
	points.forEach((p, i) => {
		const d = Math.hypot(p.x - at.x, p.y - at.y);
		if (d <= bestD) {
			best = i;
			bestD = d;
		}
	});
	return best;
}

/**
 * The authored segment within `radius` of `at`: `after` is the index of its first point (the last
 * one for the closing segment of a closed path) and `t` how far along it `at` projects. Undefined
 * when no segment is that close.
 */
export function nearestPathSegment(
	points: readonly Point2D[],
	closed: boolean,
	at: Point2D,
	radius: number,
): { after: number; t: number } | undefined {
	const n = points.length;
	const segments = closed && n > 2 ? n : n - 1;
	let best: { after: number; t: number } | undefined;
	let bestD = radius;
	for (let i = 0; i < segments; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		const ex = b.x - a.x;
		const ey = b.y - a.y;
		const len2 = ex * ex + ey * ey;
		const t =
			len2 > 0 ? Math.min(Math.max(((at.x - a.x) * ex + (at.y - a.y) * ey) / len2, 0), 1) : 0;
		const d = Math.hypot(a.x + ex * t - at.x, a.y + ey * t - at.y);
		if (d <= bestD) {
			best = { after: i, t };
			bestD = d;
		}
	}
	return best;
}

const round = (p: Point2D): Point2D => ({ x: Math.round(p.x), y: Math.round(p.y) });

/** Move point `index` (rounded to whole px). False when there is no such point. */
export function setPathPoint(node: PathNode, index: number, p: Point2D): boolean {
	if (!Array.isArray(node.points) || index < 0 || index >= node.points.length) return false;
	if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
	node.points[index] = round(p);
	return true;
}

/** Insert a point after `after` (rounded to whole px); returns its index. */
export function insertPathPoint(node: PathNode, after: number, p: Point2D): number {
	if (!Array.isArray(node.points)) node.points = [];
	const index = Math.min(Math.max(after + 1, 0), node.points.length);
	node.points.splice(index, 0, round(p));
	return index;
}

/** Add a point past the end: on along the last segment (or, on a loop, halfway back to the start). */
export function appendPathPoint(node: PathNode): number {
	const pts = pathPoints(node);
	const last = pts[pts.length - 1] ?? { x: 0, y: 0 };
	const prev = pts[pts.length - 2] ?? { x: last.x - 100, y: last.y };
	if (node.closed === true && pts.length >= PATH_MIN_POINTS) {
		const first = pts[0];
		return insertPathPoint(node, pts.length - 1, {
			x: (last.x + first.x) / 2,
			y: (last.y + first.y) / 2,
		});
	}
	return insertPathPoint(node, pts.length - 1, {
		x: last.x + (last.x - prev.x || 100),
		y: last.y + (last.y - prev.y),
	});
}

/** Remove point `index`; refused (false) while the path has only {@link PATH_MIN_POINTS}. */
export function removePathPoint(node: PathNode, index: number): boolean {
	if (!Array.isArray(node.points) || node.points.length <= PATH_MIN_POINTS) return false;
	if (index < 0 || index >= node.points.length) return false;
	node.points.splice(index, 1);
	return true;
}

/** Open or loop the path; `closed` is stored only when on. */
export function setPathClosed(node: PathNode, on: boolean): void {
	if (on) node.closed = true;
	else delete node.closed;
}

/** Set the smoothing (clamped 0 … 1); stored only above 0. False for a non-number. */
export function setPathSmoothing(node: PathNode, v: number): boolean {
	if (!Number.isFinite(v)) return false;
	const s = Math.min(Math.max(v, 0), 1);
	if (s > 0) node.smoothing = s;
	else delete node.smoothing;
	return true;
}
