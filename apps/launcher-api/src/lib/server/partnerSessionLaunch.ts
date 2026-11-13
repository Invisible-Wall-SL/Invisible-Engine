import { isHttpError } from '@sveltejs/kit';
import { resolvePartnerLaunch, SEGMENT_RE } from '$lib/partnerLaunch';
import type { Game } from './db/schema';
import { ENV } from './env';
import { partnerRgsRefusal } from './familyGate';
import { loadGameConfigDoc } from './gameConfigStorage';
import { assertAlias, assertVersionPath, listSealedVersions } from './partnerDelivery';
import {
	PartnerRgsError,
	mintPartnerSession,
	partnerLaunchUrl,
	partnerProfileIds,
	partnerRgsConfig,
} from './partnerRgs';
import { clientKeyOf } from './projectLookup';
import { getPartnerLaunch } from './projects';

export interface PartnerLaunchMinted {
	ok: true;
	url: string;
	token: string;
	gameName: string;
	versionPath?: string;
}

export interface PartnerLaunchRefused {
	ok: false;
	status: number;
	message: string;
}

/**
 * Mint a FRESH partner session for a published game card and build the URL that opens it: the one
 * path behind both `/api/partner-session` (a signed-in launcher user) and `/play/<token>` (a partner
 * share link, no login). The caller decides WHO may launch; this decides what is launched.
 *
 * Resolution is query > the project's stored partner launch > the env default
 * (`resolvePartnerLaunch`). `requireStored` refuses a project with no stored partner launch instead
 * of falling back to the env default — a share link plays exactly the game its project was set up
 * as, or nothing.
 *
 * `on=partner` is read from `query`: the partner's OWN launch URL (their page loading our latest
 * delivery) instead of our card URL. Never throws for a refusal; anything else is a server error.
 */
export async function launchOnPartner(options: {
	game: Game;
	/** The launch's query: overrides (`profile`, `game`, `alias`, `player`, `version`, `on`) and the
	 *  click-time params forwarded onto the game (`lang`, `currency`, `ie_authoring`, …). */
	query: URLSearchParams;
	/** Whose player-pool slot the session plays as (`partnerRemoteId`). */
	userId: string;
	requireStored?: boolean;
}): Promise<PartnerLaunchMinted | PartnerLaunchRefused> {
	const { game, query } = options;
	const refuse = (status: number, message: string): PartnerLaunchRefused => ({
		ok: false,
		status,
		message,
	});
	const onPartner = query.get('on') === 'partner';

	const stored = game.projectKey !== null ? await getPartnerLaunch(game.projectKey) : null;
	if (options.requireStored && !stored) {
		return refuse(409, 'This game is no longer set up to play on a partner.');
	}
	const launch = resolvePartnerLaunch({
		query,
		stored,
		profiles: partnerProfileIds(ENV.PARTNER_RGS),
		cardName: game.name,
	});
	if ('error' in launch) return refuse(400, launch.error);

	// Only a slot reaches a partner (`partnerRgsRefusal`). Read before minting, from the project's
	// config: an R2 error refuses rather than mint for a game of unknown family, and no stored config
	// reads as the slot the runtime would play. A card with no project has no config to read.
	if (game.projectKey !== null) {
		const clientKey = await clientKeyOf(game.projectKey);
		const doc = await loadGameConfigDoc(clientKey, game.projectKey).catch(() => undefined);
		const refusal =
			doc === undefined ? 'The game config could not be read.' : partnerRgsRefusal(doc);
		if (refusal) return refuse(409, refusal);
	}

	let versionPath: string | undefined;
	if (onPartner) {
		try {
			const asked = query.get('version')?.trim();
			if (asked) {
				assertVersionPath(asked);
				versionPath = asked;
			} else {
				if (launch.aliasNamed) assertAlias(launch.alias);
				// A derived alias that is not a plain segment simply has no deliveries to find.
				if (launch.aliasNamed || SEGMENT_RE.test(launch.alias)) {
					versionPath = (await listSealedVersions(launch.alias)).at(-1);
				}
			}
		} catch (error) {
			if (isHttpError(error)) return refuse(error.status, error.body.message);
			throw error;
		}
	}

	try {
		const config = partnerRgsConfig(ENV.PARTNER_RGS, launch.profileId);
		const { token, gameName, gameUrl } = await mintPartnerSession({
			config,
			profileId: launch.profileId,
			userId: options.userId,
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
		return {
			ok: true,
			url: onPartner
				? gameUrl
				: partnerLaunchUrl({
						cardUrl: game.url,
						profileId: launch.profileId,
						token,
						sessionParam: config.sessionParam ?? 'sid',
						// The launcher's click-time params (`ie_authoring`, locale, …) arrive on THIS request
						// rather than on the game, so carry them across or a partner card silently loses them.
						from: query,
					}),
			token,
			gameName,
			...(versionPath ? { versionPath } : {}),
		};
	} catch (error) {
		if (error instanceof PartnerRgsError) return refuse(error.status, error.message);
		throw error;
	}
}
