import { error } from '@sveltejs/kit';
import { assertAllowed, gate } from '$lib/server/ftpScope';
import { getObjectBytes } from '$lib/server/r2';
import { userContentHeaders } from '$lib/server/userContent';
import type { RequestHandler } from './$types';

/** Auth-gated, scope-validated streamer that forces a download (attachment). */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const scope = await gate(locals, cookies);

	const key = url.searchParams.get('key');
	if (!key) throw error(400, 'missing key');
	assertAllowed(key, scope);

	const obj = await getObjectBytes(key);
	if (!obj) throw error(404, 'not found');

	return new Response(obj.body, {
		headers: { ...userContentHeaders(key, { download: true }), 'cache-control': 'no-store' },
	});
};
