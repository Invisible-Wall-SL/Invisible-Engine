import { error } from '@sveltejs/kit';
import { requireAtlasAccess } from '$lib/server/atlas';
import { getObjectBytes } from '$lib/server/r2';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireAtlasAccess(locals);
	const key = url.searchParams.get('key') ?? '';
	if (!key.startsWith('atlas_maker/') && !key.startsWith('atlas/')) {
		throw error(400, 'invalid key');
	}
	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');
	return new Response(obj.body, {
		headers: { 'content-type': obj.contentType, 'cache-control': 'no-store' },
	});
};
