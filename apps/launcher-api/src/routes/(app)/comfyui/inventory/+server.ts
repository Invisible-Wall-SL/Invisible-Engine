import { json } from '@sveltejs/kit';
import { requireComfyAccess } from '$lib/server/comfyAccess';
import { fleetInventory } from '$lib/server/comfyInventory';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * What is installed on the pods — the models on the shared Network Volume and the
 * custom-node packs the pod's ComfyUI actually loaded. Same gate as the rest of the
 * /comfyui control endpoints.
 *
 * NOT part of `/comfyui/status`: that one is polled every 5s by every open tab, and a
 * pack listing can cost an `/object_info` scan. This is fetched once on load and on the
 * panel's Refresh button, and served from a 60s cache in between (`?refresh=1` bypasses
 * it). Read-only — it can never start or stop a pod.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireComfyAccess(locals);
	const refresh = url.searchParams.get('refresh') === '1';
	return json(await fleetInventory({ refresh }), { headers: NO_STORE });
};
