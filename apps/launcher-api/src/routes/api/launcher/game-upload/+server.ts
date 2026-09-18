import { json } from '@sveltejs/kit';
import {
	commitBundlePublish,
	relayBundleFile,
	MAX_RELAY_FILE_BYTES,
} from '$lib/server/gameBundleRelay';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
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
// require the SAME capability as `register-game` (`gamePublish`): this writes the games manifest,
// so it is exactly as privileged as registering a game. 401 no/invalid token, 403 missing the
// capability, 400 bad key/path/body, 409 the key belongs to an online game (or the bundle arrived
// incomplete), 413 too big. Never logs the body.
//
// The publisher then calls POST /api/launcher/register-game exactly as it does after a direct-to-R2
// publish — that is what upserts the portal's games row, re-stamps the project pin and purges the
// edge cache, and none of it is duplicated here.
const NO_STORE = { 'cache-control': 'no-store' };

export const PUT: RequestHandler = async ({ request, url }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

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
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

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
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;
	return json({ maxFileBytes: MAX_RELAY_FILE_BYTES }, { headers: NO_STORE });
};
