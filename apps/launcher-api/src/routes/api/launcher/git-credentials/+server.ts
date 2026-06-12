import { json } from '@sveltejs/kit';
import { validateSession } from '$lib/server/auth';
import { ENV } from '$lib/server/env';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Hands the desktop launcher a read-only GitHub token so it can clone PRIVATE game
// repos (and their submodules) with no per-machine GitHub login. Bearer-auth like the
// other launcher endpoints; NO role gate — every signed-in user gets it, the same
// "visibility is the access rule" stance as GET /api/launcher/projects (cloning is tied
// to having a project you can already see). The token value is never logged. 401 on a
// missing/invalid token; 404 when no token is configured (the launcher then falls back
// to interactive git auth). The token is read-only — treat it as a shared deploy secret.
export const GET: RequestHandler = async ({ request }) => {
	const token = bearer(request.headers.get('authorization'));
	const user = await validateSession(token);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const gitToken = ENV.GIT_CLONE_TOKEN;
	if (!gitToken) {
		return json({ error: 'Git credentials not configured' }, { status: 404, headers: NO_STORE });
	}

	return json(
		{ host: 'github.com', username: ENV.GIT_CLONE_USERNAME, token: gitToken },
		{ headers: NO_STORE },
	);
};
