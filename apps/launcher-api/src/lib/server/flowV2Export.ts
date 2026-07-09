/**
 * Export a project's Invisible Flow **v2** document (+ the shared function library) into the
 * game-loadable `deploy/` subtree — the v2 analogue of `flowExport.ts`. Closes the "authored the
 * flow in /flow-v2, it saves to R2, but the shipped game still runs its coded path" gap for v2
 * (Phase 5 "ship-ready v2, keep v1"; RULE 8).
 *
 * Like v1's flow export, a v2 FlowDoc carries NO binary assets (it only references scenes the Scene
 * Editor already exported + a template vocabulary the game ships), so this is a plain JSON copy with
 * no asset mirroring:
 *
 *   <client>/<project>/editor/flow-v2.json    ← the authored doc (saved by /api/flow-v2/save)
 *   <client>/<project>/deploy/flow-v2.json    ← the exported doc (this writes it)
 *   _shared/flow-v2/functions.json            ← the shared library (global; saved by the editor)
 *   <client>/<project>/deploy/flow-v2-library.json ← the exported library (this writes it)
 *
 * The existing transport carries it: `buildRuntimeBundle` calls this via `ensureDeployExports` and
 * embeds the returned doc/library in the bundle as `flowV2` / `flowV2Library`; the game reads them
 * via `bakedFlowV2Doc()` / `bakedFlowV2Library()`. ABSENT (un-authored) ⇒ nothing is embedded ⇒ v2
 * stays inert and the v1/coded path owns the game (parity).
 *
 * Unlike v1 there is no `normalizeFlowDoc` (engine-flow-v2 ships none — see `flowV2Storage.ts`), so
 * the doc is embedded as stored (it was shape-guarded on save). An un-authored / de-authored project
 * prunes any stale `deploy/flow-v2*.json`. Idempotent — re-running converges.
 */
import type { FlowDoc as FlowDocV2, FunctionLibraryDoc } from 'engine-flow-v2';
import { SUB } from './projectPaths';
import { deleteObjects, putObjectText } from './r2';
import { loadFlowV2Doc } from './flowV2Storage';
import { loadFlowV2Library } from './flowV2LibraryStorage';

export interface FlowV2ExportIndex {
	/** The exported v2 FlowDoc, or undefined when the project authored no v2 flow (parity). */
	flowV2?: FlowDocV2;
	/** The shared v2 function library embedded alongside an authored doc (undefined otherwise). */
	flowV2Library?: FunctionLibraryDoc;
}

/** A v2 flow is "authored" once its graph has at least one node — an empty graph is the parity-safe
 *  fall-through (nothing to drive), so it is never embedded. `isFlowV2Doc` (the load-time shape guard)
 *  only proves `graph` is an object, NOT that `graph.nodes` is a populated array, so a partially
 *  initialized doc can reach here with `nodes` missing; guard for it so an in-progress doc is treated
 *  as un-authored (pruned) instead of throwing and taking down the whole publish. */
const isAuthoredFlowV2 = (doc: FlowDocV2): boolean =>
	Array.isArray(doc.graph?.nodes) && doc.graph.nodes.length > 0;

export async function exportEditorFlowV2(
	clientKey: string,
	projectKey: string,
): Promise<FlowV2ExportIndex> {
	const deployKey = `${SUB.deploy(clientKey, projectKey)}/flow-v2.json`;
	const libDeployKey = `${SUB.deploy(clientKey, projectKey)}/flow-v2-library.json`;

	const doc = await loadFlowV2Doc(clientKey, projectKey);
	// Un-authored / de-authored / malformed ⇒ prune the deployed pair and embed nothing (parity).
	if (!doc || !isAuthoredFlowV2(doc)) {
		await deleteObjects([deployKey, libDeployKey]);
		return {};
	}

	await putObjectText(deployKey, JSON.stringify(doc, null, '\t'), 'application/json');
	const flowV2Library = (await loadFlowV2Library()) ?? { version: 2, functions: [] };
	await putObjectText(libDeployKey, JSON.stringify(flowV2Library, null, '\t'), 'application/json');
	return { flowV2: doc, flowV2Library };
}
