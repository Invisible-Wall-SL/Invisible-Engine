import type { FunctionLibraryDoc } from 'engine-flow-v2';
import { FLOW_V2_LIBRARY_KEY } from './projectPaths';
import { getObjectText, putObjectText } from './r2';

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
	const raw = await getObjectText(FLOW_V2_LIBRARY_KEY);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return isFlowV2Library(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Persist the shared v2 function library to R2; rejects a body that is not a v2 `FunctionLibraryDoc`. */
export async function saveFlowV2Library(lib: unknown): Promise<FunctionLibraryDoc> {
	if (!isFlowV2Library(lib)) throw new Error('not a v2 FunctionLibraryDoc');
	await putObjectText(FLOW_V2_LIBRARY_KEY, JSON.stringify(lib, null, 2), 'application/json');
	return lib;
}
