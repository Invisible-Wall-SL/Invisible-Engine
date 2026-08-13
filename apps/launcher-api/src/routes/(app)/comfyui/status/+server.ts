import { json } from '@sveltejs/kit';
import { getRunpodIdleConfig } from '$lib/server/appSettings';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { comfyReady, podControlConfigured, podStatus } from '$lib/server/runpod';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Live pod state for the /comfyui control panel, polled every ~5s. All fields are
 * non-secret and safe for any user holding the `comfyui` tool. `podStatus`/`comfyReady`
 * short-circuit to their idle values when pod control isn't configured (no RunPod
 * secrets), so the card renders today's "open the URL" landing instead of controls.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);

	const configured = podControlConfigured();
	const [status, ready, idle] = await Promise.all([
		configured ? podStatus() : Promise.resolve('unknown' as const),
		comfyReady(),
		getRunpodIdleConfig(),
	]);

	return json(
		{
			configured,
			podStatus: status,
			comfyReady: ready,
			idleEnabled: idle.enabled,
			idleMinutes: idle.minutes,
		},
		{ headers: NO_STORE },
	);
};
