import { flowGraphs } from './runtime';
import type { ContainerRef, FlowDoc, Graph } from './types';

/**
 * The flow's containers whose backing scene is NOT in the layout: screens the flow can show that
 * draw nothing. A Scene-Editor screen deleted after the flow synced it (or lost to a bad save)
 * stays in `FlowDoc.containers`, so `showContainer` still mounts it, nothing renders, and a hold or
 * tap waiting on it never releases. One home for the rule, read by the game at boot and by the
 * launcher at publish and at the runtime-bundle assembly.
 *
 * An EMPTY scene list is an unknown layout (an unsaved project, a boot with no doc), not a layout
 * with no screens, so it reports nothing rather than every container. Doc order is kept; `[]` means
 * the flow and the layout agree.
 */
export const containersMissingScene = (
	containers: readonly ContainerRef[],
	sceneIds: Iterable<string>,
): ContainerRef[] => {
	const known = new Set(sceneIds);
	if (known.size === 0) return [];
	return containers.filter((c) => !known.has(c.sceneId));
};

/**
 * The scenes the flow can put on screen: the backing scene of each declared container a
 * `showContainer` node targets, in any section (the global graph or a mode's), groups included.
 *
 * Declaring a container is not showing it. The `/flow-v2` editor declares every Scene-Editor screen
 * (`syncFlowContainers`), so a declared-only container is a screen the flow leaves alone. A hide
 * alone mounts nothing either. A show of an undeclared container mounts nothing, so it is not
 * counted.
 */
export const shownSceneIds = (doc: FlowDoc): Set<string> => {
	const sceneOf = new Map(doc.containers.map((c) => [c.id, c.sceneId]));
	const shown = new Set<string>();
	const scan = (graph: Graph): void => {
		for (const node of graph.nodes) {
			if (node.kind === 'showContainer') {
				const sceneId = sceneOf.get(node.ref);
				if (sceneId !== undefined) shown.add(sceneId);
			} else if (node.kind === 'group' && node.body) scan(node.body);
		}
	};
	for (const { graph } of flowGraphs(doc)) scan(graph);
	return shown;
};
