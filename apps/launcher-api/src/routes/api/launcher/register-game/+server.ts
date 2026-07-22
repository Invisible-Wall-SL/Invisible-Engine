import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { purgeGameCache, type PurgeResult } from '$lib/server/cfPurge';
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
import { projectExists } from '$lib/server/projects';
import type { RequestHandler } from './$types';

// Same gate as the other desktop-launcher bearer endpoints (models/nodes): only the
// owner role may register a game.
const REGISTER_ROLE = 'admin';

const NO_STORE = { 'cache-control': 'no-store' };

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Reads `Authorization: Bearer <token>` (a session token from POST /api/launcher/login),
// validates it like the web session cookie, checks the owner role, then UPSERTS a game
// row (key/name/url + required project scope) in the `games` table — the same data
// `/admin → Games` manages. The desktop launcher calls this after publishing a game
// bundle to the test server, so the game appears in the portal's Games section with no
// manual step. `project` MUST name an existing project (the publish is always project-
// specific); omitting it is a 400, not a silent global game. 401 no/invalid token,
// 403 wrong role, 400 bad body. Never logs the body.
export const POST: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}
	if (user.role !== REGISTER_ROLE) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

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

	// Auto-purge the Cloudflare edge cache for this game so a republish is
	// immediately visible. NON-FATAL: a purge failure must never fail the
	// registration — capture the result for the response and move on.
	let purge: PurgeResult;
	try {
		purge = await purgeGameCache(key);
	} catch (e) {
		purge = { ok: false, purged: 0, error: e instanceof Error ? e.message : String(e) };
	}

	return json({ ok: true, key, purge }, { headers: NO_STORE });
};
