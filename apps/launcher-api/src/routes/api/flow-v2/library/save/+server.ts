import { error, json } from '@sveltejs/kit';
import { isFlowV2Library, saveFlowV2Library } from '$lib/server/flowV2LibraryStorage';
import { ConflictError, jsonBaseEtag } from '$lib/server/r2';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Save the Invisible Flow **v2** shared FUNCTION LIBRARY to R2 at the CONSTANT global key
 * `_shared/flow-v2/functions.json` (see `FLOW_V2_LIBRARY_KEY`). Mirrors `/api/flow-v2/save`
 * for auth: the shared `gate` 401s when unauthenticated and 403s unless the user is entitled
 * to the `flow` tool (`/flow-v2` is a dev route with no registry entry, so it reuses v1 Flow's
 * entitlement).
 *
 * Unlike the project save this key is FIXED — there is no user-supplied path, so no injection
 * surface; the gate here purely gates that the caller MAY use Flow before writing the shared
 * library. The body is shape-checked as a v2 `FunctionLibraryDoc` server-side so a malformed
 * body can never corrupt the stored library.
 *
 * Because the key is GLOBAL, the `baseEtag` guard here is the ONLY thing standing between
 * two authors on unrelated projects — a Phase 2 project lease cannot cover a shared key,
 * and the read-modify-write window is the whole editing session (read at page load,
 * written at autosave). A stale etag answers **409** rather than erasing the other
 * author's functions. See `docs/design/multi-user-concurrency.md` Phase 1.
 *
 * Body: `{ library: <FunctionLibraryDoc v2>, baseEtag?: string | null, force?: boolean }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'flow',
		forbiddenMessage: 'Your role does not have access to Invisible Flow.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || !isFlowV2Library(body.library)) {
		throw error(400, 'missing or malformed v2 function library');
	}

	// No scope guard here, unlike the doc save: the library key is GLOBAL, so there is
	// no project to mismatch — every author writes the same object by design.
	const baseEtag = body.force === true ? undefined : jsonBaseEtag(body.baseEtag);

	try {
		const { etag } = await saveFlowV2Library(body.library, baseEtag);
		return json({ ok: true, updatedAt: new Date().toISOString(), etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else changed the shared function library while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		throw e;
	}
};
