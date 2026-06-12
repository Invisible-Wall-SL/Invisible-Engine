import { json } from '@sveltejs/kit';
import { GAME_PUBLISH_CAPABILITY, roleHasCapability } from '$lib/roles';
import { validateSession } from '$lib/server/auth';
import { getDeployToken } from '$lib/server/appSettings';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

function bearer(header: string | null): string | undefined {
	if (!header) return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match?.[1];
}

// Hands the desktop launcher the shared build/deploy token so the game build can
// pull live art (`pull:assets`) + freeze the editor layout (`bake:doc`) on ANY
// machine — no per-project `.env` paste. The token is the same one /api/deploy +
// /api/editor/doc check against `?k=`/`secret`; it now comes from `getDeployToken()`
// (admin-managed DB value, else the `EDITOR_DOC_SECRET` env bootstrap). Bearer-auth
// like the other launcher endpoints. Never logged; served no-store.
//
// ⚠️ BEHAVIOUR CHANGE (intended): this used to have NO role gate — every signed-in
// user got the token. It now requires the `gamePublish` capability (Build & publish
// games). Admins keep working (default-ON); other publishers must be granted it in
// /admin → Roles (per role) or the per-user panel. 401 on a missing/invalid session;
// 403 when the session lacks the capability; 404 when the token is unset.
export const GET: RequestHandler = async ({ request }) => {
	const session = bearer(request.headers.get('authorization'));
	const user = await validateSession(session);
	if (!user) {
		return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
	}

	const roleOverrides = await getRoleOverrides(user.role);
	const userOverrides = await getToolOverrides(user.id);
	if (!roleHasCapability(user.role, GAME_PUBLISH_CAPABILITY, roleOverrides, userOverrides)) {
		return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
	}

	const token = await getDeployToken();
	if (!token) {
		return json({ error: 'Deploy token not configured' }, { status: 404, headers: NO_STORE });
	}

	return json({ token }, { headers: NO_STORE });
};
