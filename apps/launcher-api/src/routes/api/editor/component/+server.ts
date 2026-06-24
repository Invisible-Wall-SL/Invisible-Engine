import { error, json } from '@sveltejs/kit';
import type { ComponentDef } from 'engine-layout';
import { COMPONENT_PUBLISH_CAPABILITY, roleHasCapability, roleHasTool } from '$lib/roles';
import { deleteComponent, loadComponent, saveComponent } from '$lib/server/componentStorage';
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

/**
 * Extra gate for WRITES/DELETES that target the SHARED component library
 * (`_shared/editor-components/`). Project-scoped saves stay under the `editor`
 * tool gate above; promoting a component repo-wide additionally requires the
 * `componentPublish` capability (default-ON for admin only) — mirroring the
 * shared-font / blueprint publish gates. The `editor` tool gate alone is NOT a
 * shared-write gate.
 */
async function gateSharedWrite(locals: App.Locals): Promise<void> {
	const user = locals.user;
	if (!user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(user.role);
	const overrides = await getToolOverrides(user.id);
	if (!roleHasCapability(user.role, COMPONENT_PUBLISH_CAPABILITY, roleOverrides, overrides)) {
		throw error(403, 'Your role cannot publish to the shared component library.');
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
	// A `scope:'shared'` def writes the repo-wide `_shared/editor-components/` key —
	// gate it on `componentPublish` before persisting. A `scope:'project'` save (the
	// common case) needs only the `editor` tool gate already applied above.
	if (isRecord(body) && body.scope === 'shared') {
		await gateSharedWrite(locals);
	}
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

/** Delete a component from its scope's R2 key (project shadow or shared library). */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const projectKey = url.searchParams.get('project') || undefined;
	const scopeParam = url.searchParams.get('scope');
	const scope =
		scopeParam === 'shared' || scopeParam === 'project'
			? scopeParam
			: projectKey
				? 'project'
				: 'shared';
	// Deleting from the shared library is a repo-wide write — gate it identically
	// to a shared save. A project delete needs only the `editor` tool gate above.
	if (scope === 'shared') {
		await gateSharedWrite(locals);
	}
	try {
		await deleteComponent(id, scope, projectKey);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid delete.');
	}
	return json({ ok: true });
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
