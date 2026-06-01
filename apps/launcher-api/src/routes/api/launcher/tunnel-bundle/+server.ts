import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { getObjectText } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const BUNDLE_KEY = 'tools/invisible-launcher/cloudflared-bundle.json';

// The role permitted to run the local GPU + Cloudflare tunnel. Only `admin`
// (the owner) gets the secret credentials bundle.
const TUNNEL_ROLE = 'admin';

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Reads `Authorization: Bearer <token>` (a session token from
// POST /api/launcher/login), validates it the same way the web session cookie is
// validated, checks the user is the owner role, then returns the tunnel-credentials
// bundle from R2. Secret values are never logged. 401 no/invalid token, 403 wrong
// role, 404 if the bundle hasn't been seeded yet.
export const GET: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	if (user.role !== TUNNEL_ROLE) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const text = await getObjectText(BUNDLE_KEY);
	if (text === null) {
		return json({ error: 'Tunnel bundle not available yet' }, { status: 404 });
	}

	return new Response(text, {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
