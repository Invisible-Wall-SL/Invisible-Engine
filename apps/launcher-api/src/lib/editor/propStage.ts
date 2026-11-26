import {
	isoDepthOrder,
	resolvePropGraphic,
	propScalar,
	type CinematicDoc,
	type ComponentDef,
	type LayoutNode,
	type PropGraphicProps,
	type PropGraphicShape,
} from 'engine-layout';
import { aloftDepth, placeSalmonsProp } from 'engine-layout/prop-placement';

import { segmentPoseNodes } from '$lib/timeline/segmentPreview';
import { PROP_VIEW_PROJECTOR } from './propCanvas';
import { PROP_CELL, propPreviewZone, type StandIn } from './propEdit';

/**
 * THE PROP VIEW'S DRAWING (`docs/design/arcade-prop-components.md` §7 P7): the open prop def cut
 * into its pieces on its preview zone and placed as Salmons places them (`placeSalmonsProp`), each
 * piece's `PropGraphic` nodes resolved at the pose its machine settles in (the canvas's own segment
 * settle, `segmentPoseNodes`), in the game's draw order: the water in order, under the pieces
 * behind every character by their upright order, under the deck cells and the stand-in character
 * sorted among each other by ground depth. Projected as Salmons' screen is (mirrored). Pure.
 */

/** One drawn node of a piece, at its screen place (world origin projected at 0, 0). */
export type StageItem = {
	key: string;
	band: string;
	x: number;
	y: number;
	shapes: PropGraphicShape[];
};
/** The stand-in in the draw order, at its screen place, raised by `lift` screen px. */
export type StageStandIn = { kind: 'standIn'; x: number; y: number; lift: number };

/** A world `z` (px) in screen px up: a cell of height is 16 K = 24 px (`liftOf`). */
export const liftPx = (zWorld: number): number => (zWorld / PROP_CELL) * 24;

/** The prop's pieces, and the stand-in when given, in draw order. */
export function propStageItems(
	def: ComponentDef,
	defOf: (id: string) => ComponentDef | undefined,
	timelinesOf: (id: string) => readonly CinematicDoc[],
	standIn?: StandIn & { z: number },
): (StageItem | StageStandIn)[] {
	if (!def.prop) return [];
	const zone = propPreviewZone(def);
	const project = (x: number, y: number) => PROP_VIEW_PROJECTOR.project(x, y);
	const water: StageItem[] = [];
	const behind: { z: number; item: StageItem }[] = [];
	const among: { z: number; item: StageItem | StageStandIn }[] = [];
	placeSalmonsProp(def, zone, 0, 0).forEach((piece) => {
		const pieceDef = defOf(piece.componentId);
		if (!pieceDef) return;
		const params: Record<string, unknown> = Object.fromEntries(
			(pieceDef.params ?? []).map((p) => [p.key, p.default]),
		);
		Object.assign(params, piece.params);
		const nodes =
			segmentPoseNodes(pieceDef, timelinesOf(pieceDef.id), piece.inputValues ?? {}, params) ??
			pieceDef.root.children;
		const at = project(piece.x, piece.y);
		const scope = { project, param: (key: string) => params[key] };
		for (const node of nodes) {
			const drawn = drawnNode(node, scope);
			if (!drawn) continue;
			const item: StageItem = {
				key: `${piece.id}:${node.id}`,
				band: piece.band,
				x: at.x + drawn.x,
				y: at.y + drawn.y,
				shapes: drawn.shapes,
			};
			if (piece.band === 'water') water.push(item);
			else if (piece.band === 'behind') behind.push({ z: piece.zIndex ?? 0, item });
			else among.push({ z: isoDepthOrder(piece.x, piece.y, 0, piece.bias ?? 0), item });
		}
	});
	if (standIn) {
		const at = project(standIn.x, standIn.y);
		const lift = liftPx(standIn.z);
		const bias = standIn.z > 0 ? aloftDepth(lift) : 0;
		among.push({
			z: isoDepthOrder(standIn.x, standIn.y, 1, bias),
			item: { kind: 'standIn', x: at.x, y: at.y, lift },
		});
	}
	const byZ = <T>(list: { z: number; item: T }[]) =>
		list.sort((a, b) => a.z - b.z).map((e) => e.item);
	return [...water, ...byZ(behind), ...byZ(among)];
}

/** A node's drawing, when it is a `PropGraphic` node: its shapes and its place in the piece. */
function drawnNode(
	node: LayoutNode,
	scope: {
		project: (x: number, y: number) => { x: number; y: number };
		param: (k: string) => unknown;
	},
): { x: number; y: number; shapes: PropGraphicShape[] } | undefined {
	if (node.bind?.component !== 'PropGraphic' || node.alpha === 0) return undefined;
	const props = (node.bind.props ?? {}) as Partial<PropGraphicProps>;
	if (!Array.isArray(props.ops)) return undefined;
	return {
		x: node.x + propScalar(props.x ?? 0, scope),
		y: node.y + propScalar(props.y ?? 0, scope),
		shapes: resolvePropGraphic(props.ops, scope),
	};
}
