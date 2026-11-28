import {
	ISO_PROJECTOR_MIRRORED,
	resolvePropGraphic,
	propScalar,
	type IsoProjector,
	type PropGraphicProps,
	type PropGraphicShape,
} from 'engine-layout';

/**
 * A prop's `PropGraphic` art on the editor's 2D canvas (`docs/design/arcade-prop-components.md`
 * §7 P7): the ops resolved as the game resolves them (`resolvePropGraphic`), drawn with the
 * canvas's paths, so the stage, the prop view and the game draw the same shapes. The editor's
 * code only: the game's bound part stays the only thing a runtime carries.
 */

/** The projector the editor draws a prop by: Salmons' (mirrored), the one game with props. */
export const PROP_VIEW_PROJECTOR: IsoProjector = ISO_PROJECTOR_MIRRORED;

/** A `PropGraphic` node's `bind.props` drawn on `ctx` at its origin, reading `param`. */
export function drawPropGraphicNode(
	ctx: CanvasRenderingContext2D,
	props: Partial<PropGraphicProps> | undefined,
	param: (key: string) => unknown,
	alpha = 1,
): boolean {
	if (!props || !Array.isArray(props.ops)) return false;
	const scope = { project: (x: number, y: number) => PROP_VIEW_PROJECTOR.project(x, y), param };
	drawShapes2d(
		ctx,
		resolvePropGraphic(props.ops, scope),
		propScalar(props.x ?? 0, scope),
		propScalar(props.y ?? 0, scope),
		alpha,
	);
	return true;
}

/** Draw `shapes` at `x, y` on a 2D canvas, as the game's `Graphics` draws them. */
export function drawShapes2d(
	ctx: CanvasRenderingContext2D,
	shapes: readonly PropGraphicShape[],
	x: number,
	y: number,
	alpha = 1,
): void {
	const css = (color: number, a = 1) =>
		`rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${a * alpha})`;
	for (const shape of shapes) {
		ctx.beginPath();
		if (shape.kind === 'rect')
			ctx.rect(x + shape.rect[0], y + shape.rect[1], shape.rect[2], shape.rect[3]);
		else {
			const p = shape.points;
			ctx.moveTo(x + p[0], y + p[1]);
			for (let i = 2; i < p.length; i += 2) ctx.lineTo(x + p[i], y + p[i + 1]);
			if (shape.kind === 'poly') ctx.closePath();
		}
		if (shape.fill) {
			ctx.fillStyle = css(shape.fill.color, shape.fill.alpha);
			ctx.fill();
		}
		if (shape.stroke) {
			ctx.lineWidth = shape.stroke.width;
			ctx.strokeStyle = css(shape.stroke.color, shape.stroke.alpha);
			ctx.stroke();
		}
	}
}
