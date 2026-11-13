import { getGame } from '$lib/server/games';
import { partnerSharePage, partnerShareStartPage } from '$lib/server/partnerRefusal';
import { openShareLink, peekShareLink, SHARE_REFUSAL_TEXT } from '$lib/server/partnerShare';
import type { RequestHandler } from './$types';

/**
 * A PARTNER SHARE LINK — public, no launcher login (`$lib/server/partnerShare.ts`).
 *
 *   GET  /play/<token>  → a live link: a page that POSTs itself back at once (and a Play button)
 *                       → otherwise a plain page: not found (404), revoked / expired (410)
 *   POST /play/<token>  → 303 to the published game on the partner RGS, with a FRESH session
 *                       → a plain refusal page (429 + Retry-After once a link's per-minute opens
 *                         are spent)
 *
 * Only the POST mints. A chat app unfurling a pasted link fetches it with GET and runs no script,
 * so a preview spends neither a partner session nor the link's opens.
 */

const HTML = { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' };

export const GET: RequestHandler = async ({ params }) => {
	const peek = await peekShareLink(params.token);
	if (!peek.ok) {
		const text = SHARE_REFUSAL_TEXT[peek.refusal];
		return new Response(partnerSharePage(text), { status: text.status, headers: HTML });
	}
	const game = await getGame(peek.link.projectKey);
	return new Response(partnerShareStartPage({ gameName: game?.name ?? 'Game' }), {
		headers: HTML,
	});
};

export const POST: RequestHandler = async ({ params }) => {
	const opened = await openShareLink(params.token);
	if (opened.ok) {
		return new Response(null, {
			status: 303,
			headers: { location: opened.url, 'cache-control': 'no-store' },
		});
	}
	return new Response(partnerSharePage(opened), {
		status: opened.status,
		headers: {
			...HTML,
			...(opened.retryAfterSeconds ? { 'retry-after': String(opened.retryAfterSeconds) } : {}),
		},
	});
};
