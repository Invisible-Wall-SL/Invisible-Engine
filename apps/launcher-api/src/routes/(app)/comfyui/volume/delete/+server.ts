import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { VolumeActionError, deleteFromVolume } from '$lib/server/volumeModels';
import type { RequestHandler } from './$types';

/**
 * Delete one model file from the volume — `{ key, confirmBlueprints, confirmKeep, alsoMirror }`.
 * The server re-checks who uses the file and refuses unless `confirmBlueprints` names every one.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const key = typeof body?.key === 'string' ? body.key : '';
	const confirmBlueprints = Array.isArray(body?.confirmBlueprints)
		? body.confirmBlueprints.filter((x): x is string => typeof x === 'string')
		: [];
	try {
		await deleteFromVolume(
			{
				key,
				confirmBlueprints,
				confirmKeep: body?.confirmKeep === true,
				alsoMirror: body?.alsoMirror === true,
			},
			locals.user?.email ?? 'admin',
		);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof VolumeActionError) return json({ error: e.message }, { status: e.status });
		console.error('[volume-models] delete failed:', e);
		return json({ error: 'The delete failed — see the launcher log.' }, { status: 502 });
	}
};
