import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { VolumeActionError, cancelTransfer, startTransfer } from '$lib/server/volumeModels';
import { uploadTargetError } from '$lib/volumeModels';
import type { RequestHandler } from './$types';

/**
 * Copy a file onto the volume: `{ source, folder, path, mirror }`, where `source` is an R2 mirror
 * key (restore / a finished browser upload) or a public https URL (e.g. Hugging Face).
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = await requireComfyAdmin(locals);
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const source = typeof body?.source === 'string' ? body.source.trim() : '';
	const folder = typeof body?.folder === 'string' ? body.folder.trim() : '';
	const path = typeof body?.path === 'string' ? body.path.trim() : '';
	const bad = uploadTargetError(folder, path);
	if (bad) return json({ error: bad }, { status: 400 });
	try {
		const job = await startTransfer(
			{ source, folder, path, mirror: body?.mirror === true },
			user.email,
		);
		return json({ job });
	} catch (e) {
		if (e instanceof VolumeActionError) return json({ error: e.message }, { status: e.status });
		console.error('[volume-models] transfer refused:', e);
		return json({ error: 'The transfer could not start — see the launcher log.' }, { status: 502 });
	}
};

/** Cancel a running transfer (`?id=`); its partial upload is aborted on the volume. */
export const DELETE: RequestHandler = async ({ locals, url }) => {
	await requireComfyAdmin(locals);
	const ok = cancelTransfer(url.searchParams.get('id') ?? '');
	return json({ ok }, { status: ok ? 200 : 404 });
};
