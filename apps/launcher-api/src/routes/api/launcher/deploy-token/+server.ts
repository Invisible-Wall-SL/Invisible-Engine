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

// Hands the desktop launcher the shared read token (`EDITOR_DOC_SECRET`) so the
// game build can pull live art (`pull:assets`) + freeze the editor layout
// (`bake:doc`) on ANY machine — no per-project `.env` paste. Bearer-auth like the
// other launcher endpoints; NO role gate — every signed-in user gets it (same
// "visibility is the access rule" stance as /api/launcher/projects). The token is
// the same one /api/deploy + /api/editor/doc check against `?k=`/`secret`, and it
// is already client-visible to anyone the game is served to, so the launcher
// merely needs it in the build env. Never logged; served no-store. 401 on a
// missing/invalid session; 404 when unset (the build then runs --optional and
// ships the checked-in placeholder art).
export const GET: RequestHandler = async ({ request }) => {
	const session = bearer(request.headers.get('authorization'));
	const user = await validateSession(session);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const token = ENV.EDITOR_DOC_SECRET;
	if (!token) {
		return json({ error: 'Deploy token not configured' }, { status: 404, headers: NO_STORE });
	}

	return json({ token }, { headers: NO_STORE });
};
