import {
	flattenGroups,
	templateVocabulary,
	type FlowDoc,
	type FunctionLibraryDoc,
	type Graph,
} from 'engine-flow-v2';
import type { SoundsDoc } from 'engine-layout';
import { soundOptionsFor } from '$lib/soundOptions';
import type { CueLists } from '$lib/timeline/cueNames';

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The author-named cues a flow fires: every `fireCue` ref in its graph and its mode graphs that is
 * not one of the engine's own cues for its template (those drive coded presentation — a timeline
 * `signal:` of that name would reach nothing a flow reacts to). Sorted, each once.
 */
export function flowFiredCues(flow: unknown): string[] {
	if (!isRecord(flow)) return [];
	const templateId = typeof flow.templateId === 'string' ? flow.templateId : undefined;
	const engine = new Set(templateVocabulary(templateId).cues.map((c) => c.name));
	const modes = isRecord(flow.modes) ? Object.values(flow.modes) : [];
	const graphs = [flow.graph, ...modes.map((m) => (isRecord(m) ? m.graph : undefined))];
	const out = new Set<string>();
	for (const graph of graphs) {
		if (!isRecord(graph) || !Array.isArray(graph.nodes)) continue;
		for (const node of graph.nodes) {
			if (!isRecord(node) || node.kind !== 'fireCue') continue;
			if (typeof node.ref === 'string' && node.ref && !engine.has(node.ref)) out.add(node.ref);
		}
	}
	return [...out].sort();
}

/**
 * The editor's cue-inspector lists (`CueLists`) for a project: its sound names (`soundOptionsFor`,
 * the list every sound picker reads), the uploads ▶ can play, and its flow's fired cues.
 * `canAudition`: the user holds Invisible Sound, whose file route the audition streams from.
 */
export function cueListsFor(
	library: SoundsDoc | null | undefined,
	flow: unknown,
	canAudition: boolean,
): CueLists {
	const auditions: CueLists['auditions'] = {};
	if (canAudition) {
		for (const e of library?.entries ?? []) {
			auditions[e.name] = { file: e.file, volume: e.volume, loop: e.loop };
		}
	}
	return { ...soundOptionsFor(library), auditions, flowCues: flowFiredCues(flow) };
}

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
