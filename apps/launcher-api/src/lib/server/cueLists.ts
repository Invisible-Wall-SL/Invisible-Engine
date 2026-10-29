import { templateVocabulary } from 'engine-flow-v2';
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
