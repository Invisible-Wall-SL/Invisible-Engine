import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { setKeep } from '$lib/server/volumeModels';
import { toVolumeFile } from '$lib/volumeModels';
import type { RequestHandler } from './$types';

/** Mark a file Keep (`{ key, note }`) or clear it (`{ key, note: null }`). */
export const POST: RequestHandler = async ({ locals, request }) => {
	await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const key = typeof body?.key === 'string' ? body.key : '';
	if (!toVolumeFile({ key, size: 0, modified: null })) {
		return json({ error: 'That is not a model file on the volume.' }, { status: 400 });
	}
	const note = typeof body?.note === 'string' ? body.note : null;
	await setKeep(key, note, locals.user!.id);
	return json({ ok: true });
};
