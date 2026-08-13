import { json } from '@sveltejs/kit';
import { getRunpodIdleConfig } from '$lib/server/appSettings';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { comfyReady, podControlConfigured, podStatus, podStop } from '$lib/server/runpod';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/** STOP the pod (an artist clicked Stop pod). Returns the fresh status. */
export const POST: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);

	await podStop();
	const [status, ready, idle] = await Promise.all([
		podControlConfigured() ? podStatus() : Promise.resolve('unknown' as const),
		comfyReady(),
		getRunpodIdleConfig(),
	]);

	return json(
		{
			configured: podControlConfigured(),
			podStatus: status,
			comfyReady: ready,
			idleEnabled: idle.enabled,
			idleMinutes: idle.minutes,
		},
		{ headers: NO_STORE },
	);
};
