import { json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { markActivity } from '$lib/server/runpodActivity';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Tab heartbeat: while a /comfyui tab is visible it pings this every ~60s to keep the
 * pod alive (resets the idle countdown). Cheap and side-effect-only.
 */
export const POST: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);
	markActivity();
	return json({ ok: true }, { headers: NO_STORE });
};
