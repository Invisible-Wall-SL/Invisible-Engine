import { json } from '@sveltejs/kit';
import { getRunpodIdleConfig } from '$lib/server/appSettings';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { podControlConfigured, probeFleet } from '$lib/server/runpod';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Live fleet state for the /comfyui control panel, polled every ~5s. All fields are
 * non-secret and safe for any user holding the `comfyui` tool. Each pod is probed
 * concurrently (`probeFleet`), resilient to a single pod hanging.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);

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
