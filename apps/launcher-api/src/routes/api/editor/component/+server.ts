import { error, json } from '@sveltejs/kit';
import type { ComponentDef } from 'engine-layout';
import { roleHasTool } from '$lib/roles';
import { loadComponent, saveComponent } from '$lib/server/componentStorage';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

/**
 * Auth + role gate matching the editor template route: logged-in and entitled to
 * the `editor` tool (role + per-user overrides applied). Components are keyed by
 * scope (`_shared/` or `editor/<projectKey>/`), so the project, when given, is a
 * request param — there is no session-bound project scope here, exactly like the
 * template route.
 */
async function gate(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'editor', roleOverrides, overrides)) {
		throw error(403, 'Your role does not have access to Invisible Editor.');
	}
}

/** Persist an authored component to its scope's R2 key (§8.3). */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const projectKey =
		isRecord(body) && typeof body.project === 'string' ? body.project : undefined;
	try {
		await saveComponent(body as ComponentDef, projectKey);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid component.');
	}
	return json({ ok: true });
};

/** Resolve a component for `?id=` (project shadows shared when `?project=` given). */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const projectKey = url.searchParams.get('project') || undefined;
	const component = await loadComponent(id, projectKey);
	if (!component) throw error(404, 'not found');
	return json(component);
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
