import { sampleChannel, type CinematicKey } from 'engine-cinematic';
import type { ZoneArtSource } from 'game-config';
import { Container, Graphics, type Sprite } from 'pixi.js';

import type { SpawnProp } from '../arcadeProps.svelte';
import { PROP_COMPONENTS, PROP_TIMELINES } from '../propComponents';
import { drawPropGraphic, propScalar, type PropGraphicProps } from '../propGraphic';
import { settledPropStates } from '../propPieces';
import { resolveComponent } from '../registerComponents';
import { stateMachineTimelines } from '../componentTimelines';
import type { CinematicDoc, ComponentDef, LayoutNode } from '../types';

/**
 * A PROP'S WATER AND BEHIND PIECES DRAWN IN THE RIVER (`docs/design/arcade-prop-components.md` §5,
 * P5): the pieces the arcade runtime publishes (`arcadeProps.svelte.ts`) that stand in the river's
 * own layers, not among the players: a `water` piece on the reflections, a `behind` piece in the
 * upright layer at its order. They are drawn here, by the river, because those layers are the
 * river's (kept over the bloodstains, sorted once with the rocks and trees, culled by the view),
 * where no `<ComponentInstance>` is mounted. So of each piece def this reads what those pieces use
 * and nothing more:
 * - its nodes: `PropGraphic` art drawn as the bound part draws it (`propGraphic.ts`); a `sprite`
 *   (an atlas region, `<assetKey>::<region>`, or the image param its `region` is bound to) and a
 *   `flipbook` (its clip, played at its rate) as the river draws a zone's picture (`zoneFrames`:
 *   the game's loaded textures), with the node's anchor, size, scale, rotation, alpha and tint;
 *   a `container`'s children, in its transform. Any other node draws nothing;
 * - which of them show: the state each machine layer settles in from its entry on the piece's held
 *   inputs (`==` conditions on a value or a param, as the seed's pillar cells), and that state's
 *   visibility keys;
 * - a LOOPING state's property keys (`x`, `y`, `scaleX`) on a node, played on the river's ticker
 *   from the state's `offsetParam` (the reflections' sway).
 * The piece's def is the registered one (a project's copy shadows the seed), its timelines the
 * registered ones; with none registered, the seed's. A sprite or a clip whose textures are not
 * loaded is left out, as a zone picture is. `check:prop-depth` holds the seed's pieces to the code
 * bridge's recorded drawing.
 */

/** A drawn node, and what its looping state plays on it (`play(seconds)`; none ⇒ still). */
export type DrawnPropNode = { view: Container; play?: (seconds: number) => void };

/** How the river draws a picture: a sheet's frame, a clip's frames played on its ticker. */
export type PropPictures = (source: ZoneArtSource) => Sprite | undefined;

/** What of a timeline's tracks this reads: a node's visibility keys and its property channels. */
type Track = {
	kind: string;
	actorId: string;
	keys?: readonly { visible?: boolean }[];
	channels?: Record<string, CinematicKey[] | undefined>;
};
const tracksOf = (doc: CinematicDoc): readonly Track[] => doc.tracks as unknown as readonly Track[];

const defs = (): Map<string, ComponentDef> => new Map(PROP_COMPONENTS.map((d) => [d.id, d]));
const timelines = (): Map<string, CinematicDoc> => new Map(PROP_TIMELINES.map((t) => [t.id, t]));
let byId: Map<string, ComponentDef> | undefined;
let docs: Map<string, CinematicDoc> | undefined;

/** Draw `piece` (projected by `project`, raised by its `lift`) as its def's nodes; `pictures` draws
 *  its sprites and clips (none ⇒ only its `PropGraphic` art). */
export function drawPropPiece(
	piece: SpawnProp,
	project: (x: number, y: number) => { x: number; y: number },
	pictures?: PropPictures,
): DrawnPropNode[] {
	const def = resolveComponent(piece.componentId).def ?? (byId ??= defs()).get(piece.componentId);
	if (!def) return [];
	const registered = new Map(
		stateMachineTimelines(def.stateMachine).docs.map((doc): [string, CinematicDoc] => [
			doc.id,
			doc,
		]),
	);
	const params: Record<string, unknown> = Object.fromEntries(
		(def.params ?? []).map((p) => [p.key, p.default]),
	);
	Object.assign(params, piece.params);
	const inputs: Record<string, unknown> = Object.fromEntries(
		(def.inputs ?? []).map((i) => [i.id, i.default]),
	);
	Object.assign(inputs, piece.inputValues);
	const states = settledPropStates(def.stateMachine?.layers ?? [], inputs, params);
	const shown = new Map<string, boolean>();
	const loops: { doc: CinematicDoc; offset: number }[] = [];
	for (const state of states) {
		const doc =
			state && (registered.get(state.timeline) ?? (docs ??= timelines()).get(state.timeline));
		if (!state || !doc) continue;
		for (const track of tracksOf(doc)) {
			if (track.kind === 'visibility') shown.set(track.actorId, track.keys?.[0]?.visible !== false);
		}
		if (state.loop) {
			const offset = state.offsetParam ? Number(params[state.offsetParam]) || 0 : 0;
			loops.push({ doc, offset });
		}
	}
	const place = project(piece.x, piece.y);
	const scope = { project, param: (key: string) => params[key] };
	const out: DrawnPropNode[] = [];
	for (const node of def.root.children as LayoutNode[]) {
		if (shown.get(node.label ?? '') === false) continue;
		const view = drawNode(node, scope, pictures);
		if (!view) continue;
		const x = place.x + view.x;
		const y = place.y - (piece.lift ?? 0) + view.y;
		view.position.set(x, y);
		const scaleX = view.scale.x;
		const tracks = loops.flatMap(({ doc, offset }) =>
			tracksOf(doc)
				.filter((t) => t.kind === 'property' && t.actorId === node.label)
				.map((t) => ({ channels: t.channels ?? {}, offset, duration: doc.duration })),
		);
		const play = tracks.length
			? (seconds: number) => {
					for (const { channels, offset, duration } of tracks) {
						const at = (seconds + offset) % duration;
						const dx = sampleChannel(channels.x, at);
						const dy = sampleChannel(channels.y, at);
						const sx = sampleChannel(channels.scaleX, at);
						if (dx !== undefined) view.x = x + dx;
						if (dy !== undefined) view.y = y + dy;
						if (sx !== undefined) view.scale.x = scaleX * sx;
					}
				}
			: undefined;
		out.push({ view, play });
	}
	return out;
}

type Scope = {
	project: (x: number, y: number) => { x: number; y: number };
	param: (key: string) => unknown;
};

/** A node as the river draws it, at its own place in its piece (`undefined`: nothing to draw). */
function drawNode(node: LayoutNode, scope: Scope, pictures?: PropPictures): Container | undefined {
	if (node.bind) {
		if (node.bind.component !== 'PropGraphic') return undefined;
		const props = node.bind.props as unknown as PropGraphicProps;
		const view = drawPropGraphic(new Graphics(), props.ops, scope);
		view.position.set(
			node.x + propScalar(props.x ?? 0, scope),
			node.y + propScalar(props.y ?? 0, scope),
		);
		return view;
	}
	let view: Container | undefined;
	if (node.kind === 'container') {
		view = new Container();
		for (const child of node.children) {
			const drawn = drawNode(child, scope, pictures);
			if (drawn) view.addChild(drawn);
		}
		if (!view.children.length) return undefined;
	} else if (node.kind === 'sprite' || node.kind === 'flipbook') {
		const source = pictureSource(node, scope);
		const sprite = source && pictures?.(source);
		if (!sprite) return undefined;
		sprite.anchor.set(node.anchor?.x ?? 0, node.anchor?.y ?? 0);
		const tint = boundNumber(node, 'tint', scope) ?? node.tint;
		if (tint !== undefined) sprite.tint = tint;
		sized(sprite, node);
		if (node.kind === 'flipbook')
			sprite.scale.set(
				sprite.scale.x * (node.flipX ? -1 : 1),
				sprite.scale.y * (node.flipY ? -1 : 1),
			);
		view = sprite;
	} else return undefined;
	view.position.set(node.x, node.y);
	if (node.scale) view.scale.set(view.scale.x * node.scale.x, view.scale.y * node.scale.y);
	if (node.rotation) view.rotation = node.rotation;
	if (node.alpha !== undefined) view.alpha = node.alpha;
	return view;
}

/** A sprite's region (`<assetKey>::<region>`, its `region` binding's image param first) or a
 *  flipbook's clip, as a zone picture names it. */
function pictureSource(
	node: Extract<LayoutNode, { kind: 'sprite' | 'flipbook' }>,
	scope: Scope,
): ZoneArtSource | undefined {
	if (node.kind === 'flipbook') {
		return node.clipId
			? { kind: 'flipbook', clip: node.clipId, ...(node.fps ? { fps: node.fps } : {}) }
			: undefined;
	}
	const bound = node.paramBindings?.region ? scope.param(node.paramBindings.region) : undefined;
	const region = typeof bound === 'string' && bound ? bound : node.region;
	if (!region) return undefined;
	return { kind: 'sprite', region: region.includes('::') ? region : `${node.assetKey}::${region}` };
}

const boundNumber = (node: LayoutNode, field: string, scope: Scope): number | undefined => {
	const key = node.paramBindings?.[field];
	const v = key ? scope.param(key) : undefined;
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** A sprite sized to its node's box, as `<LayoutNodeView>` sizes one: both sides, one keeping the
 *  frame's ratio, or inside the box with `keepAspect`. No box ⇒ the frame's own size. */
function sized(
	sprite: Sprite,
	node: { width?: number; height?: number; keepAspect?: boolean },
): void {
	const { width, height } = node;
	const w = sprite.texture.width || 1;
	const h = sprite.texture.height || 1;
	if (width !== undefined && height !== undefined) {
		if (node.keepAspect) sprite.scale.set(Math.min(width / w, height / h));
		else sprite.scale.set(width / w, height / h);
	} else if (width !== undefined) sprite.scale.set(width / w);
	else if (height !== undefined) sprite.scale.set(height / h);
}
