import { type FlowDoc, normalizeFlowDoc } from 'engine-flow';
import { flowDocKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

/**
 * R2 load/save for the Invisible Flow document (design doc `invisible-flow.md` §7/§12),
 * mirroring `editorStorage.ts` for the LayoutDoc. The FlowDoc is a sibling of
 * `scenes.json` at `<client>/<project>/editor/flow.json`. Normalization (the
 * serialize/deserialize contract) lives in `engine-flow` so the same coercion runs here
 * AND headlessly (the round-trip spike) — see `normalizeFlowDoc`.
 *
 * Sparse + parity-safe (§7): a missing FlowDoc loads as an empty, no-transitions doc, so
 * an un-authored project falls through to today's coded mounting + `bookEventHandlerMap`.
 */

/** Load a project's FlowDoc, falling back to an empty valid doc when absent/invalid. */
export async function loadFlowDoc(clientKey: string, projectKey: string): Promise<FlowDoc> {
	const raw = await getObjectText(flowDocKey(clientKey, projectKey));
	if (!raw) return normalizeFlowDoc(undefined, projectKey);
	try {
		return normalizeFlowDoc(JSON.parse(raw), projectKey);
	} catch {
		return normalizeFlowDoc(undefined, projectKey);
	}
}

/** Persist a project's FlowDoc to R2 (stamps `updatedAt`); returns the normalized doc. */
export async function saveFlowDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
): Promise<FlowDoc> {
	const next = normalizeFlowDoc(doc, projectKey);
	next.updatedAt = new Date().toISOString();
	await putObjectText(
		flowDocKey(clientKey, projectKey),
		JSON.stringify(next, null, 2),
		'application/json',
	);
	return next;
}
