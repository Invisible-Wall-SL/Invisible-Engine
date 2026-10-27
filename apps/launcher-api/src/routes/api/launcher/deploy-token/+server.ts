import { json } from '@sveltejs/kit';
import {
	DEPLOY_TOKEN_KEY,
	MIN_DEPLOY_TOKEN,
	getDeployToken,
	setAppSetting,
} from '$lib/server/appSettings';
import { requireLauncherAdmin, requireLauncherPublisher } from '$lib/server/launcherAuth';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

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
	const auth = await requireLauncherPublisher(request);
	if (!auth.ok) return auth.response;

	const token = await getDeployToken();
	if (!token) {
		return json({ error: 'Deploy token not configured' }, { status: 404, headers: NO_STORE });
	}

	return json({ token }, { headers: NO_STORE });
};

// The desktop launcher's Key Vault (admins) sets the token here when it rotates it, so the portal,
// the `EDITOR_DOC_SECRET` fallback and the vault change together. Owner-only by nature: it is
// the machine secret every build and live-asset read checks. Body: `{ token }`.
export const PUT: RequestHandler = async ({ request }) => {
	const auth = await requireLauncherAdmin(request);
	if (!auth.ok) return auth.response;

	const body: unknown = await request.json().catch(() => null);
	const token =
		body && typeof body === 'object' && 'token' in body && typeof body.token === 'string'
			? body.token.trim()
			: '';
	if (token.length < MIN_DEPLOY_TOKEN) {
		return json(
			{ error: `Token must be at least ${MIN_DEPLOY_TOKEN} characters.` },
			{ status: 400, headers: NO_STORE },
		);
	}

	await setAppSetting(DEPLOY_TOKEN_KEY, token, auth.user.id);
	return json({ ok: true }, { headers: NO_STORE });
};
