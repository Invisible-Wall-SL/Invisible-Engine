import { error, json } from '@sveltejs/kit';
import {
	ConflictError,
	listComponentDefaults,
	loadComponentDefaultsWithEtag,
	saveComponentDefaults,
} from '$lib/server/componentDefaultsStorage';
import { requestedBackupMode } from '$lib/server/docBackupRoutes';
import { requireEditorAccess } from '$lib/server/editorAccess';
import { requireOptionalProjectKey } from '$lib/server/toolScope';
import { writeBaseEtagJson } from '$lib/server/writeGuard';
import type { RequestHandler } from './$types';

/*
 * Gated on the `editor` tool (`requireEditorAccess`, shared with the `backups` history route).
 * Defaults are keyed by project
 * (`editor/<projectKey>/component-defaults/`), so the project is a request param — there is no
 * session-bound project scope here, exactly like the component route — and
 * `requireOptionalProjectKey` 403s one the user cannot access.
 */

/**
 * Read the per-project component defaults (§13.3). `?project=&id=` → `{ params }`
 * for that component (`{ params: {} }` when absent — defaults are an empty map, not
 * a 404). `?project=` with no `id` → the full `componentId → params` map for the
 * project, used once to hydrate the page.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const user = await requireEditorAccess(locals);
	const project = await requireOptionalProjectKey(user, url.searchParams.get('project'));
	if (!project) throw error(400, 'missing project');
	const id = url.searchParams.get('id');
	if (!id) {
		const defaults = await listComponentDefaults(project);
		return json({ defaults });
	}
	// `{ params, etag }` — the etag is the precondition the client sends back on save (Phase 1).
	const { params, etag } = await loadComponentDefaultsWithEtag(project, id);
	return json({ params, etag });
};

/**
 * Persist a component's per-project param defaults to its sidecar R2 key (§13.3).
 *
 * Guarded by `baseEtag` (Phase 1 of `docs/design/multi-user-concurrency.md`): a stale one
 * answers **409** rather than erasing a concurrent author's defaults. The precondition is
 * REQUIRED — a save that omits it (and is not a `force` overwrite) is a 400.
 *
 * Body: `{ project, id, params, baseEtag: string | null }` (or `force: true`).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = await requireEditorAccess(locals);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	if (!isRecord(body)) throw error(400, 'Body must be an object.');
	const { id, params } = body;
	const project = await requireOptionalProjectKey(
		user,
		typeof body.project === 'string' ? body.project : undefined,
	);
	if (!project) throw error(400, 'missing project');
	if (typeof id !== 'string' || !id) throw error(400, 'missing id');
	if (!isRecord(params)) throw error(400, '`params` must be a plain object.');
	const baseEtag = writeBaseEtagJson(body);
	try {
		const { etag } = await saveComponentDefaults(
			project,
			id,
			params,
			baseEtag,
			requestedBackupMode(body),
		);
		return json({ ok: true, etag });
	} catch (e) {
		// A lost CAS is a 409, never an opaque failure. `params` was validated above, so anything
		// else is storage — the HEAD/COPY of the backup or the PUT — and a retryable 502.
		if (e instanceof ConflictError) {
			return json(
				{
					ok: false,
					error: 'conflict',
					message:
						'Someone else saved these component defaults while you were editing. ' +
						'Your changes are still here — reload to get their version first.',
				},
				{ status: 409 },
			);
		}
		console.error('[component-defaults] save failed:', e);
		throw error(502, 'Could not save these defaults — storage is unavailable. Please retry.');
	}
};

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
