import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import {
	GAME_KEY,
	gameServerAuthorized,
	publishedGameConfig,
	type PublishedGameConfig,
} from '$lib/server/gameServerConfig';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * A project's PUBLISHED game config for the Invisible Game Server (`GAME_SERVER_CONFIG_URL`), as
 * `{ projectKey, snapshot, doc }`. Bearer `GAME_SERVER_CONFIG_SECRET` only — never `?k=`, never the
 * deploy token, never a session — and that secret opens nothing else.
 *
 * 404 means the game server has nothing to play (no live project, never published, or a snapshot
 * with no authored config), which it takes as "gone" and drops its last good config for. A pointer
 * that does not parse or names an unreadable snapshot, or an R2 failure, is a 502, which it rides
 * out on that last good config.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	if (!gameServerAuthorized(request.headers.get('authorization'), ENV.GAME_SERVER_CONFIG_SECRET)) {
		return json(
			{ error: 'Unauthorized' },
			{ status: 401, headers: { ...NO_STORE, 'www-authenticate': 'Bearer' } },
		);
	}
	const projectKey = url.searchParams.get('project') ?? '';
	if (!GAME_KEY.test(projectKey)) {
		return json({ error: 'Invalid project key.' }, { status: 400, headers: NO_STORE });
	}
	let published: PublishedGameConfig;
	try {
		published = await publishedGameConfig(projectKey);
	} catch (e) {
		console.error(`[game-server/config] ${projectKey}: read failed`, e);
		return json(
			{ error: 'Failed to read the published config.' },
			{ status: 502, headers: NO_STORE },
		);
	}
	if (!published.found) {
		if (published.reason === 'snapshot-missing' || published.reason === 'pointer-unreadable') {
			console.error(
				published.reason === 'snapshot-missing'
					? `[game-server/config] ${projectKey}: the published pointer names snapshot ` +
							`${published.snapshot} but its runtime.json is missing. Republish to repair.`
					: `[game-server/config] ${projectKey}: the published pointer does not parse. ` +
							'Republish to repair.',
			);
			return json(
				{ error: 'The published snapshot is unreadable.' },
				{ status: 502, headers: NO_STORE },
			);
		}
		return json(
			{ error: 'No published config.', reason: published.reason },
			{ status: 404, headers: NO_STORE },
		);
	}
	return json(
		{ projectKey, snapshot: published.snapshot, doc: published.doc },
		{ headers: NO_STORE },
	);
};
