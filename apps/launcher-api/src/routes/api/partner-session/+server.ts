import { isHttpError, json, redirect } from '@sveltejs/kit';
import { resolvePartnerLaunch } from '$lib/partnerLaunch';
import { ENV } from '$lib/server/env';
import { partnerRgsRefusal } from '$lib/server/familyGate';
import { loadGameConfigDoc } from '$lib/server/gameConfigStorage';
import { getGame } from '$lib/server/games';
import { canAccessProject, getPartnerLaunch } from '$lib/server/projects';
import { assertAlias, assertVersionPath, listSealedVersions } from '$lib/server/partnerDelivery';
import { partnerRefusalPage } from '$lib/server/partnerRefusal';
import {
	PartnerRgsError,
	mintPartnerSession,
	partnerLaunchUrl,
	partnerProfileIds,
	partnerRgsConfig,
} from '$lib/server/partnerRgs';
import { clientKeyOf } from '$lib/server/projectLookup';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Launch a published game against a PARTNER RGS.
 *
 *   GET /api/partner-session?key=<gameKey>[&profile=<profileId>][&game=<partnerGameId>][&player=<id>]
 *   → 302 to the game, carrying `?rgs_profile=…&<sessionParam>=<freshly minted token>`
 *   → 302 …&json=1 returns `{ url, token, gameName }` instead, for scripting
 *   → 302 …&on=partner to the partner's OWN launch URL for that session (the `game_url` their
 *     create-session answers with): their page loading our DELIVERED build from their CDN — the
 *     real test of a delivery. `key` still gates who may mint; the card URL is not used.
 *     It loads the LATEST version we delivered for `&alias=` (default: the card's name with the
 *     spaces removed, the partner's alias convention), or exactly `&version=vN`, through the
 *     partner's per-session `config.versionPath` — so a new delivery needs nobody to repoint the
 *     game on their server. No delivered version found and none given ⇒ their server's own setting.
 *
 * `profile`, `game`, `alias` and `player` default to the project's stored partner launch (set on
 * its Game Maker card, `$lib/partnerLaunch.ts`), then to the env: the only profile `PARTNER_RGS`
 * has, that profile's `gameId`, and the user's player from its pool. So the card's ▶ Partner
 * buttons pass only `key`.
 *
 * A refusal is an HTML page that names the cause and the fix (`partnerRefusal.ts`) — the buttons
 * open this in a tab, so that page is what the user reads. `json=1` keeps `{ error }` for scripts.
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
	const wantsJson = url.searchParams.get('json') === '1';
	const onPartner = url.searchParams.get('on') === 'partner';
	const refuse = (status: number, message: string, gameName?: string): Response =>
		wantsJson
			? json({ error: message }, { status, headers: NO_STORE })
			: new Response(partnerRefusalPage({ message, status, gameName }), {
					status,
					headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' },
				});

	if (!locals.user) return refuse(401, 'Unauthorized');

	const key = url.searchParams.get('key')?.trim() ?? '';
	if (!key) return refuse(400, 'The launcher game key ?key= is required.');

	// Only a card the caller could be shown: a global one, or one owned by a project they can reach
	// (the home grid's `listGamesForProject` rule). Anything else answers as if it did not exist.
	const game = await getGame(key);
	if (
		!game ||
		(game.projectKey !== null &&
			!(await canAccessProject(locals.user.id, locals.user.role, game.projectKey)))
	) {
		return refuse(404, `No game card for key "${key}".`);
	}

	const launch = resolvePartnerLaunch({
		query: url.searchParams,
		stored: game.projectKey !== null ? await getPartnerLaunch(game.projectKey) : null,
		profiles: partnerProfileIds(ENV.PARTNER_RGS),
		cardName: game.name,
	});
	if ('error' in launch) return refuse(400, launch.error, game.name);

	// Only a slot reaches a partner (`partnerRgsRefusal`). Read before minting, from the project's
	// config: an R2 error refuses rather than mint for a game of unknown family, and no stored config
	// reads as the slot the runtime would play. A card with no project has no config to read.
	if (game.projectKey !== null) {
		const clientKey = await clientKeyOf(game.projectKey);
		const doc = await loadGameConfigDoc(clientKey, game.projectKey).catch(() => undefined);
		const refusal =
			doc === undefined ? 'The game config could not be read.' : partnerRgsRefusal(doc);
		if (refusal) return refuse(409, refusal, game.name);
	}

	let versionPath: string | undefined;
	if (onPartner) {
		try {
			const asked = url.searchParams.get('version')?.trim();
			if (asked) {
				assertVersionPath(asked);
				versionPath = asked;
			} else {
				if (launch.aliasNamed) assertAlias(launch.alias);
				// A derived alias that is not a plain segment simply has no deliveries to find.
				if (launch.aliasNamed || /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(launch.alias)) {
					versionPath = (await listSealedVersions(launch.alias)).at(-1);
				}
			}
		} catch (error) {
			if (isHttpError(error)) return refuse(error.status, error.body.message, game.name);
			throw error;
		}
	}

	// Minting is the only fallible step, so it is the only thing inside the catch. `redirect()`
	// signals by THROWING, so calling it in here would be caught by our own handler.
	let minted: { url: string; token: string; gameName: string; versionPath?: string };
	try {
		const config = partnerRgsConfig(ENV.PARTNER_RGS, launch.profileId);
		const { token, gameName, gameUrl } = await mintPartnerSession({
			config,
			profileId: launch.profileId,
			userId: locals.user.id,
			gameId: launch.gameId,
			player: launch.player,
			versionPath,
		});
		if (onPartner && !gameUrl) {
			throw new PartnerRgsError(
				'The partner created a session but sent no https game_url to open it with',
				502,
			);
		}
		minted = {
			url: onPartner
				? gameUrl
				: partnerLaunchUrl({
						cardUrl: game.url,
						profileId: launch.profileId,
						token,
						sessionParam: config.sessionParam ?? 'sid',
						// The launcher's click-time params (`ie_authoring`, locale, …) arrive on THIS request
						// rather than on the game, so carry them across or a partner card silently loses them.
						from: url.searchParams,
					}),
			token,
			gameName,
			versionPath,
		};
	} catch (error) {
		if (error instanceof PartnerRgsError) return refuse(error.status, error.message, game.name);
		throw error;
	}

	if (wantsJson) return json(minted, { headers: NO_STORE });
	redirect(302, minted.url);
};
