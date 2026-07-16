import { json } from '@sveltejs/kit';
import { listAnimations } from '$lib/server/riggerLibrary';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/**
 * List the cross-project animation library. One GET returns the lightweight catalog
 * rows (no heavy `animation` bodies), sorted by name. Empty array when the library is
 * empty. Gated by `rigger`.
 *
 * The catalog is a Postgres table, not the old `_shared/animations/index.json` blob —
 * the response shape is unchanged. First call after deploy also backfills the legacy
 * blob. See `riggerLibrary.ts`.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
	await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	return json({ animations: await listAnimations() });
};
