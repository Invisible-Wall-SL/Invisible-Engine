import { json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { fleetPayload } from '$lib/server/runpod';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Live fleet state for the /comfyui control panel, polled every ~5s. All fields are
 * non-secret and safe for any user holding the `comfyui` tool. Each pod is probed
 * concurrently (`probeFleet`), resilient to a single pod hanging.
 */
export const GET: RequestHandler = async ({ locals }) => {
	await requireComfyAccess(locals);
	return json(await fleetPayload(), { headers: NO_STORE });
};
