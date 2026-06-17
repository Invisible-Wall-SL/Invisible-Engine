/**
 * Server-side Publish for the Invisible Game Maker (design doc Phase 1). Turns an
 * online-authored project into an immediately-playable game on the Invisible Test
 * Server — with NO desktop launcher, NO per-game repo, and NO build:
 *
 *   1. resolve the project's client + game type,
 *   2. freshen the `deploy/` exports so the live runtime serves current art/fonts/
 *      symbols (the SAME `ensureDeployExports` the live `/api/editor/runtime` runs),
 *   3. mint/get the project's read-only token (gates the public live fetches),
 *   4. map gameType → mock `protocol` + shared `runtime` bundle id,
 *   5. merge the test-server manifest (`test_server/games.json`) — read-modify-write,
 *   6. upsert the `games` registry row so the game shows in the portal,
 *   7. best-effort POST the test server's `/refresh`.
 *
 * "Publish" is a DATA + MANIFEST operation: re-running it re-exports + re-registers,
 * never rebuilds. The generic runtime boots the project from the live fetch.
 */
import { ENV } from './env';
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { getOrMintReadToken, projectClientKey, projectGameType, projectName } from './projects';
import { listAllObjects } from './r2';
import { ensureDeployExports } from './runtimeBundle';
import { upsertTestServerGame, type MockProtocol } from './testServerManifest';

export interface PublishResult {
	/** The game key (== the project key). */
	key: string;
	/** The full playable game URL on the test server (also returned as `playUrl`). */
	url: string;
	playUrl: string;
}

/**
 * Thrown when a project must NOT be published through the generic online runtime —
 * e.g. it already has its own built bundle on the test server (a desktop-launcher
 * game like Book of Borut / Hot Fruits). The endpoint surfaces the message as a 409
 * so the UI explains why, instead of silently clobbering a real game.
 */
export class PublishBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublishBlockedError';
	}
}

/**
 * True when a game key already has its OWN built bundle uploaded at
 * `test_server/<key>/...` (the desktop-launcher publish path). Those games are
 * served from their own files with their real `protocol` and NO `runtime` field;
 * the online Game Maker (generic runtime) must never overwrite them.
 */
async function hasOwnBuiltBundle(key: string): Promise<boolean> {
	const objects = await listAllObjects(`test_server/${key}/`);
	return objects.some((o) => !o.key.endsWith('/'));
}

/**
 * Map an authored game kind to its mock RGS protocol. Book-of games use the `book`
 * mock (buy-feature + free spins); everything else uses the `lines` mock.
 */
function protocolFor(gameType: string): MockProtocol {
	return gameType === 'bookOf' ? 'book' : 'lines';
}

/**
 * Map an authored game kind to the prebuilt generic-runtime bundle id served at
 * `test_server/_runtime/<runtime>/`.
 *
 * Phase 1: ALWAYS `'lines'` — the only generic runtime that exists today (Phase 0).
 * TODO(Phase 3): add `ways`/`cluster`/`scatter`/`bookOf` runtimes once each is
 * built as its own prebuilt bundle + the `gameType` runtime switch (engine gap 1),
 * and select per `gameType` here.
 */
function runtimeFor(_gameType: string): string {
	return 'lines';
}

/**
 * Publish (or re-publish) a project as a playable test-server game. `projectKey` is
 * the BARE launcher project key; it is also used verbatim as the GAME key.
 */
export async function publishGame(projectKey: string, launcherOrigin: string): Promise<PublishResult> {
	const clientKey = (await projectClientKey(projectKey)) ?? UNASSIGNED_CLIENT;
	const gameType = await projectGameType(projectKey);
	const name = (await projectName(projectKey)) ?? projectKey;

	// 2. Freshen deploy/ so the live runtime serves the current art/fonts/symbols.
	await ensureDeployExports(projectKey, clientKey);

	// 3. The public read-only token (gates /api/editor/runtime + /api/deploy/f/...).
	const readToken = await getOrMintReadToken(projectKey);
	if (!readToken) throw new Error(`Unknown project '${projectKey}'.`);

	const protocol = protocolFor(gameType);
	const runtime = runtimeFor(gameType);
	const key = projectKey;

	// GUARD: never clobber a game that has its OWN built bundle. Desktop-launcher
	// games (Book of Borut, Hot Fruits) live at test_server/<key>/ and are served
	// from there with their real protocol + NO runtime field. Stamping
	// runtime:'lines' on one would shadow its real bundle with the generic lines
	// runtime + the wrong mock RGS — exactly the Book-of-Borut regression. The online
	// Game Maker only publishes games authored ENTIRELY online (no per-key bundle).
	if (await hasOwnBuiltBundle(key)) {
		throw new PublishBlockedError(
			`"${name}" already has its own published build (a desktop-launcher game), so the ` +
				`online Game Maker won't republish it — that would overwrite the real game with the ` +
				`generic runtime. Re-publish it from the desktop launcher instead.`,
		);
	}

	// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings).
	await upsertTestServerGame(key, {
		protocol,
		name,
		runtime,
		updatedAt: new Date().toISOString(),
	});

	// 6. Register the game. The launch URL boots the generic runtime (`?runtime=1`)
	//    against THIS project's live authoring data, gated by the read token, with the
	//    per-key mock RGS proxy. `editorDocBase` points the runtime back at this
	//    launcher for its live /api/editor/runtime + /api/deploy/f fetches.
	const base = ENV.GAMES_BASE_URL.replace(/\/+$/, '');
	const gamesHost = base.replace(/^https?:\/\//, '');
	const origin = launcherOrigin.replace(/\/+$/, '');
	const url =
		`${base}/${key}/?runtime=1&project=${encodeURIComponent(projectKey)}` +
		`&k=${encodeURIComponent(readToken)}` +
		`&editorDocBase=${encodeURIComponent(origin)}` +
		`&rgs_url=${gamesHost}/api/${key}` +
		`&sessionID=demo&lang=en&currency=USD&device=desktop`;

	if (await gameExists(key)) {
		await setGameUrl(key, url);
		await renameGame(key, name);
		await setGameProject(key, projectKey);
	} else {
		await createGame(key, name, url, projectKey);
	}

	// 7. Best-effort refresh — Phase 0 made /refresh 202 + background-hydrate, so a
	//    slow or failing call must never fail the publish.
	try {
		await fetch(`${base}/refresh`, { method: 'POST' });
	} catch {
		// ignore — the test server re-hydrates on its own cadence too.
	}

	return { key, url, playUrl: url };
}
