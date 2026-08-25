import { error, json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { imageForSha, podImageState, setPodImage } from '$lib/server/podImage';
import { fleetPayload, getEffectiveFleet, podStatus } from '$lib/server/runpod';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/** The podId must be one of OURS — never let a request drive an arbitrary pod on our key. */
async function requireFleetPod(podId: string): Promise<void> {
	const fleet = await getEffectiveFleet();
	if (!fleet.some((p) => p.id === podId)) throw error(400, 'Unknown pod.');
}

function bodyPodId(body: { podId?: unknown }): string {
	const podId = typeof body.podId === 'string' ? body.podId.trim() : '';
	if (!podId) throw error(400, 'Missing podId.');
	return podId;
}

/**
 * INSPECT a pod's image + the config an image change could disturb. Pure read, and the
 * first half of the two-step the UI walks an admin through.
 *
 * It exists because RunPod's REST API had never been called from here: this proves the base
 * URL, the auth and the field names with a request that cannot break anything.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireComfyAdmin(locals);
	const podId = (url.searchParams.get('podId') ?? '').trim();
	if (!podId) throw error(400, 'Missing podId.');
	await requireFleetPod(podId);
	return json(await podImageState(podId), { headers: NO_STORE });
};

/**
 * MOVE a pod onto an image (`{ podId, sha }` — the immutable `:<sha>` tag CI pushes, never
 * `:latest`, so "which build is this pod on" stays answerable).
 *
 * Two refusals worth knowing about:
 * - **Only a STOPPED pod.** RunPod documents this as "potentially triggering a reset", so on
 *   a running pod it would kill an artist's session mid-render. Stop it first, deliberately.
 * - The pod must be in our fleet.
 *
 * Answers with the pod's config BEFORE and AFTER, not just "ok". `setPodImage` reads the pod,
 * patches only `imageName`, then reads back — so the response can show that the ports and the
 * volume mount are untouched rather than asserting it. That is the whole reason this is safe
 * to ship without ever having called the endpoint before.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);

	const body = (await request.json().catch(() => ({}))) as { podId?: unknown; sha?: unknown };
	const podId = bodyPodId(body);
	const sha = typeof body.sha === 'string' ? body.sha.trim() : '';
	if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw error(400, 'Expected a commit sha to move to.');
	await requireFleetPod(podId);

	const status = await podStatus(podId);
	if (status === 'running' || status === 'starting') {
		throw error(409, 'Stop this pod first — changing its image resets the container.');
	}

	const result = await setPodImage(podId, imageForSha(sha));
	return json(
		{ ...result, fleet: await fleetPayload() },
		{ status: result.ok ? 200 : 502, headers: NO_STORE },
	);
};
