import { error, json } from '@sveltejs/kit';
import { getRunpodIdleConfig } from '$lib/server/appSettings';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { getEffectiveFleet, podControlConfigured, podStop, probeFleet } from '$lib/server/runpod';
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

	await podStop(podId);
	const [configured, pods, idle] = await Promise.all([
		podControlConfigured(),
		probeFleet(),
		getRunpodIdleConfig(),
	]);

	return json(
		{
			configured,
			idleEnabled: idle.enabled,
			idleMinutes: idle.minutes,
			pods: pods.map((p) => ({
				id: p.id,
				label: p.label,
				url: p.url,
				status: p.status,
				ready: p.ready,
			})),
		},
		{ headers: NO_STORE },
	);
};
