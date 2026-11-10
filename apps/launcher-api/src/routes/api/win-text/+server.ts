import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { conflictResponse } from '$lib/server/conflict';
import { objectOrNull, readJson, requireTool } from '$lib/server/http';
import { requireProjectScope } from '$lib/server/toolScope';
import { loadWinTextDocWithEtag, saveWinTextDoc } from '$lib/server/winTextStorage';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Win Text (`/win-text`) doc.
 *
 * Session-gated (logged-in + entitled to the `winText` tool, role + per-user overrides applied)
 * — the SAME entitlement gate the `/win-text` page uses, NOT the deploy-token gate (that is the
 * sibling `doc` route, for the build-time bake) — then scoped by `requireProjectScope`, which 403s
 * a `?project=` the user cannot access. REST rather than form actions because the client is a rich
 * `$state` doc, mirroring `/api/editor/symbols`.
 *
 * See `docs/design/invisible-win-text.md`.
 */
const gate = (locals: App.Locals) => requireTool(locals, 'winText', 'Invisible Win Text');

/** Read a project's win-text doc + its ETag (empty valid doc when never authored). The ETag is
 *  the precondition the client sends back on save. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	try {
		const { doc, etag } = await loadWinTextDocWithEtag(clientKey, projectKey);
		return json({ clientKey, projectKey, doc, etag });
	} catch {
		throw error(502, 'Failed to load the win-text document.');
	}
};

/**
 * Validate + persist a project's win-text doc to R2.
 *
 * Body: `{ doc, baseEtag?, force? }` — mirrors `/api/flow-v2/save`. `baseEtag` is the ETag the
 * client loaded; the write is conditional on it, so two authors on one project can't silently
 * clobber each other's whole doc. `force: true` drops the precondition ("overwrite with mine").
 * A body with neither `baseEtag` nor `force` is refused with a 400 (`writeBaseEtagJson`).
 */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	const user = await gate(locals);
	const { clientKey, projectKey } = await requireProjectScope(
		user,
		url.searchParams.get('project'),
	);
	const body = objectOrNull(await readJson(request, 'Invalid JSON body.'));
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { doc, etag } = await saveWinTextDoc(clientKey, projectKey, body?.doc, baseEtag);
		return json({ clientKey, projectKey, doc, etag });
	} catch (e) {
		// Before the catch-all below, which would answer a lost race as a 502.
		const conflict = conflictResponse(
			e,
			'Someone else saved this win text while you were editing. ' +
				'Your changes are still here — reload to get their version first.',
		);
		if (conflict) return conflict;
		if (e instanceof ZodError) throw error(400, 'Invalid win-text document.');
		throw error(502, 'Failed to save the win-text document.');
	}
};
