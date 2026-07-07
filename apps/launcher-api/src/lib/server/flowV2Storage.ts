import type { FlowDoc as FlowDocV2 } from 'engine-flow-v2';
import { flowV2DocKey } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

/**
 * R2 load/save for the Invisible Flow **v2** document — the node-graph event flow authored
 * on the `/flow-v2` dev canvas. Sibling of v1's `flow.json` at
 * `<client>/<project>/editor/flow-v2.json` (see `flowV2DocKey`), mirroring `flowStorage.ts`.
 *
 * Persistence ONLY: unlike v1, `engine-flow-v2` ships no server-side `normalizeFlowDoc`, so
 * there is no coercion pass here (adding one would touch that package, which is out of scope
 * for this increment). We do a lightweight SHAPE guard (`isFlowV2Doc`) so a malformed body
 * can never overwrite a good stored doc, and load returns `null` when the object is absent or
 * malformed so the page falls back to its built-in `SAMPLE_DOC`.
 *
 * OUT OF SCOPE (later increment): the template VOCABULARY + shared FUNCTION LIBRARY still come
 * from the client-side `sample.ts` (`BOOK_OF_VOCAB`, `LIBRARY`); only the project's FlowDoc
 * persists for now.
 */

/** Minimal structural check that `value` is a v2 `FlowDoc` (`version: 2` + `graph` + `templateId`). */
export function isFlowV2Doc(value: unknown): value is FlowDocV2 {
	if (!value || typeof value !== 'object') return false;
	const doc = value as Record<string, unknown>;
	return (
		doc.version === 2 &&
		typeof doc.templateId === 'string' &&
		typeof doc.graph === 'object' &&
		doc.graph !== null
	);
}

/** Load a project's v2 FlowDoc; `null` when absent or malformed (caller falls back to a sample). */
export async function loadFlowV2Doc(
	clientKey: string,
	projectKey: string,
): Promise<FlowDocV2 | null> {
	const raw = await getObjectText(flowV2DocKey(clientKey, projectKey));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isFlowV2Doc(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Persist a project's v2 FlowDoc to R2; rejects a body that is not shaped like a v2 `FlowDoc`. */
export async function saveFlowV2Doc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
): Promise<FlowDocV2> {
	if (!isFlowV2Doc(doc)) throw new Error('not a v2 FlowDoc');
	await putObjectText(
		flowV2DocKey(clientKey, projectKey),
		JSON.stringify(doc, null, 2),
		'application/json',
	);
	return doc;
}
