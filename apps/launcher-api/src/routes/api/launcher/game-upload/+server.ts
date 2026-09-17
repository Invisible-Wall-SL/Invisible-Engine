import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import {
	commitBundlePublish,
	relayBundleFile,
	MAX_RELAY_FILE_BYTES,
} from '$lib/server/gameBundleRelay';
import { isMockProtocol } from '$lib/server/testServerManifest';
import type { RequestHandler } from './$types';

// Uploads a desktop-built game bundle into R2 THROUGH the portal, for a publisher whose own line
// cannot reach R2 — see the WHY in `$lib/server/gameBundleRelay.ts` (Spanish ISPs null-route the
// Cloudflare ranges `*.r2.cloudflarestorage.com` resolves into, while this portal stays reachable).
//
//   PUT  ?key=<gameKey>&path=<rel>   raw file bytes      → writes test_server/<key>/<rel>
//   POST ?key=<gameKey>              {name, protocol, files[]} → verify + prune + merge games.json
//
// Both read `Authorization: Bearer <token>` (a session token from POST /api/launcher/login) and
// require the SAME role as `register-game`: this writes the games manifest, so it is exactly as
// privileged as registering a game. 401 no/invalid token, 403 wrong role, 400 bad key/path/body,
// 409 the key belongs to an online game (or the bundle arrived incomplete), 413 too big.
// Never logs the body.
//
// The publisher then calls POST /api/launcher/register-game exactly as it does after a direct-to-R2
// publish — that is what upserts the portal's games row, re-stamps the project pin and purges the
// edge cache, and none of it is duplicated here.
const UPLOAD_ROLE = 'admin';
const NO_STORE = { 'cache-control': 'no-store' };

/** `Authorization: Bearer <token>` → the token. Mirrors `register-game`'s parser; six launcher
 *  routes now carry a copy of these four lines (see the extraction note in docs/status/launcher.md
 *  §Open items 3 — copied on purpose rather than refactor five live endpoints in an urgent fix). */
function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
}

/** 401/403 as a Response, or the authenticated admin. */
async function authorize(request: Request): Promise<Response | null> {
	const user = await validateSession(bearer(request.headers.get('authorization')));
	if (!user) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	if (user.role !== UPLOAD_ROLE) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}
	return null;
}

export const PUT: RequestHandler = async ({ request, url }) => {
	const denied = await authorize(request);
	if (denied) return denied;

	const key = url.searchParams.get('key') ?? '';
	const path = url.searchParams.get('path') ?? '';
	if (!key || !path) {
		return json({ error: 'key and path are required' }, { status: 400, headers: NO_STORE });
	}

	// Buffered, not streamed: R2's PutObject needs a known length, and the adapter has already
	// refused anything over BODY_SIZE_LIMIT. `MAX_RELAY_FILE_BYTES` is the second wall.
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.byteLength === 0) {
		return json({ error: `'${path}' arrived empty` }, { status: 400, headers: NO_STORE });
	}

	const result = await relayBundleFile(key, path, body);
	return json(result, { headers: NO_STORE });
};

export const POST: RequestHandler = async ({ request, url }) => {
	const denied = await authorize(request);
	if (denied) return denied;

	const key = url.searchParams.get('key') ?? '';
	if (!key) return json({ error: 'key is required' }, { status: 400, headers: NO_STORE });

	let body: { name?: unknown; protocol?: unknown; files?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (!name) return json({ error: 'name is required' }, { status: 400, headers: NO_STORE });
	if (!isMockProtocol(body.protocol)) {
		return json(
			{ error: `Unknown protocol '${String(body.protocol)}'` },
			{ status: 400, headers: NO_STORE },
		);
	}
	const files = Array.isArray(body.files) ? body.files.filter((f) => typeof f === 'string') : [];
	if (files.length === 0) {
		return json({ error: 'files must be a non-empty list' }, { status: 400, headers: NO_STORE });
	}

	const result = await commitBundlePublish({ key, name, protocol: body.protocol, files });
	return json(result, { headers: NO_STORE });
};

/** What a publisher may send in one PUT, so it can split or warn before trying. */
export const GET: RequestHandler = async ({ request }) => {
	const denied = await authorize(request);
	if (denied) return denied;
	return json({ maxFileBytes: MAX_RELAY_FILE_BYTES }, { headers: NO_STORE });
};
