import { json, redirect } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { getGame } from '$lib/server/games';
import {
	PartnerRgsError,
	mintPartnerSession,
	partnerLaunchUrl,
	partnerRgsConfig,
} from '$lib/server/partnerRgs';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Launch a published game against a PARTNER RGS.
 *
 *   GET /api/partner-session?key=<gameKey>&profile=<profileId>[&game=<partnerGameId>]
 *   → 302 to the game, carrying `?rgs_profile=…&<sessionParam>=<freshly minted token>`
 *   → 302 …&json=1 returns `{ url, token, gameName }` instead, for scripting
 *
 * This exists so a game card can point at a partner without any credential reaching a browser. The
 * partner's session endpoint is an admin one (user + password, and it will mint for ANY player id),
 * so the launcher holds those, mints on the signed-in user's behalf, and hands the game only the
 * token. See `partnerRgs.ts`.
 *
 * The redirect target is NOT caller-supplied — it is the game's own stored card URL, looked up by
 * key and rewritten. A `?to=` would be an open redirect on an authenticated endpoint, and rewriting
 * the card also means `runtime=1`, `project` and the read token `k` carry over exactly as
 * `publishGame` wrote them.
 *
 * Every launch mints a FRESH session. That is the point rather than a cost: a partner session
 * carries an open round and a wallet, and re-entering a stale one is how two tabs end up fighting
 * over the same round.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });

	const key = url.searchParams.get('key')?.trim() ?? '';
	const profileId = url.searchParams.get('profile')?.trim() ?? '';
	const gameId = url.searchParams.get('game')?.trim() || undefined;
	const wantsJson = url.searchParams.get('json') === '1';

	if (!key || !profileId) {
		return json(
			{ error: 'Both ?key= (the launcher game key) and ?profile= (the delivery profile) are required' }, // prettier-ignore
			{ status: 400, headers: NO_STORE },
		);
	}

	const game = await getGame(key);
	if (!game) {
		return json({ error: `No game card for key "${key}"` }, { status: 404, headers: NO_STORE });
	}

	// Minting is the only fallible step, so it is the only thing inside the catch. `redirect()`
	// signals by THROWING, so calling it in here would be caught by our own handler.
	let minted: { url: string; token: string; gameName: string };
	try {
		const config = partnerRgsConfig(ENV.PARTNER_RGS, profileId);
		const { token, gameName } = await mintPartnerSession({
			config,
			profileId,
			userId: locals.user.id,
			gameId,
		});
		minted = {
			url: partnerLaunchUrl({
				cardUrl: game.url,
				profileId,
				token,
				sessionParam: config.sessionParam ?? 'sid',
				// The launcher's click-time params (`ie_authoring`, locale, …) arrive on THIS request
				// rather than on the game, so carry them across or a partner card silently loses them.
				from: url.searchParams,
			}),
			token,
			gameName,
		};
	} catch (error) {
		if (error instanceof PartnerRgsError) {
			return json({ error: error.message }, { status: error.status, headers: NO_STORE });
		}
		throw error;
	}

	if (wantsJson) return json(minted, { headers: NO_STORE });
	redirect(302, minted.url);
};
