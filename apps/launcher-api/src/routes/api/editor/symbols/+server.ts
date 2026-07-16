import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { roleHasTool } from '$lib/roles';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { ConflictError, jsonBaseEtag } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadSymbolsDocWithEtag, saveSymbolsDoc } from '$lib/server/symbolsStorage';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Symbols State Machine (`/symbols`) doc.
 *
 * Session-gated (logged-in + entitled to the `symbols` tool, role + per-user
 * overrides applied) — the SAME entitlement gate the `/symbols` page uses, NOT
 * the deploy-token gate (that is only for the build-time export in S4). The
 * project is a `?project=` request param resolved to its client the same way the
 * read-only `doc` route does (`projectClientKey`, defaulting to the unassigned
 * client), so the doc lands at `<client>/<project>/symbols/symbols.json`.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'symbols', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to the Invisible Symbols State Machine.');
	}
}

async function resolveScope(
	project: string | null,
): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/** Read a project's symbols doc (empty valid doc when never authored) + its ETag. */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
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
 * is the author's explicit "overwrite theirs".
 *
 * Body: the doc fields, plus `baseEtag?: string | null` and `force?: boolean`.
 */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const baseEtag =
		isRecord(body) && body.force === true
			? undefined
			: jsonBaseEtag(isRecord(body) ? body.baseEtag : undefined);
	try {
		const { doc, etag } = await saveSymbolsDoc(clientKey, projectKey, body, baseEtag);
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

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
