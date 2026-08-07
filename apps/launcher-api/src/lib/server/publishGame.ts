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
import { symbolsInPlay, type GameConfigDoc, type PaytableRow } from 'game-config';
import { ENV } from './env';
import { loadGameConfigDoc } from './gameConfigStorage';
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { getOrMintReadToken, projectClientKey, projectGameType, projectName } from './projects';
import { listAllObjects } from './r2';
import { ensureDeployExports } from './runtimeBundle';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import {
	upsertTestServerGame,
	type MockProtocol,
	type TestServerGameConfig,
} from './testServerManifest';

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

/** Flatten a symbol's `[{ '5': 20 }, { '3': 5 }]` paytable rows to an `{ occurs: multiplier }` map. */
function paytableToOccursMap(rows: PaytableRow[]): Record<string, number> {
	const map: Record<string, number> = {};
	for (const row of rows) {
		for (const [occurs, mult] of Object.entries(row)) {
			if (typeof mult === 'number' && Number.isFinite(mult)) map[occurs] = mult;
		}
	}
	return map;
}

/**
 * Snapshot a project's config doc into the compact shape the lines mock deals — grid + paylines +
 * opt-in wild — so the test server deals THIS project's board (a resized grid, an in-play wild)
 * instead of its committed 5×3 default. Returns `undefined` for a `null` doc: that project rides the
 * compiled template, which the server already deals as its default, so there's nothing to inject.
 *
 * The wild is picked from the doc's IN-PLAY symbols (on the strips) that also carry the `wild`
 * property and a paytable. Putting a wild on the reels is the deliberate, per-game act that turns it
 * on — a game that merely inherits `W` in its dictionary but never deals it stays wild-less, which is
 * why an authored-but-unused `W` doesn't pay. The lines facade maps the mock's `WILD` to the game
 * symbol `W`, so the in-play wild is expected to be `W`.
 */
function rgsSnapshotFor(doc: GameConfigDoc | null): TestServerGameConfig | undefined {
	if (!doc) return undefined;
	const inPlay = new Set(symbolsInPlay(doc));
	const wildEntry = Object.entries(doc.symbols).find(
		([name, sym]) => inPlay.has(name) && sym.special_properties?.includes('wild') && sym.paytable?.length,
	);
	const wildPaytable = wildEntry?.[1].paytable;
	const wild = wildPaytable ? { paytable: paytableToOccursMap(wildPaytable) } : undefined;
	return {
		reels: doc.numReels,
		rows: Math.max(...doc.numRows, 1),
		paylines: Object.values(doc.paylines),
		...(wild ? { wild } : {}),
	};
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
	// A bundle assembled moments before this publish landed would keep being served for the
	// rest of its TTL, so a publish-then-reload could still show pre-publish data. Drop it.
	invalidateRuntimeBundle(projectKey);

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

	// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings). Snapshot the
	// project's authored grid/paylines/wild so the lines mock deals THIS board, not the 5×3 default.
	const gameConfig = rgsSnapshotFor(await loadGameConfigDoc(clientKey, projectKey));
	await upsertTestServerGame(key, {
		protocol,
		name,
		runtime,
		...(gameConfig ? { gameConfig } : {}),
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
