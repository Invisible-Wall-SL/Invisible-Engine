import { json } from '@sveltejs/kit';
import { requireComfyAdmin } from '$lib/server/comfyAdmin';
import { volumeView } from '$lib/server/volumeModels';
import type { RequestHandler } from './$types';

/**
 * The Network Volume's model files for the "What's installed" panel, read through the volume's
 * S3 API (no pod). Admin-only, like every action on it. `?refresh=1` starts a fresh read in the
 * background and answers with the last one meanwhile; the page polls while `refreshing`.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	await requireComfyAdmin(locals);
	const view = await volumeView({ refresh: url.searchParams.get('refresh') === '1' });
	return json(view, { headers: { 'cache-control': 'no-store' } });
};
