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
import { createGame, gameExists, renameGame, setGameProject, setGameUrl } from './games';
import { UNASSIGNED_CLIENT } from './projectPaths';
import { getOrMintReadToken, projectClientKey, projectGameType, projectName } from './projects';
import { listAllObjects } from './r2';
import { ensureDeployExports } from './runtimeBundle';
import { invalidateRuntimeBundle } from './runtimeBundleCache';
import { loadGameConfigDoc } from './gameConfigStorage';
import { loadSymbolsDoc } from './symbolsStorage';
import {
	upsertTestServerGame,
	type MockProtocol,
	type TestServerGameEntry,
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
 * The project's IN-PLAY wild, in the shape the mock wants (`{ paytable: occurs→multiplier }`), or
 * `undefined`. Keyed off the SAME in-play gate as the paytable, roll and `/symbols`: a symbol counts
 * only once it's ON THE STRIPS (`symbolsInPlay`) — a wild that merely sits in the dictionary with a
 * paytable but is never dealt stays wild-less, which is why an authored-but-unused `W` doesn't pay.
 * The lines facade maps the mock's `WILD` to the game symbol `W`, so the in-play wild is expected to
 * be `W`.
 */
function projectWild(doc: GameConfigDoc): { paytable: Record<string, number> } | undefined {
	const inPlay = new Set(symbolsInPlay(doc));
	const entry = Object.entries(doc.symbols).find(
		([name, sym]) => inPlay.has(name) && sym.special_properties?.includes('wild') && sym.paytable?.length,
	);
	const paytable = entry?.[1].paytable;
	return paytable ? { paytable: paytableToOccursMap(paytable) } : undefined;
}

/**
 * Resolve a project's board grid from its authored Game Config, in the shape the test-server mock
 * wants (`{ reels, rows, paylines: rows[][], wild? }`). Mirrors the test-server's own `linesGrid`
 * derivation so the mock deals the SAME dimensions + paylines the client draws, plus the in-play wild
 * so `W` can pay. Lines protocol only; best-effort (no authored doc / odd config ⇒ `undefined` ⇒ the
 * mock keeps its shared default). `numRows` is the per-reel array, so `rows` is its max (a stepped
 * board is a rectangle tall enough to hold it).
 */
async function projectGrid(
	protocol: MockProtocol,
	clientKey: string,
	projectKey: string,
): Promise<TestServerGameEntry['grid']> {
	if (protocol !== 'lines') return undefined;
	try {
		const doc = await loadGameConfigDoc(clientKey, projectKey);
		if (!doc) return undefined;
		const reels = Math.max(1, Math.round(Number(doc.numReels)));
		const rowsList = Array.isArray(doc.numRows) && doc.numRows.length ? doc.numRows : [3];
		const rows = Math.max(1, Math.round(Math.max(...rowsList)));
		const paylines = Object.values(doc.paylines ?? {});
		if (!Number.isFinite(reels) || !paylines.length) return undefined;
		const wild = projectWild(doc);
		// `stacked`: does this project have the stacked-picture reel mode ON? Gated on the SAME master
		// toggle the symbol bake reads (`stackedPictures.enabled` + ≥1 authored symbol) so the mock deals
		// tall-symbol runs — incl. guaranteed edge cutoffs — only for a project that actually stacks
		// pictures. Best-effort: a missing/empty symbols doc ⇒ no flag ⇒ the normal weighted deal.
		const stacked = await projectStacked(clientKey, projectKey);
		return { reels, rows, paylines, ...(wild ? { wild } : {}), ...(stacked ? { stacked: true } : {}) };
	} catch {
		return undefined;
	}
}

/**
 * True when the project has the stacked-picture reel mode enabled in its symbols doc (the SAME
 * `stackedPictures.enabled` master toggle `symbolExport` gates the baked `stacked` config on). Used to
 * tell the test-server mock to deal stacked boards. Best-effort — any read/parse failure ⇒ `false`.
 */
async function projectStacked(clientKey: string, projectKey: string): Promise<boolean> {
	try {
		const doc = await loadSymbolsDoc(clientKey, projectKey);
		return doc.stackedPictures?.enabled === true && (doc.stackedPictures.symbols?.length ?? 0) > 0;
	} catch {
		return false;
	}
}

/**
 * Publish (or re-publish) a project as a playable test-server game. `projectKey` is
 * the BARE launcher project key; it is also used verbatim as the GAME key.
 */
export async function publishGame(
	projectKey: string,
	launcherOrigin: string,
): Promise<PublishResult> {
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

	// Deal THIS project's OWN board grid on the mock RGS (not the shared apps/lines default), so a
	// project that authored e.g. 5 rows doesn't mismatch its client (roll with 5, settle with fewer).
	// Best-effort + lines-only (the book mock owns its own shape): an un-authored/odd config ⇒ no grid
	// ⇒ the test server falls back to its shared default. `paylines` are the config's row-index arrays.
	const grid = await projectGrid(protocol, clientKey, projectKey);

	// 4 + 5. Merge the test-server manifest (read-modify-write, preserves siblings).
	await upsertTestServerGame(key, {
		protocol,
		name,
		runtime,
		updatedAt: new Date().toISOString(),
		...(grid ? { grid } : {}),
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
