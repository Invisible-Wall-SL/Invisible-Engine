import { json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { grantLease, markActivity } from '$lib/server/runpodActivity';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Tab heartbeat: while a /comfyui tab is visible it pings this every ~60s to keep the
 * pod alive (resets the idle countdown). Cheap and side-effect-only.
 *
 * `{ lease: true }` additionally takes a session lease — sent when the artist opens
 * ComfyUI itself, because from that moment they're in another tab and the heartbeat
 * above goes silent (see `runpodActivity`).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAccess(locals);

	let lease = false;
	try {
		const body = (await request.json()) as { lease?: unknown };
		lease = body?.lease === true;
	} catch {
		// No body / not JSON — a plain heartbeat.
	}

	if (lease) grantLease();
	else markActivity();

	return json({ ok: true }, { headers: NO_STORE });
};
