import type { FlowDoc as FlowDocV2 } from 'engine-flow-v2';
import { flowV2DocKey } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

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
	return (await loadFlowV2DocWithEtag(clientKey, projectKey)).doc;
}

/**
 * Load a project's v2 FlowDoc with the ETag its next save must match.
 *
 * `doc: null` still means "absent OR malformed" (the caller falls back to its sample),
 * but `etag` distinguishes them — it is read off the object, not inferred from a
 * successful parse. A malformed doc is an object that EXISTS, so it must be
 * overwritten with `ifMatch: <etag>`, never created with `ifNoneMatch: '*'` (which
 * would 412 forever). `etag === null` means the object was genuinely absent.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadFlowV2DocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: FlowDocV2 | null; etag: string | null }> {
	const obj = await getObjectTextWithEtag(flowV2DocKey(clientKey, projectKey));
	if (!obj) return { doc: null, etag: null };
	try {
		const parsed = JSON.parse(obj.text) as unknown;
		return { doc: isFlowV2Doc(parsed) ? parsed : null, etag: obj.etag };
	} catch {
		return { doc: null, etag: obj.etag };
	}
}

/**
 * Persist a project's v2 FlowDoc to R2; rejects a body that is not shaped like a v2
 * `FlowDoc`. Guarded by `baseEtag` — see {@link precondition} for the convention, and
 * `editorStorage.saveDoc` for why `undefined` is not an escape hatch. Throws
 * {@link ConflictError} when another author saved first; returns the new ETag.
 */
export async function saveFlowV2Doc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: FlowDocV2; etag: string | null }> {
	if (!isFlowV2Doc(doc)) throw new Error('not a v2 FlowDoc');
	const etag = await putObjectText(
		flowV2DocKey(clientKey, projectKey),
		JSON.stringify(doc, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc, etag };
}
