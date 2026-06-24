/**
 * Export a project's Invisible Flow document into the game-loadable `deploy/`
 * subtree — the FlowDoc analogue of `editorArtExport.ts` / `fontExport.ts` /
 * `symbolExport.ts`. Closes the "authored the flow in /flow, it saves to R2, but
 * the shipped game still runs its coded mounting + handler map" gap
 * (docs/design/invisible-flow.md §10, RULE 8).
 *
 * Unlike the art/font/symbol exports, a FlowDoc carries NO binary assets of its
 * own — it only references scenes the Scene Editor already exported — so this is a
 * single JSON copy with no asset mirroring:
 *
 *   <client>/<project>/editor/flow.json   ← the authored doc (saved by /api/flow/save)
 *   <client>/<project>/deploy/flow.json   ← the exported doc (this writes it)
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and
 * embeds the returned doc in the baked bundle as `flow`; there is no `pull` step
 * (no binaries). The game registers it via `BakedBundle.flow` — absent ⇒ the
 * interpreter is inert ⇒ coded mounting + `bookEventHandlerMap` (parity, §7).
 *
 * The doc is re-normalized through `normalizeFlowDoc` (the same serialize contract
 * `/api/flow/save` and the headless round-trip use) so the deployed/baked doc is
 * canonical. An absent/invalid `editor/flow.json` exports an EMPTY doc and prunes
 * any stale `deploy/flow.json`, so an un-authored project bakes no flow (parity).
 * Idempotent — re-running converges.
 */
import { type FlowDoc, isAuthoredFlow, normalizeFlowDoc } from 'engine-flow';
import { SUB, flowDocKey } from './projectPaths';
import { deleteObjects, getObjectText, putObjectText } from './r2';

export interface FlowExportIndex {
	/** The exported FlowDoc, normalized. Empty (no screens/transitions) when the
	 *  project has authored nothing — the parity-safe fall-through case. */
	flow: FlowDoc;
}

export async function exportEditorFlow(
	clientKey: string,
	projectKey: string,
): Promise<FlowExportIndex> {
	const deployKey = `${SUB.deploy(clientKey, projectKey)}/flow.json`;

	// Prune the deployed doc + return an empty flow so an un-authored / de-authored
	// project bakes no `flow` and the game stays byte-identical (parity, §7).
	const pruneAndReturn = async (flow: FlowDoc): Promise<FlowExportIndex> => {
		await deleteObjects([deployKey]);
		return { flow };
	};

	const empty = normalizeFlowDoc(undefined, projectKey);

	const raw = await getObjectText(flowDocKey(clientKey, projectKey));
	if (!raw) return pruneAndReturn(empty);

	let flow: FlowDoc;
	try {
		flow = normalizeFlowDoc(JSON.parse(raw), projectKey);
	} catch {
		return pruneAndReturn(empty);
	}

	if (!isAuthoredFlow(flow)) return pruneAndReturn(empty);

	await putObjectText(deployKey, JSON.stringify(flow, null, '\t'), 'application/json');
	return { flow };
}
