import { json } from '@sveltejs/kit';
import { requireLauncherAdmin } from '$lib/server/launcherAuth';
import { getObjectText } from '$lib/server/r2';
import type { RequestHandler } from './$types';

const BUNDLE_KEY = 'tools/invisible-launcher/cloudflared-bundle.json';

// Reads `Authorization: Bearer <token>` (a session token from
// POST /api/launcher/login), validates it the same way the web session cookie is
// validated, checks the caller is the owner, then returns the tunnel-credentials
// bundle from R2. Secret values are never logged. 401 no/invalid token, 403 wrong
// role, 404 if the bundle hasn't been seeded yet.
//
// OWNER-ONLY BY NATURE, not by phase: this is the credentials bundle that lets a machine
// BE `comfy.invisiblewall.org`. There is deliberately no capability to grant it with —
// `requireLauncherAdmin` compares the literal `admin` role, so no /admin override can
// hand a tunnel out (unlike the publish chain, which is capability-gated).
export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherAdmin(request);
	if (!auth.ok) return auth.response;

	const text = await getObjectText(BUNDLE_KEY);
	if (text === null) {
		return json({ error: 'Tunnel bundle not available yet' }, { status: 404 });
	}

	return new Response(text, {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
};
