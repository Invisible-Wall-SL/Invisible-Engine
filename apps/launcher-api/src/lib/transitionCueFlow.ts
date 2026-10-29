import { flattenGroups, type FlowDoc, type FunctionLibraryDoc, type Graph } from 'engine-flow-v2';

/**
 * Whether a project's flow fires the `transition` cue that Game Settings → Screen FX's row answers
 * (Shader Graph 8e, `shader-graph-screens.md` §9.2): the Scene Editor's row, Game Maker's chip and
 * `/flow-v2` all ask here.
 */

/** The cue the Screen FX transition cue row answers (the engine's awaited `transition`). */
const TRANSITION_CUE = 'transition';

/**
 * Whether `flow` fires the `transition` cue anywhere: its graph, its mode graphs (groups expanded)
 * and the bodies of the library functions they call. `undefined` without a stored flow, whose game
 * plays the coded handlers, which fire it.
 */
export function flowFiresTransition(
	flow: FlowDoc | null | undefined,
	library?: FunctionLibraryDoc | null,
): boolean | undefined {
	if (!flow) return undefined;
	const functions = new Map((library?.functions ?? []).map((fn) => [fn.id, fn.body]));
	const seen = new Set<string>();
	const graphs: Graph[] = [
		flow.graph,
		...Object.values(flow.modes ?? {}).map((mode) => mode.graph),
	];
	while (graphs.length) {
		const graph = graphs.pop();
		if (!graph) continue;
		for (const node of flattenGroups(graph).nodes) {
			if (node.kind === 'fireCue' && node.ref === TRANSITION_CUE) return true;
			if (node.kind !== 'functionCall' || seen.has(node.ref)) continue;
			seen.add(node.ref);
			const body = functions.get(node.ref);
			if (body) graphs.push(body);
		}
	}
	return false;
}

/**
 * {@link flowFiresTransition}, reading the shared function library (`library`) only when the
 * flow's own graphs do not fire the cue.
 */
export async function flowFiresTransitionWith(
	flow: FlowDoc | null | undefined,
	library: () => Promise<FunctionLibraryDoc | null>,
): Promise<boolean | undefined> {
	const direct = flowFiresTransition(flow);
	return direct === false ? flowFiresTransition(flow, await library()) : direct;
}
