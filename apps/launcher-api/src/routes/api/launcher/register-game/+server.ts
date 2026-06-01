import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import {
	createGame,
	gameExists,
	isValidGameKey,
	isValidGameUrl,
	renameGame,
	setGameUrl,
} from '$lib/server/games';
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
// row (key/name/url) in the `games` table — the same data `/admin → Games` manages. The
// desktop launcher calls this after publishing a game bundle to the test server, so the
// game appears in the portal's Games section with no manual step. 401 no/invalid token,
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

	let body: { key?: unknown; name?: unknown; url?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const key = typeof body.key === 'string' ? body.key.trim() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	const url = typeof body.url === 'string' ? body.url.trim() : '';

	if (!isValidGameKey(key)) {
		return json({ error: 'Invalid game key' }, { status: 400, headers: NO_STORE });
	}
	if (!name) {
		return json({ error: 'Missing name' }, { status: 400, headers: NO_STORE });
	}
	if (!isValidGameUrl(url)) {
		return json({ error: 'url must be a valid https:// URL' }, { status: 400, headers: NO_STORE });
	}

	// Upsert: update an existing game's name + url, else create it.
	if (await gameExists(key)) {
		await setGameUrl(key, url);
		await renameGame(key, name);
	} else {
		await createGame(key, name, url);
	}

	return json({ ok: true, key }, { headers: NO_STORE });
};
