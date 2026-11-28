import type { Graphics } from 'pixi.js';

import type { Point2D } from './types';

/**
 * A PROP GRAPHIC (`docs/design/arcade-prop-components.md` §5, P5): vector art drawn from data, for
 * the pieces a prop's code look is made of (a deck tile's diamond and side, a slope, a pillar). The
 * layout has no polygon node, and a new node kind would reach every runtime's `<LayoutNodeView>`.
 * So it is a bound part (`PropGraphic.svelte`, `bind.props`), which the arcade seam registers:
 * nothing of it is in the slot, match-3 or card runtimes.
 *
 * Each op draws one shape and then fills or strokes it, in order, on one `Graphics`. That is how
 * `salmonsArt/river.ts` draws its pieces, so a piece written as the code's ops draws the same
 * instructions (`check:prop-depth`).
 * - A scalar is a number, or a number param of the placed instance × `times` + `plus` (a deck lift
 *   is `{ param: 'height', times: -24 }`).
 * - A point is `[x, y]` on the ground (world px from the piece's place), projected by the screen's
 *   projector, then moved `dy` screen px (a deck's top is its ground point `dy` = −lift).
 * - A rect is in screen px.
 */
export type PropScalar = number | { param: string; times?: number; plus?: number };
export type PropPoint =
	readonly [PropScalar, PropScalar] | readonly [PropScalar, PropScalar, PropScalar];
export type PropPaint = { color: number; alpha?: number };
export type PropStroke = { width: number; color: number; alpha?: number };
export type PropGraphicOp =
	| { poly: readonly PropPoint[]; fill?: PropPaint; stroke?: PropStroke }
	| {
			rect: readonly [PropScalar, PropScalar, PropScalar, PropScalar];
			fill?: PropPaint;
			stroke?: PropStroke;
	  }
	| { line: readonly [PropPoint, PropPoint]; stroke: PropStroke };

/** What `PropGraphic`'s `bind.props` carry: the ops, and where the drawing is placed (screen px). */
export type PropGraphicProps = { ops: readonly PropGraphicOp[]; x?: PropScalar; y?: PropScalar };

/** How a drawing reads its world: the projector's `project` and the instance's params. */
export type PropGraphicScope = {
	project: (x: number, y: number) => Point2D;
	param: (key: string) => unknown;
};

/** `s` resolved: a param that is not a finite number reads as 0. */
export const propScalar = (s: PropScalar, scope: PropGraphicScope): number => {
	if (typeof s === 'number') return s;
	const v = scope.param(s.param);
	const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
	return n * (s.times ?? 1) + (s.plus ?? 0);
};

const point = (p: PropPoint, scope: PropGraphicScope): Point2D => {
	const at = scope.project(propScalar(p[0], scope), propScalar(p[1], scope));
	return { x: at.x, y: at.y + (p.length > 2 ? propScalar(p[2] as PropScalar, scope) : 0) };
};

/** One op resolved to screen px: what any surface draws (the game's `Graphics`, the editor's 2D
 *  canvas). */
export type PropGraphicShape = (
	| { kind: 'poly'; points: number[] }
	| { kind: 'rect'; rect: [number, number, number, number] }
	| { kind: 'line'; points: [number, number, number, number] }
) & { fill?: PropPaint; stroke?: PropStroke };

/** `ops` resolved against `scope`, in order. */
export function resolvePropGraphic(
	ops: readonly PropGraphicOp[],
	scope: PropGraphicScope,
): PropGraphicShape[] {
	return ops.map((op): PropGraphicShape => {
		if ('line' in op) {
			const [a, b] = op.line.map((p) => point(p, scope));
			return { kind: 'line', points: [a.x, a.y, b.x, b.y], stroke: op.stroke };
		}
		const paint = {
			...(op.fill ? { fill: op.fill } : {}),
			...(op.stroke ? { stroke: op.stroke } : {}),
		};
		if ('rect' in op) {
			const [x, y, w, h] = op.rect.map((s) => propScalar(s, scope));
			return { kind: 'rect', rect: [x, y, w, h], ...paint };
		}
		return {
			kind: 'poly',
			points: op.poly.flatMap((p) => Object.values(point(p, scope))),
			...paint,
		};
	});
}

/** Draw `ops` into `g` (cleared first). */
export function drawPropGraphic(
	g: Graphics,
	ops: readonly PropGraphicOp[],
	scope: PropGraphicScope,
): Graphics {
	g.clear();
	for (const shape of resolvePropGraphic(ops, scope)) {
		if (shape.kind === 'line') {
			const [ax, ay, bx, by] = shape.points;
			g.moveTo(ax, ay).lineTo(bx, by);
		} else if (shape.kind === 'rect') g.rect(...shape.rect);
		else g.poly(shape.points);
		if (shape.fill) g.fill(shape.fill.alpha === undefined ? shape.fill.color : shape.fill);
		if (shape.stroke) g.stroke(shape.stroke);
	}
	return g;
}
