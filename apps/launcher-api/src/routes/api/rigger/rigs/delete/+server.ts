import { error, json } from '@sveltejs/kit';
import { r2Slug, sharedRigKey } from '$lib/server/projectPaths';
import { deleteObject } from '$lib/server/r2';
import { deleteRig } from '$lib/server/riggerLibrary';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * Remove one rig-library entry: drop its Postgres catalog row and delete
 * `_shared/rigs/<id>.json`. Gated by `rigger`; id path-guarded via `r2Slug`.
 * Body: `{ id }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');
	const id = r2Slug(typeof body.id === 'string' ? body.id : '');
	if (!id || id.includes('..') || id.includes('/')) throw error(400, 'bad id');

	// Row BEFORE blob: a failure between the two leaves an orphaned blob (invisible,
	// garbage-collectable) rather than a catalog row whose body is already gone —
	// which would 404 in the user's face on the next click.
	await deleteRig(id);
	await deleteObject(sharedRigKey(id));

	return json({ ok: true });
};
