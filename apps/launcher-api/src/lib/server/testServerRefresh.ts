import { ENV } from './env';

/**
 * POST the Invisible Test Server's `/refresh` — the one place the launcher pokes it (Game Maker's
 * Publish and `/api/launcher/register-game`).
 *
 * Aimed at `GAMES_BASE_URL`, NOT `TEST_SERVER_URL`: that one is scoped to the Game Config tool's RGS
 * *probe* and exists so the probe can be pointed elsewhere. `/refresh` is a control call on the
 * service that SERVES the games, so every publisher must aim it at the same host or a split
 * configuration would refresh one service and read another.
 *
 * The server gates `/refresh` on its `TEST_SERVER_SECRET` when that is set. Without sending it here a
 * Publish's refresh would 403 — silently, since callers treat the refresh as best-effort. It goes in
 * a header, never the URL, so it cannot land in an access log.
 */
export function postTestServerRefresh(init: { signal?: AbortSignal } = {}): Promise<Response> {
	const headers: Record<string, string> = {};
	if (ENV.TEST_SERVER_SECRET) headers['x-test-server-secret'] = ENV.TEST_SERVER_SECRET;
	return fetch(`${ENV.GAMES_BASE_URL.replace(/\/+$/, '')}/refresh`, {
		method: 'POST',
		headers,
		...init,
	});
}
