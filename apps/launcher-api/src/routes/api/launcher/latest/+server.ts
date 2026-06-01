import { getObjectText } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const MANIFEST_KEY = 'tools/invisible-launcher/latest.json';

// Unauthenticated: the desktop launcher polls this to self-update; it has no portal session.
export const GET: RequestHandler = async () => {
	const text = await getObjectText(MANIFEST_KEY);
	if (text === null) {
		return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
	}

	return new Response(text, {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
