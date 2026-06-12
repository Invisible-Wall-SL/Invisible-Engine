import { error, json } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { roleHasTool } from '$lib/roles';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { DEFAULT_PROJECT_KEY, projectClientKey } from '$lib/server/projects';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { loadSymbolsDoc, saveSymbolsDoc } from '$lib/server/symbolsStorage';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Authoring endpoints for the Invisible Symbols State Machine (`/symbols`) doc.
 *
 * Session-gated (logged-in + entitled to the `editor` tool, role + per-user
 * overrides applied) — the SAME gate the editor component/template routes use,
 * NOT the deploy-token gate (that is only for the build-time export in S4). The
 * project is a `?project=` request param resolved to its client the same way the
 * read-only `doc` route does (`projectClientKey`, defaulting to the unassigned
 * client), so the doc lands at `<client>/<project>/symbols/symbols.json`.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

async function resolveScope(project: string | null): Promise<{ clientKey: string; projectKey: string }> {
	const projectKey = project || DEFAULT_PROJECT_KEY;
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	return { clientKey, projectKey };
}

/** Read a project's symbols doc (empty valid doc when never authored). */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	try {
		const doc = await loadSymbolsDoc(clientKey, projectKey);
		return json({ clientKey, projectKey, doc });
	} catch {
		throw error(502, 'Failed to load the symbols document.');
	}
};

/** Validate + persist a project's symbols doc to R2. */
export const PUT: RequestHandler = async ({ request, url, locals }) => {
	await gate(locals);
	const { clientKey, projectKey } = await resolveScope(url.searchParams.get('project'));
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	try {
		const doc = await saveSymbolsDoc(clientKey, projectKey, body);
		return json({ clientKey, projectKey, doc });
	} catch (e) {
		if (e instanceof ZodError) throw error(400, 'Invalid symbols document.');
		throw error(502, 'Failed to save the symbols document.');
	}
};
