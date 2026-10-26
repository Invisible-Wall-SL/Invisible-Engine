import { createConfigSource } from './configSource.ts';
import { createGameServer } from './server.ts';

/**
 * Entry point. Env (`docs/INFRA.md` "Invisible Game Server"):
 *   PORT                      — default 2567
 *   GAME_SERVER_CONFIG_DIR    — a directory of `<game>.json` configs (local runs), or
 *   GAME_SERVER_CONFIG_URL    — a URL with `{game}` answering a game's published config
 *   GAME_SERVER_CONFIG_TOKEN  — optional bearer token for that URL
 *   GAME_SERVER_MAX_ROOMS     — default 50
 *   GAME_SERVER_TRUST_PROXY   — a device's address (the per-address matchmaking limit) is the
 *                               proxy's `x-forwarded-for` entry: on by default on Railway (whose
 *                               edge fronts every socket), `0` turns it off, `1` turns it on
 *   RAILWAY_GIT_COMMIT_SHA    — set by Railway; `/healthz` reports its first 12 characters
 */
const env = process.env;
const port = Number(env.PORT) || 2567;
const maxRooms = Math.max(1, Math.floor(Number(env.GAME_SERVER_MAX_ROOMS) || 50));
const game = createGameServer({
	loadGame: createConfigSource({
		dir: env.GAME_SERVER_CONFIG_DIR || undefined,
		url: env.GAME_SERVER_CONFIG_URL || undefined,
		token: env.GAME_SERVER_CONFIG_TOKEN || undefined,
	}),
	maxRooms,
	trustProxy: env.GAME_SERVER_TRUST_PROXY
		? env.GAME_SERVER_TRUST_PROXY === '1'
		: Boolean(env.RAILWAY_ENVIRONMENT),
	commit: (env.RAILWAY_GIT_COMMIT_SHA ?? 'dev').slice(0, 12),
});
await game.listen(port);
console.log(`[game-server] listening on :${port} (at most ${maxRooms} rooms)`);
