import { error, json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { fleetPayload, getEffectiveFleet, podResume } from '$lib/server/runpod';
import { markActivity } from '$lib/server/runpodActivity';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * RESUME a chosen pod (an artist clicked Start on that pod's row). Body: `{ podId }`.
 * SECURITY: the podId MUST belong to the effective fleet — we never let a request drive
 * an arbitrary RunPod pod via our shared API key. Records activity first so the idle
 * watchdog doesn't immediately re-stop it, then resumes. Returns the fresh fleet plus
 * any `error` (e.g. "not enough free GPUs") so the card can show it inline with a retry.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAccess(locals);

	const body = (await request.json().catch(() => ({}))) as { podId?: unknown };
	const podId = typeof body.podId === 'string' ? body.podId.trim() : '';
	if (!podId) throw error(400, 'Missing podId.');

	const fleet = await getEffectiveFleet();
	if (!fleet.some((p) => p.id === podId)) throw error(400, 'Unknown pod.');

	markActivity();
	const resume = await podResume(podId);

	return json(
		{
			...(await fleetPayload()),
			podId,
			error: resume.ok ? undefined : resume.error,
		},
		{ headers: NO_STORE },
	);
};
