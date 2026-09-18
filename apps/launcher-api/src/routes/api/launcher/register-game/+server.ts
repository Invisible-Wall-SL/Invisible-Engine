import { json } from '@sveltejs/kit';
import { purgeGameCache, type PurgeResult } from '$lib/server/cfPurge';
import { ENV } from '$lib/server/env';
import {
	createGame,
	getGame,
	isOnlineRuntimeGameUrl,
	isValidGameKey,
	isValidGameUrl,
	renameGame,
	setGameBuildInfo,
	setGameProject,
	setGameUrl,
	type GameBuildInfo,
} from '$lib/server/games';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
import { getOrMintReadToken, projectExists } from '$lib/server/projects';
import { pinTestServerGameToProject, type PinOutcome } from '$lib/server/testServerManifest';
import type { RequestHandler } from './$types';

/**
 * What the pin step reports back to the desktop launcher. `skipped` means we never got as far as
 * trying (no read token); `error` is a failure that did NOT fail the registration.
 *
 * `refresh` distinguishes the two things a 202 can mean, because they are not the same news:
 * `started` is our own hydrate, `queued` is one that will run after the pass already in flight (see
 * the test server's trailing-edge coalescing). Reporting a bare boolean read `true` for both.
 */
type PinReport = {
	status: PinOutcome | 'skipped' | 'error';
	refresh?: 'started' | 'queued' | 'failed';
	error?: string;
};

/** Cap on the test-server `/refresh` poke — see its use below. */
const REFRESH_TIMEOUT_MS = 5_000;

/**
 * Re-stamp the game's manifest entry with the pointer at its project's live Game Config, and poke
 * the test server if that changed anything.
 *
 * WHY HERE. The desktop launcher writes `test_server/games.json` itself, moments before calling
 * this endpoint, with no pointer — and its write REPLACES the entry, so it also wipes any pointer a
 * previous publish set. That is not a bug we can fix in `Invisible_Launcher.py` (a separate app),
 * but it does not need to be: this endpoint already runs on every desktop publish and already
 * REQUIRES the project, so re-stamping here repairs the entry every single time. The Python side
 * needs no change at all.
 *
 * ENTIRELY NON-FATAL, exactly like the Cloudflare purge beside it. A game whose card registered but
 * whose pin failed is a game dealing the wrong board — bad, and worth reporting — but refusing the
 * registration would instead leave the publish with no card at all, which is worse and harder to
 * explain.
 *
 * THE REFRESH IS BEST-EFFORT AND MAY COALESCE. `/refresh` answers 202 and re-hydrates in the
 * background, so a refresh already in flight (the launcher fires its own just before this call) can
 * return before reading our write. The pin is durable in R2 either way, so the worst case is that it
 * takes effect on the server's NEXT hydrate rather than this one — self-healing, and the reason this
 * is reported rather than awaited for correctness.
 */
async function pinToProject(key: string, projectKey: string, docBase: string): Promise<PinReport> {
	try {
		const readToken = await getOrMintReadToken(projectKey);
		// `projectExists` already ran, so this is the "row vanished under us" case rather than a
		// caller error. Nothing to pin with; say so instead of writing a half-pointer the test
		// server would reject anyway.
		if (!readToken) {
			console.warn(
				`[register-game] '${key}': no read token for project '${projectKey}' — not pinned`,
			);
			return { status: 'skipped', error: 'no read token for project' };
		}
		const status = await pinTestServerGameToProject(key, { projectKey, docBase, readToken });
		// SAY IT SERVER-SIDE TOO. The desktop launcher does not read this response field today, and a
		// game whose entry was never found is a game about to deal the wrong board — the exact silence
		// the project pin exists to end. `already-pinned` is the boring, expected case and stays quiet.
		if (status === 'no-entry') {
			console.warn(
				`[register-game] '${key}' has no entry in test_server/games.json, so it could not be ` +
					`pinned to project '${projectKey}' — its mock will deal the shared default board. ` +
					`Was the bundle uploaded under a different key?`,
			);
		}
		// NO REFRESH WHEN NOTHING CHANGED, and that is safe rather than merely cheap: the desktop
		// launcher POSTs `/refresh` itself on every publish, so a registry that is behind R2 is
		// re-read on the very next publish regardless of what this call does. Refreshing here anyway
		// would re-hydrate every game's bundle on every publish for no new information.
		if (status !== 'pinned') return { status };
		try {
			// `GAMES_BASE_URL`, matching `publishGame.ts`'s identical poke — NOT `TEST_SERVER_URL`,
			// which env.ts scopes to the Game Config tool's RGS *probe* and exists precisely so that
			// probe can be pointed elsewhere. `/refresh` is a control call on the service that SERVES
			// the games, so the two publishers must aim it at the same host or a split configuration
			// would refresh one service and read another.
			const res = await fetch(`${ENV.GAMES_BASE_URL.replace(/\/+$/, '')}/refresh`, {
				method: 'POST',
				// TIME-BOXED, unlike the otherwise-identical poke in `publishGame.ts`, because the caller
				// here is the desktop launcher's publish button rather than a browser the user is already
				// watching: an unreachable test server would otherwise hang that publish for the platform
				// default. `/refresh` answers 202 immediately by design, so this only ever trips on a
				// service that is down — exactly the case the catch below already handles.
				signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
			});
			if (!res.ok) return { status, refresh: 'failed' };
			// Both outcomes are a 202; only the body says which. `already-refreshing` means our
			// re-read is QUEUED behind the pass in flight rather than skipped — see the test server's
			// trailing-edge coalescing, without which this would have been a silent no-op.
			const body = (await res.json().catch(() => null)) as { status?: string } | null;
			return { status, refresh: body?.status === 'already-refreshing' ? 'queued' : 'started' };
		} catch {
			// The pin is durable in R2 regardless; the test server picks it up on its next hydrate,
			// which the launcher's own publish triggers anyway.
			return { status, refresh: 'failed' };
		}
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		console.warn(
			`[register-game] '${key}' could not be pinned to project '${projectKey}': ${error}`,
		);
		return { status: 'error', error };
	}
}

const NO_STORE = { 'cache-control': 'no-store' };

// Reads `Authorization: Bearer <token>` (a session token from POST /api/launcher/login),
// validates it like the web session cookie, checks the `gamePublish` capability, then UPSERTS a
// game row (key/name/url + required project scope) in the `games` table — the same data
// `/admin → Games` manages. The desktop launcher calls this after publishing a game
// bundle to the test server, so the game appears in the portal's Games section with no
// manual step. `project` MUST name an existing project (the publish is always project-
// specific); omitting it is a 400, not a silent global game. 401 no/invalid token,
// 403 missing the capability, 400 bad body. Never logs the body.
//
// It ALSO re-stamps that project onto the game's test-server manifest entry (`pin` in the
// response) — the desktop launcher's own manifest write has no project pointer and replaces the
// whole entry, so without this every desktop-published game deals the mock's default board instead
// of its own Game Config. See `pinToProject` below.
//
// `url` is aliased because the handler already binds that name to the GAME's url from the body;
// this one is the request's, and all we want from it is the launcher's own public origin (the
// `docBase` the test server will call back on) — the same value `publishGame.ts` takes as
// `launcherOrigin`.
export const POST: RequestHandler = async ({ request, url: launcherUrl }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	let body: {
		key?: unknown;
		name?: unknown;
		url?: unknown;
		project?: unknown;
		version?: unknown;
		builtAt?: unknown;
		debug?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	// REQUIRED: a desktop publish is always for one specific project, so the game must be
	// scoped to it. Omitting this used to silently land the game as "global" (projectKey
	// NULL), which made it show under every client/project selection. Fail loud instead —
	// a global game is a deliberate choice made by hand in `/admin → Games`, never here.
	const project = typeof body.project === 'string' ? body.project.trim() : '';

	// Optional build metadata stamped at publish time. Parsed defensively: missing /
	// malformed fields fall back to the column defaults ('' / null / false). A bad
	// ISO timestamp is dropped (null), never rejected — build info is informational.
	const version = typeof body.version === 'string' ? body.version.trim() : '';
	let builtAt: Date | null = null;
	if (typeof body.builtAt === 'string' && body.builtAt.trim()) {
		const parsed = new Date(body.builtAt.trim());
		if (!Number.isNaN(parsed.getTime())) builtAt = parsed;
	}
	const debug = Boolean(body.debug);
	const build: GameBuildInfo = { version, builtAt, debug };

	if (!isValidGameKey(key)) {
		return json({ error: 'Invalid game key' }, { status: 400, headers: NO_STORE });
	}
	if (!name) {
		return json({ error: 'Missing name' }, { status: 400, headers: NO_STORE });
	}
	if (!isValidGameUrl(url)) {
		return json({ error: 'url must be a valid https:// URL' }, { status: 400, headers: NO_STORE });
	}
	if (!project) {
		return json({ error: 'Missing project' }, { status: 400, headers: NO_STORE });
	}
	if (!(await projectExists(project))) {
		return json({ error: 'Unknown project' }, { status: 400, headers: NO_STORE });
	}
	const projectKey = project;

	// GUARD (mirror of `hasOwnBuiltBundle` in publishGame.ts): never let a desktop
	// publish overwrite a card that was published ENTIRELY online (the generic runtime,
	// URL carries `?runtime=1`). Stamping a desktop bundle URL over it would shadow the
	// live-fetch game with a stale compiled build under the same key. Keep the two keys
	// distinct instead (`<game>` desktop, `<game>remake` online). 409 so the launcher
	// explains it rather than silently clobbering.
	const existing = await getGame(key);
	if (existing && isOnlineRuntimeGameUrl(existing.url)) {
		return json(
			{
				error:
					`"${key}" is published online (Invisible Game Maker runtime), so the desktop ` +
					`launcher won't overwrite its card with a desktop build. Publish the desktop ` +
					`build under a different key (e.g. keep "${key}" for the online game and use a ` +
					`separate key for the desktop build).`,
			},
			{ status: 409, headers: NO_STORE },
		);
	}

	// Upsert: update an existing game's name + url (+ scope), else create it.
	if (existing) {
		await setGameUrl(key, url);
		await renameGame(key, name);
		await setGameProject(key, projectKey);
		await setGameBuildInfo(key, build);
	} else {
		await createGame(key, name, url, projectKey, build);
	}

	// Re-stamp the manifest's pointer at this project's live Game Config — see `pinToProject`. Runs
	// AFTER the row is written, because the registration is the thing being asked for and the pin is
	// a repair of someone else's write; ordering it first would let an R2 hiccup delay the card.
	const pin = await pinToProject(key, projectKey, launcherUrl.origin);

	// Auto-purge the Cloudflare edge cache for this game so a republish is
	// immediately visible. NON-FATAL: a purge failure must never fail the
	// registration — capture the result for the response and move on.
	let purge: PurgeResult;
	try {
		purge = await purgeGameCache(key);
	} catch (e) {
		purge = { ok: false, purged: 0, error: e instanceof Error ? e.message : String(e) };
	}

	return json({ ok: true, key, purge, pin }, { headers: NO_STORE });
};
