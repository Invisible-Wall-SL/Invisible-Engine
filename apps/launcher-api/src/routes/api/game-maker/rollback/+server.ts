import { json } from '@sveltejs/kit';
import { OWNER_ROLE } from '$lib/launcherGates';
import { GAME_PUBLISH_CAPABILITY } from '$lib/roles';
import { userHasCapability } from '$lib/server/launcherAuth';
import { UNASSIGNED_CLIENT } from '$lib/server/projectPaths';
import { ConflictError } from '$lib/server/r2';
import { canAccessProject, projectClientKey } from '$lib/server/projects';
import {
	isSnapshotId,
	RollbackRefusedError,
	rollbackSnapshot,
	UnknownSnapshotError,
} from '$lib/server/publishedRuntime';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Point a published game's players back at one of its retained snapshots — Game Maker's
 * "Published versions → Make live". A pointer flip only: nothing is re-assembled, so it takes
 * effect on the next player boot, and rolling forward again is the same call with the newer id.
 * Same gate as Publish (the `gamePublish` capability + project access), since it changes what
 * players see exactly as a publish does — including its flow rule: a version an admin shipped past
 * the flow gate (`flow: 'overridden'`) can be made live again only by the owner role.
 *
 *   POST /api/game-maker/rollback  { "project": "<key>", "snapshot": "<id>" }
 *   → 200 { ok, current, snapshots }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (!(await userHasCapability(locals.user, GAME_PUBLISH_CAPABILITY))) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}
	let body: { project?: unknown; snapshot?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const project = typeof body.project === 'string' ? body.project.trim() : '';
	const snapshot = typeof body.snapshot === 'string' ? body.snapshot : '';
	if (!project || !isSnapshotId(snapshot)) {
		return json({ error: 'Missing project or snapshot.' }, { status: 400, headers: NO_STORE });
	}
	if (!(await canAccessProject(locals.user.id, locals.user.role, project))) {
		return json(
			{ error: 'Unknown project, or you do not have access to it.' },
			{ status: 403, headers: NO_STORE },
		);
	}
	const clientKey = (await projectClientKey(project)) ?? UNASSIGNED_CLIENT;
	try {
		const isOwner = locals.user.role === OWNER_ROLE;
		const pointer = await rollbackSnapshot(clientKey, project, snapshot, (target) =>
			target.flow === 'overridden' && !isOwner
				? 'Only an admin can make a version with flow errors live.'
				: null,
		);
		console.info(`[publish] ${project}: ${locals.user.email} made snapshot ${snapshot} live`);
		return json({ ok: true, ...pointer }, { headers: NO_STORE });
	} catch (e) {
		if (e instanceof UnknownSnapshotError) {
			return json({ error: e.message }, { status: 404, headers: NO_STORE });
		}
		if (e instanceof RollbackRefusedError) {
			return json({ error: e.message }, { status: 403, headers: NO_STORE });
		}
		if (e instanceof ConflictError) {
			return json(
				{ error: 'Someone else changed the published version just now — reload and retry.' },
				{ status: 409, headers: NO_STORE },
			);
		}
		console.error('rollback failed:', e);
		const detail = e instanceof Error ? e.message : String(e);
		return json({ error: `Rollback failed: ${detail}` }, { status: 502, headers: NO_STORE });
	}
};
