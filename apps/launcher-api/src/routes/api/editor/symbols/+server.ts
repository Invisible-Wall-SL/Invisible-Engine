import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { requestedBackupMode } from '$lib/server/docBackupRoutes';
import { ConflictError } from '$lib/server/r2';
import { requireSymbolsAccess } from '$lib/server/symbolsAccess';
import { loadSymbolsDocWithEtag, saveSymbolsDoc } from '$lib/server/symbolsStorage';
import { requireProjectScope } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Symbols State Machine (`/symbols`) doc.
 *
 * Session-gated by `requireSymbolsAccess` — the SAME entitlement gate the `/symbols` page uses,
 * NOT the deploy-token gate (that is only for the build-time export in S4). The
 * project is a `?project=` request param resolved by `requireProjectScope`, which
 * 403s a project the user cannot access, so the doc lands at
 * `<client>/<project>/symbols/symbols.json`.
 */

/** Read a project's symbols doc (empty valid doc when never authored) + its ETag. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireSymbolsAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	try {
		const { doc, etag } = await loadSymbolsDocWithEtag(clientKey, projectKey);
		return json({ clientKey, projectKey, doc, etag });
	} catch {
		throw error(502, 'Failed to load the symbols document.');
	}
};

/**
 * Validate + persist a project's symbols doc to R2, guarded by `baseEtag`: a stale one
 * answers **409** rather than discarding a concurrent author's overrides. `force: true`
 * is the author's explicit "overwrite theirs". The replaced bytes are backed up first
 * (`/api/editor/symbols/backups`); `backup: 'always'` exempts a save from the coalescing window.
 *
 * Body: the doc fields, plus `baseEtag?: string | null`, `force?: boolean` and
 * `backup?: 'always'`, split off here so the reader never sees them as unknown doc fields.
 */
function withoutEnvelope(body: unknown): unknown {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
	const {
		baseEtag: _baseEtag,
		force: _force,
		backup: _backup,
		...doc
	} = body as Record<string, unknown>;
	return doc;
}

export const PUT: RequestHandler = async ({ request, url, locals }) => {
	const user = await requireSymbolsAccess(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag = writeBaseEtagJson(body);
	const backup = requestedBackupMode(body);
	const docFields = withoutEnvelope(body);
	try {
		const { doc, etag } = await saveSymbolsDoc(clientKey, projectKey, docFields, baseEtag, backup);
		return json({ clientKey, projectKey, doc, etag });
	} catch (e) {
		// ORDER IS LOAD-BEARING: this branch must precede the catch-all 502 below, which
		// would otherwise swallow a lost CAS into an opaque "Failed to save" with the
		// cause hidden — the exact shape of [[gotcha_publish_502_flowv2_nodes_guard]].
		// `json({error})`, never `error()`.
		if (e instanceof ConflictError) {
			return json(
				{
					error: 'conflict',
					message:
						'Someone else saved these symbols while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		if (e instanceof ZodError) throw error(400, 'Invalid symbols document.');
		throw error(502, 'Failed to save the symbols document.');
	}
};
