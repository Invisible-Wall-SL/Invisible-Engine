import { freshBookOfFlowDoc, type FlowDoc as FlowDocV2 } from 'engine-flow-v2';
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
 * can never overwrite a good stored doc.
 *
 * Two distinct read paths, kept separate on purpose:
 *  - {@link loadFlowV2Doc} / {@link loadFlowV2DocWithEtag} return `null` when the object is absent
 *    or malformed. The BAKE/EXPORT + FX consumers rely on this: an un-authored project must FALL
 *    THROUGH to the coded handlers, never bake a substituted reference (that would break §7 parity).
 *  - {@link loadFlowV2DocForEditor} NEVER returns null — a project with no stored doc is SEEDED with
 *    a deep clone of the canonical reference flow (`freshBookOfFlowDoc`), so the `/flow-v2` editor
 *    opens on a real, editable, saveable loading→tap→basegame→win flow (not a throwaway sample) and
 *    the author's first edit persists it. Seeding is editor-only; it never reaches the ship chain
 *    until the author actually saves.
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
 * EDITOR read path — like {@link loadFlowV2DocWithEtag} but NEVER returns a null doc. When the
 * project has no stored (or a malformed) `flow-v2.json`, the doc is SEEDED with a fresh deep clone
 * of the canonical reference flow so the `/flow-v2` canvas opens on a real, editable, saveable flow
 * instead of a client-side throwaway sample.
 *
 * `seeded` tells the client the doc it holds is not yet stored (drives the "new · unsaved" pill),
 * while `etag` preserves the correct first-save precondition:
 *  - absent object → `etag === null` → the first save creates it (`ifNoneMatch: '*'`).
 *  - malformed-but-present object → `etag` is the stored object's tag → the first save OVERWRITES
 *    the corrupt bytes (`ifMatch`), never wedging on a create precondition that can't succeed.
 *
 * This is the ONLY seeding read; the bake/export/FX consumers keep the null-returning path so an
 * un-authored project still falls through to the coded handlers (§7 parity).
 */
export async function loadFlowV2DocForEditor(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: FlowDocV2; etag: string | null; seeded: boolean }> {
	const { doc, etag } = await loadFlowV2DocWithEtag(clientKey, projectKey);
	if (doc) return { doc, etag, seeded: false };
	return { doc: freshBookOfFlowDoc(), etag, seeded: true };
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
