import { pathPoints, type PathNode } from 'engine-layout';
import { pathCurve } from '$lib/editor/pathNodeEdit';

const LINE = 'rgba(255, 196, 87, 0.95)';
const CONTROL = 'rgba(255, 196, 87, 0.35)';

/**
 * A `path` node on the 2D stage, in its own space (the context already carries its transform): the
 * line a character walks dashed (the closing segment too on a loop; the smoothed curve when
 * smoothing is on, with the authored polyline faint under it), a handle on each point (the start
 * filled) and a label. Strokes keep a constant on-screen width whatever the zoom.
 */
export function drawPathNode(
	ctx: CanvasRenderingContext2D,
	node: PathNode,
	selected: boolean,
): void {
	const points = pathPoints(node);
	if (!points.length) return;
	const m = ctx.getTransform();
	const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
	const u = dpr / (Math.hypot(m.a, m.b) || 1);
	const closed = node.closed === true;
	const trace = (pts: readonly { x: number; y: number }[]): void => {
		ctx.beginPath();
		pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
		if (closed) ctx.closePath();
	};

	ctx.lineJoin = 'round';
	if ((node.smoothing ?? 0) > 0) {
		ctx.lineWidth = u;
		ctx.strokeStyle = CONTROL;
		trace(points);
		ctx.stroke();
	}
	ctx.lineWidth = (selected ? 2.5 : 2) * u;
	ctx.strokeStyle = LINE;
	ctx.setLineDash([9 * u, 6 * u]);
	trace(pathCurve(node));
	ctx.stroke();
	ctx.setLineDash([]);

	const half = (selected ? 5 : 3) * u;
	points.forEach((p, i) => {
		ctx.fillStyle = i === 0 ? LINE : '#15151c';
		ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
		ctx.lineWidth = 1.5 * u;
		ctx.strokeStyle = LINE;
		ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
	});

	ctx.fillStyle = '#e8e8ee';
	ctx.font = `${12 * u}px sans-serif`;
	ctx.fillText(
		`⤳ ${node.label ?? 'Path'} · ${points.length} points · ${closed ? 'loop' : 'open'}`,
		points[0].x + 10 * u,
		points[0].y - 10 * u,
	);
}
