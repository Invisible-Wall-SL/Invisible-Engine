import type { FunctionLibraryDoc } from 'engine-flow-v2';
import { FLOW_V2_LIBRARY_KEY } from './projectPaths';
import { getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * R2 load/save for the Invisible Flow **v2** shared FUNCTION LIBRARY — the reusable
 * `FunctionDef`s authored via "Collapse to Function" on the `/flow-v2` canvas. Mirrors
 * `flowV2Storage.ts`, but the library is GLOBAL: it lives at the CONSTANT, project-agnostic
 * key `FLOW_V2_LIBRARY_KEY` (`_shared/flow-v2/functions.json`), so any project's canvas reads
 * and grows the same library.
 *
 * Persistence ONLY (like `flowV2Storage.ts`): `engine-flow-v2` ships no server-side
 * normalizer, so there is no coercion pass here. We do a lightweight SHAPE guard
 * (`isFlowV2Library`) so a malformed body can never overwrite a good stored library, and
 * load returns `null` when the object is absent or malformed (the page then falls back to
 * its built-in sample `LIBRARY`).
 */

/** Minimal structural check that `value` is a v2 `FunctionLibraryDoc` (`version: 2` + `functions[]`). */
export function isFlowV2Library(value: unknown): value is FunctionLibraryDoc {
	if (!value || typeof value !== 'object') return false;
	const lib = value as Record<string, unknown>;
	return lib.version === 2 && Array.isArray(lib.functions);
}

/** Load the shared v2 function library; `null` when absent or malformed (caller falls back to a sample). */
export async function loadFlowV2Library(): Promise<FunctionLibraryDoc | null> {
	return (await loadFlowV2LibraryWithEtag()).lib;
}

/**
 * Load the shared library with the ETag its next save must match.
 *
 * This matters more here than anywhere else in the tool. The key is GLOBAL, so a
 * project lease can never protect it — Phase 2 does nothing for this file, and the
 * ETag is the WHOLE fix rather than a floor. Worse, the read happens at page load and
 * the write at an 800 ms autosave, so the read-modify-write window is the entire
 * editing session: before Phase 1, two authors on unrelated projects who each added a
 * function would have the second save erase the first's outright.
 * See `docs/design/multi-user-concurrency.md` Phase 1.
 */
export async function loadFlowV2LibraryWithEtag(): Promise<{
	lib: FunctionLibraryDoc | null;
	etag: string | null;
}> {
	const obj = await getObjectTextWithEtag(FLOW_V2_LIBRARY_KEY);
	if (!obj) return { lib: null, etag: null };
	try {
		const parsed = JSON.parse(obj.text) as unknown;
		return { lib: isFlowV2Library(parsed) ? parsed : null, etag: obj.etag };
	} catch {
		return { lib: null, etag: obj.etag };
	}
}

/**
 * Persist the shared v2 function library; rejects a body that is not a v2
 * `FunctionLibraryDoc`. Guarded by `baseEtag` — throws {@link ConflictError} when
 * another author (on ANY project) saved the library first.
 */
export async function saveFlowV2Library(
	lib: unknown,
	baseEtag?: string | null,
): Promise<{ lib: FunctionLibraryDoc; etag: string | null }> {
	if (!isFlowV2Library(lib)) throw new Error('not a v2 FunctionLibraryDoc');
	const etag = await putObjectText(
		FLOW_V2_LIBRARY_KEY,
		JSON.stringify(lib, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { lib, etag };
}
