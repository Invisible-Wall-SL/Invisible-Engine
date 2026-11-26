import { sampleChannel, type CinematicKey } from 'engine-cinematic';
import { Graphics } from 'pixi.js';

import type { SpawnProp } from '../arcadeProps.svelte';
import { PROP_COMPONENTS, PROP_TIMELINES } from '../propComponents';
import { drawPropGraphic, propScalar, type PropGraphicProps } from '../propGraphic';
import type { CinematicDoc, ComponentDef, LayoutNode, SmLayer } from '../types';

/**
 * A PROP'S WATER AND BEHIND PIECES DRAWN IN THE RIVER (`docs/design/arcade-prop-components.md` §5,
 * P5): the pieces the arcade runtime publishes (`arcadeProps.svelte.ts`) that stand in the river's
 * own layers, not among the players: a `water` piece on the reflections, a `behind` piece in the
 * upright layer at its order. They are drawn here, by the river, because those layers are the
 * river's (kept over the bloodstains, sorted once with the rocks and trees), where no
 * `<ComponentInstance>` is mounted. So of each piece def this reads what those pieces use and
 * nothing more:
 * - its `PropGraphic` nodes, drawn as the bound part draws them (`propGraphic.ts`);
 * - which of them show: the state each machine layer settles in from its entry on the piece's held
 *   inputs (`==` conditions on a value or a param, as the seed's pillar cells), and that state's
 *   visibility keys;
 * - a LOOPING state's property keys (`x`, `y`, `scaleX`) on a node, played on the river's ticker
 *   from the state's `offsetParam` (the reflections' sway).
 * A def it cannot read draws nothing; `check:prop-depth` holds the seed's pieces to the code
 * bridge's recorded drawing.
 */

/** A drawn node, and what its looping state plays on it (`play(seconds)`; none ⇒ still). */
export type DrawnPropNode = { view: Graphics; play?: (seconds: number) => void };

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

/** The state each layer settles in from its entry, on `inputs` (a condition's `param` read from
 *  `params`). */
function settled(
	layers: readonly SmLayer[],
	inputs: Record<string, unknown>,
	params: Record<string, unknown>,
) {
	const holds = (c: { op: string; input: string; value?: unknown; param?: string }) =>
		c.op === '==' && inputs[c.input] === (c.param !== undefined ? params[c.param] : c.value);
	return layers.map((layer) => {
		const to = layer.transitions.find(
			(t) => t.from === layer.entry && !!t.conditions?.length && t.conditions.every(holds),
		)?.to;
		return layer.states.find((s) => s.id === (to ?? layer.entry));
	});
}

/** Draw `piece` (projected by `project`, raised by its `lift`) as its def's `PropGraphic` nodes. */
export function drawPropPiece(
	piece: SpawnProp,
	project: (x: number, y: number) => { x: number; y: number },
): DrawnPropNode[] {
	const def = (byId ??= defs()).get(piece.componentId);
	if (!def) return [];
	const params: Record<string, unknown> = Object.fromEntries(
		(def.params ?? []).map((p) => [p.key, p.default]),
	);
	Object.assign(params, piece.params);
	const inputs: Record<string, unknown> = Object.fromEntries(
		(def.inputs ?? []).map((i) => [i.id, i.default]),
	);
	Object.assign(inputs, piece.inputValues);
	const states = settled(def.stateMachine?.layers ?? [], inputs, params);
	const shown = new Map<string, boolean>();
	const loops: { doc: CinematicDoc; offset: number }[] = [];
	for (const state of states) {
		const doc = state && (docs ??= timelines()).get(state.timeline);
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
		const bind = node.bind;
		if (bind?.component !== 'PropGraphic' || shown.get(node.label ?? '') === false) continue;
		const props = bind.props as unknown as PropGraphicProps;
		const view = drawPropGraphic(new Graphics(), props.ops, scope);
		const x = place.x + node.x + propScalar(props.x ?? 0, scope);
		const y = place.y - (piece.lift ?? 0) + node.y + propScalar(props.y ?? 0, scope);
		view.position.set(x, y);
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
						if (sx !== undefined) view.scale.x = sx;
					}
				}
			: undefined;
		out.push({ view, play });
	}
	return out;
}
