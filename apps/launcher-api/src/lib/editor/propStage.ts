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
 * piece's nodes at the pose its machine settles in (the canvas's own segment settle,
 * `segmentPoseNodes`): its `PropGraphic` art resolved, its sprites and clips as pictures (drawn by
 * the page, which loads their atlases), a container's children in its place; in the game's draw
 * order: the water in order, under the pieces
 * behind every character by their upright order, under the deck cells and the stand-in character
 * sorted among each other by ground depth. Projected as Salmons' screen is (mirrored). Pure.
 */

/** Painted art: a sprite's atlas region (`<assetKey>::<region>`) or a clip's (its first frame),
 *  with its node's transform as the game draws it. */
export type StagePicture = {
	kind: 'sprite' | 'flipbook';
	/** `<assetKey>::<region>` for a sprite, the clip id for a flipbook. */
	ref: string;
	anchor: { x: number; y: number };
	width?: number;
	height?: number;
	keepAspect?: boolean;
	scale: { x: number; y: number };
	rotation: number;
	alpha: number;
	tint?: number;
};
/** One drawn node of a piece, at its screen place (world origin projected at 0, 0): its vector
 *  shapes, or its painted picture. */
export type StageItem = {
	key: string;
	band: string;
	x: number;
	y: number;
	shapes: PropGraphicShape[];
	picture?: StagePicture;
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
		for (const drawn of nodes.flatMap((node) => drawnNodes(node, scope, 0, 0))) {
			const item: StageItem = {
				key: `${piece.id}:${drawn.id}`,
				band: piece.band,
				x: at.x + drawn.x,
				y: at.y + drawn.y,
				shapes: drawn.shapes,
				...(drawn.picture ? { picture: drawn.picture } : {}),
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

type Scope = {
	project: (x: number, y: number) => { x: number; y: number };
	param: (k: string) => unknown;
};
type Drawn = {
	id: string;
	x: number;
	y: number;
	shapes: PropGraphicShape[];
	picture?: StagePicture;
};

/** A node's drawings at its place in its piece (`ox, oy` its parent's): a `PropGraphic` node's
 *  shapes, a sprite's or a clip's picture, a container's children. A hidden node draws nothing. */
function drawnNodes(node: LayoutNode, scope: Scope, ox: number, oy: number): Drawn[] {
	if (node.alpha === 0) return [];
	if (node.bind) {
		if (node.bind.component !== 'PropGraphic') return [];
		const props = (node.bind.props ?? {}) as Partial<PropGraphicProps>;
		if (!Array.isArray(props.ops)) return [];
		return [
			{
				id: node.id,
				x: ox + node.x + propScalar(props.x ?? 0, scope),
				y: oy + node.y + propScalar(props.y ?? 0, scope),
				shapes: resolvePropGraphic(props.ops, scope),
			},
		];
	}
	if (node.kind === 'container') {
		return node.children.flatMap((child) => drawnNodes(child, scope, ox + node.x, oy + node.y));
	}
	if (node.kind !== 'sprite' && node.kind !== 'flipbook') return [];
	let ref: string | undefined;
	if (node.kind === 'flipbook') ref = node.clipId || undefined;
	else {
		const bound = node.paramBindings?.region ? scope.param(node.paramBindings.region) : undefined;
		const region = typeof bound === 'string' && bound ? bound : node.region;
		ref = region ? (region.includes('::') ? region : `${node.assetKey}::${region}`) : undefined;
	}
	if (!ref) return [];
	return [
		{
			id: node.id,
			x: ox + node.x,
			y: oy + node.y,
			shapes: [],
			picture: {
				kind: node.kind,
				ref,
				anchor: { x: node.anchor?.x ?? 0, y: node.anchor?.y ?? 0 },
				width: node.width,
				height: node.height,
				keepAspect: node.kind === 'sprite' ? node.keepAspect : undefined,
				scale: { x: node.scale?.x ?? 1, y: node.scale?.y ?? 1 },
				rotation: node.rotation ?? 0,
				alpha: node.alpha ?? 1,
				tint: node.tint,
			},
		},
	];
}
