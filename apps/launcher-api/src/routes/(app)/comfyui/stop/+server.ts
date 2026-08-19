import { error, json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { fleetPayload, getEffectiveFleet, podStop } from '$lib/server/runpod';
import { clearLease } from '$lib/server/runpodActivity';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * STOP a chosen pod (an artist clicked Stop on that pod's row). Body: `{ podId }`.
 * SECURITY: the podId MUST belong to the effective fleet. Returns the fresh fleet.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAccess(locals);

	const body = (await request.json().catch(() => ({}))) as { podId?: unknown };
	const podId = typeof body.podId === 'string' ? body.podId.trim() : '';
	if (!podId) throw error(400, 'Missing podId.');

	const fleet = await getEffectiveFleet();
	if (!fleet.some((p) => p.id === podId)) throw error(400, 'Unknown pod.');

	// An explicit Stop is the artist saying they're done — drop the session lease so a
	// later Start begins on a clean idle countdown instead of inheriting held time.
	clearLease();
	await podStop(podId);

	return json(await fleetPayload(), { headers: NO_STORE });
};
