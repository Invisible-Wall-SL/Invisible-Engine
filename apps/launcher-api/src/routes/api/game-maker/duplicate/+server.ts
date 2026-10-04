import { json } from '@sveltejs/kit';
import { roleHasTool } from '$lib/roles';
import { duplicateProject } from '$lib/server/duplicateProject';
import type { DuplicateScope } from '$lib/server/projectDuplicate';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Duplicate an existing project onto a new key — the same client (a variant) or a different one (a
 * reskin for another client).
 *
 *   POST /api/game-maker/duplicate
 *     { source, key, name, clientKey?: string | null, scope?: 'setup' | 'full' }
 *   → 200 { ok, key, copied, rebased, skipped }
 *
 * Gated like the page's own "Create a game" action — any holder of the `gameMaker` tool may create
 * a project. Access to the source project and the destination client is checked by
 * `duplicateProject`, which Invisible Director's `gamemaker.create_from_template` shares.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const toolOverrides = await getToolOverrides(locals.user.id);
	if (!roleHasTool(locals.user.role, 'gameMaker', roleOverrides, toolOverrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	let body: {
		source?: unknown;
		key?: unknown;
		name?: unknown;
		clientKey?: unknown;
		scope?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const scope: DuplicateScope = body.scope === 'full' ? 'full' : 'setup';
	const rawClient = typeof body.clientKey === 'string' ? body.clientKey.trim() : '';
	const outcome = await duplicateProject(locals.user, {
		source: typeof body.source === 'string' ? body.source.trim() : '',
		key: typeof body.key === 'string' ? body.key.trim().toLowerCase() : '',
		name: typeof body.name === 'string' ? body.name.trim() : '',
		clientKey: rawClient === '' ? null : rawClient,
		scope,
	});
	if (!outcome.ok) {
		return json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
	}
	return json(outcome, { headers: NO_STORE });
};
