import { json } from '@sveltejs/kit';
import { ENV } from '$lib/server/env';
import { requireLauncherPublisher } from '$lib/server/launcherAuth';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

// Hands the desktop launcher a read-only GitHub token so it can clone PRIVATE game
// repos (and their submodules) with no per-machine GitHub login. Gated on `gamePublish`
// like `/api/launcher/deploy-token`: the launcher fetches both in the same Sync, and a
// clone is only useful to someone who can build and publish it. The token value is never
// logged. 401 on a missing/invalid session, 403 without the capability, 404 when no token
// is configured — the launcher treats all three as "fall back to interactive git auth".
export const GET: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	const gitToken = ENV.GIT_CLONE_TOKEN;
	if (!gitToken) {
		return json({ error: 'Git credentials not configured' }, { status: 404, headers: NO_STORE });
	}

	return json(
		{ host: 'github.com', username: ENV.GIT_CLONE_USERNAME, token: gitToken },
		{ headers: NO_STORE },
	);
};
