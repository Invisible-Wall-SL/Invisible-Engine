import { getGame } from '$lib/server/games';
import { captureGoRefusalPage, resolveCaptureGo } from '$lib/server/profiler/go';
import type { RequestHandler } from './$types';

/**
 * A capture GO link — public, no launcher login: the capture token in the path is the authority
 * (`$lib/server/profiler/go.ts`). 302 to the capture link; a plain page saying why otherwise.
 */
export const GET: RequestHandler = async ({ params }) => {
	const result = await resolveCaptureGo(params.link, params.token, { gameOf: getGame });
	const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
	if (result.ok) {
		return new Response(null, { status: 302, headers: { ...headers, location: result.url } });
	}
	return new Response(captureGoRefusalPage(result.why), {
		status: result.status,
		headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
	});
};
