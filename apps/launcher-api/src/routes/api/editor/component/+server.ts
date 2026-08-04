import { error, json } from '@sveltejs/kit';
import type { ComponentDef } from 'engine-layout';
import { COMPONENT_PUBLISH_CAPABILITY, roleHasCapability, roleHasTool } from '$lib/roles';
import {
	ComponentValidationError,
	deleteComponent,
	listComponentVersions,
	loadComponent,
	loadComponentWithEtag,
	saveComponent,
} from '$lib/server/componentStorage';
import { ConflictError } from '$lib/server/r2';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
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

/**
 * Persist an authored component to its scope's R2 key (§8.3).
 *
 * Guarded: a stale `baseEtag` answers **409** instead of discarding a concurrent
 * author's def (and silently rewriting the `.v<N>.json` snapshot an instance may have
 * pinned). `force: true` is the author's explicit "overwrite theirs". Returns the
 * RECONCILED `version` + the new `etag` — the old `{ok:true}` told the client nothing,
 * so it could not even learn what version its own save produced.
 *
 * Body: the `ComponentDef`, plus `project?`, `baseEtag?: string | null`, `force?`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	await gate(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const projectKey = isRecord(body) && typeof body.project === 'string' ? body.project : undefined;
	// A `scope:'shared'` def writes the repo-wide `_shared/editor-components/` key —
	// gate it on `componentPublish` before persisting. A `scope:'project'` save (the
	// common case) needs only the `editor` tool gate already applied above.
	if (isRecord(body) && body.scope === 'shared') {
		await gateSharedWrite(locals);
	}
	// `force` = the author answering the conflict with "overwrite theirs". Note what that
	// does here, because it is NOT the unconditional write it is elsewhere: `force` makes
	// `writeBaseEtagJson` return `undefined`, and `saveComponent` then falls back to the ETag
	// of its OWN read — i.e. CAS against the CURRENT object. That is strictly safer than a raw
	// overwrite (it still refuses if a third save lands mid-request) and is the honest meaning
	// of "overwrite what's there now". A non-force save now MUST carry `baseEtag` (string or
	// null) or it is a 400 — the fail-open is closed (Phase 1).
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { version, etag } = await saveComponent(body as ComponentDef, projectKey, baseEtag);
		return json({ ok: true, version, etag });
	} catch (e) {
		// Conflict before the generic 400 — a lost CAS is not a malformed component.
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved this component while you were editing it. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		// Only a bad PAYLOAD is a 400. A storage failure reaching here used to answer 400
		// "Invalid component" with the SDK's message — a client-error status for a
		// server-side outage, telling the author to fix a component that was never broken.
		if (e instanceof ComponentValidationError) throw error(400, e.message);
		console.error('[component] save failed:', e);
		throw error(502, 'Could not save the component — storage is unavailable. Please retry.');
	}
};

/**
 * Resolve a component for `?id=` (project shadows shared when `?project=` given).
 * An optional `?version=<N>` resolves the EXACT historical snapshot from the v2
 * multi-version store (§8.9) — e.g. for the editor to preview/re-pin an older
 * version; omitted resolves the latest pointer exactly as before (back-compat).
 *
 * `?list=versions&scope=<shared|project>` instead enumerates the component's
 * retained `<id>.v<N>.json` snapshots (the version-browser feed, §8.9) — a
 * read-only listing the library queries deliberately exclude. Same `editor` tool
 * gate; never mutates R2.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	await gate(locals);
	const id = url.searchParams.get('id');
	if (!id) throw error(400, 'missing id');
	const projectKey = url.searchParams.get('project') || undefined;
	if (url.searchParams.get('list') === 'versions') {
		// Resolve the scope to list history for: explicit `?scope=`, else `project` when a
		// `?project=` is present (its own history), else the shared library.
		const scopeParam = url.searchParams.get('scope');
		const scope =
			scopeParam === 'shared' || scopeParam === 'project'
				? scopeParam
				: projectKey
					? 'project'
					: 'shared';
		try {
			return json(await listComponentVersions(id, scope, projectKey));
		} catch (e) {
			throw error(400, e instanceof Error ? e.message : 'Invalid version list.');
		}
	}
	const versionParam = url.searchParams.get('version');
	const version =
		versionParam && Number.isInteger(Number(versionParam)) && Number(versionParam) >= 1
			? Number(versionParam)
			: undefined;
	// A PINNED-version read (the version browser's inspect) returns the raw immutable
	// snapshot — read-only, never the next save's base, so it carries no etag (back-compat).
	if (version !== undefined) {
		const snapshot = await loadComponent(id, projectKey, version);
		if (!snapshot) throw error(404, 'not found');
		return json(snapshot);
	}
	// The LATEST editable read carries its ETag — the precondition the editor sends back on
	// save (Phase 1). `{ def, etag }`, distinct from the versioned shape above. `etag: null`
	// ⇒ the def is a built-in with no stored object, so the first save creates it.
	let resolved: Awaited<ReturnType<typeof loadComponentWithEtag>>;
	try {
		resolved = await loadComponentWithEtag(id, projectKey);
	} catch {
		throw error(502, 'Could not read the component — storage is unavailable. Please retry.');
	}
	if (!resolved) throw error(404, 'not found');
	return json({ def: resolved.def, etag: resolved.etag });
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
