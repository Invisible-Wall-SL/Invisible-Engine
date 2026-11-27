/**
 * WHERE THE SCENE'S COST SITS, for the `?perf=1` probe: a walk of the display tree every
 * {@link SCENE_EVERY} frames (`glCounters.ts` `instrumentApp` runs it after the tick, outside the
 * frame's measured work) that counts nodes, renderables, and how many of those Pixi draws or skips,
 * by top-level layer (a child of the stage), and what each layer that is its own render group cost
 * the GPU in the frame (its draws, passes, filter passes and target switches, nested render groups
 * included). Layers that are not render groups draw inside the stage's own instructions: their
 * share is the frame's counts less the render-group layers', reported as `rest`.
 *
 * The walk is outside the frame's busy time but not free: it holds the main thread after the tick,
 * so the frame that follows can come late. On a 50,000-node tree that is a hitch every
 * {@link SCENE_EVERY} frames in the reading's frame intervals; `walkMs` says how long it was.
 *
 * Plain functions over a tree, so a fixture can drive them with stand-in nodes
 * (`sceneProbe.fixture.ts`).
 */

/** Frames between two scene samples. */
export const SCENE_EVERY = 30;

/** What a stretch of the frame asked of the GPU (`glCounters.ts` `GpuFrameCounts`). */
export interface SceneCost {
	draws: number;
	passes: number;
	filterPasses: number;
	targetSwitches: number;
}

export interface SceneLayerSample {
	/** The layer's label, else its class name, else its place under the stage. */
	label: string;
	nodes: number;
	/** Nodes that draw something: sprites, graphics, meshes, text, particles. */
	renderables: number;
	/** Renderables Pixi draws, and renderables hidden by `visible` / `renderable` on them or above. */
	visible: number;
	culled: number;
	/** Nodes carrying filters. */
	filters: number;
	/** The layer is its own render group: `cost` is exact (its draws, nested groups included). */
	renderGroup: boolean;
	cost?: SceneCost;
}

export interface SceneSample {
	nodes: number;
	renderables: number;
	visible: number;
	culled: number;
	renderGroups: number;
	/** What walking the tree took, ms (outside the frame's busy time). */
	walkMs: number;
	layers: SceneLayerSample[];
	/** The frame's counts the render-group layers did not account for: the stage's own. */
	rest?: SceneCost;
}

/** The part of a Pixi display object the walk reads. */
export interface SceneNode {
	label?: string;
	visible: boolean;
	renderable: boolean;
	isRenderGroup?: boolean;
	renderPipeId?: string;
	filters?: unknown;
	children?: readonly SceneNode[];
	constructor: { name: string };
}

const filtersOf = (node: SceneNode): number => {
	const f = node.filters;
	if (Array.isArray(f)) return f.length ? 1 : 0;
	return f ? 1 : 0;
};

interface Tally {
	nodes: number;
	renderables: number;
	visible: number;
	culled: number;
	filters: number;
	renderGroups: number;
}

/** Count `root` and everything under it; `hidden` when a node above it is not drawn. */
function walk(root: SceneNode, hidden: boolean, into: Tally): void {
	const stack: [SceneNode, boolean][] = [[root, hidden]];
	for (let top = stack.pop(); top; top = stack.pop()) {
		const [node, above] = top;
		const off = above || !node.visible || !node.renderable;
		into.nodes++;
		if (node.renderPipeId !== undefined) {
			into.renderables++;
			if (off) into.culled++;
			else into.visible++;
		}
		into.filters += filtersOf(node);
		if (node.isRenderGroup) into.renderGroups++;
		const children = node.children;
		if (children) for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], off]);
	}
}

/** The label a layer is reported by. */
const labelOf = (node: SceneNode, at: number): string =>
	node.label || (node.constructor.name !== 'Container' ? node.constructor.name : `layer ${at}`);

/**
 * A sample of the tree under `stage`. `costs` maps a layer (a child of the stage) to what the
 * frame's render of it cost, for the layers that are render groups; `frame` is the frame's whole
 * counts, so the stage's own share can be told.
 */
export function sampleScene(
	stage: SceneNode,
	costs: ReadonlyMap<SceneNode, SceneCost>,
	frame: SceneCost,
	now: () => number = () => performance.now(),
): SceneSample {
	const start = now();
	const total: Tally = {
		nodes: 0,
		renderables: 0,
		visible: 0,
		culled: 0,
		filters: 0,
		renderGroups: 0,
	};
	const layers: SceneLayerSample[] = [];
	const hiddenStage = !stage.visible || !stage.renderable;
	const children = stage.children ?? [];
	children.forEach((layer, at) => {
		const t: Tally = {
			nodes: 0,
			renderables: 0,
			visible: 0,
			culled: 0,
			filters: 0,
			renderGroups: 0,
		};
		walk(layer, hiddenStage, t);
		const cost = costs.get(layer);
		layers.push({
			label: labelOf(layer, at),
			nodes: t.nodes,
			renderables: t.renderables,
			visible: t.visible,
			culled: t.culled,
			filters: t.filters,
			renderGroup: !!layer.isRenderGroup,
			...(cost ? { cost } : {}),
		});
		for (const key of [
			'nodes',
			'renderables',
			'visible',
			'culled',
			'filters',
			'renderGroups',
		] as const)
			total[key] += t[key];
	});
	total.nodes += 1;
	let accounted: SceneCost | undefined;
	for (const cost of costs.values()) {
		accounted ??= { draws: 0, passes: 0, filterPasses: 0, targetSwitches: 0 };
		accounted.draws += cost.draws;
		accounted.passes += cost.passes;
		accounted.filterPasses += cost.filterPasses;
		accounted.targetSwitches += cost.targetSwitches;
	}
	return {
		nodes: total.nodes,
		renderables: total.renderables,
		visible: total.visible,
		culled: total.culled,
		renderGroups: total.renderGroups,
		walkMs: Math.round((now() - start) * 10) / 10,
		layers,
		rest: {
			draws: Math.max(0, frame.draws - (accounted?.draws ?? 0)),
			passes: Math.max(0, frame.passes - (accounted?.passes ?? 0)),
			filterPasses: Math.max(0, frame.filterPasses - (accounted?.filterPasses ?? 0)),
			targetSwitches: Math.max(0, frame.targetSwitches - (accounted?.targetSwitches ?? 0)),
		},
	};
}
