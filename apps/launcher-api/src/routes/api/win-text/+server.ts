import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { roleHasTool } from '$lib/roles';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { ConflictError } from '$lib/server/r2';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { loadWinTextDocWithEtag, saveWinTextDoc } from '$lib/server/winTextStorage';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Win Text (`/win-text`) doc.
 *
 * Session-gated (logged-in + entitled to the `winText` tool, role + per-user overrides applied)
 * — the SAME entitlement gate the `/win-text` page uses, NOT the deploy-token gate (that is the
 * sibling `doc` route, for the build-time bake). REST rather than form actions because the
 * client is a rich `$state` doc, mirroring `/api/editor/symbols`.
 *
 * See `docs/design/invisible-win-text.md`.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'winText', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Win Text.');
	}
}

async function resolveScope(
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/** Read a project's win-text doc + its ETag (empty valid doc when never authored). The ETag is
 *  the precondition the client sends back on save. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
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
 * An absent `baseEtag` writes unconditionally, so an older client still saves rather than 409s.
 */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	let body: { doc?: unknown; baseEtag?: unknown; force?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { doc, etag } = await saveWinTextDoc(clientKey, projectKey, body.doc, baseEtag);
		return json({ clientKey, projectKey, doc, etag });
	} catch (e) {
		if (e instanceof ConflictError) {
			// `json({error})`, never `error()` — the latter surfaces as an opaque 502 and hides the
			// cause. This branch MUST precede the catch-all below for that reason.
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this win text while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		if (e instanceof ZodError) throw error(400, 'Invalid win-text document.');
		throw error(502, 'Failed to save the win-text document.');
	}
};
