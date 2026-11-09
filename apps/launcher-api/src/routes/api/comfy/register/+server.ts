import { json } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { bearerToken } from '$lib/launcherGates';
import { entitledByAny } from '$lib/accessRules';
import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { checkComfyUrl, COMFY_REGISTER_TOOLS } from '$lib/server/comfyRegister';
import { deleteObject, getObjectText, putObjectText } from '$lib/server/r2';
import { r2Slug } from '$lib/server/projectPaths';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import type { RequestHandler } from './$types';

// Per-user ComfyUI routing (docs/design/per-user-comfyui-routing.md).
//
// The desktop launcher (authenticated as the user) registers its LOCAL ComfyUI
// address here; the atlas-tool then routes THAT user's generation to it instead
// of the shared tunnel. Keyed by the USER (a client is shared by several users),
// stored at `_users/<slug>/comfy.json` in the same R2 bucket the atlas-tool
// reads. `r2Slug` here is byte-identical to the atlas-tool's `r2_slug`, and the
// atlas handoff forwards the same `?user=<slug>` — so all three agree on the key.
//
// The atlas-tool POSTs to the registered URL from inside Railway's network, so registering needs
// the Atlas Maker or ComfyUI tool and a loopback/private/internal host is refused
// (`checkComfyUrl`). Reading and clearing your own record need only a session.

function userKey(userId: string): string {
	return `_users/${r2Slug(userId)}/comfy.json`;
}

// Accept an `Authorization: Bearer <token>` (the desktop launcher already holds
// a session token from POST /api/launcher/login) OR the web session cookie (a
// user managing it from the portal). Same validation as everywhere else.
async function authUser(request: Request, cookies: Cookies) {
	const token = bearerToken(request.headers.get('authorization')) ?? cookies.get(SESSION_COOKIE);
	return validateSession(token);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const user = await authUser(request, cookies);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const [roleOverrides, userOverrides] = await Promise.all([
		getRoleOverrides(user.role),
		getToolOverrides(user.id),
	]);
	if (!entitledByAny(user.role, COMFY_REGISTER_TOOLS, roleOverrides, userOverrides)) {
		return json(
			{ error: 'Your role does not have access to the Atlas Maker or ComfyUI.' },
			{ status: 403 },
		);
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Body must be JSON' }, { status: 400 });
	}
	const b = (body ?? {}) as Record<string, unknown>;
	const checked = checkComfyUrl(String(b.url ?? ''));
	if (!checked.ok) return json({ error: checked.error }, { status: 400 });
	const { url } = checked;
	const cfId = String(b.cf_access_id ?? '').trim();
	const cfSecret = String(b.cf_access_secret ?? '').trim();
	// A named tunnel (a) carries a per-user CF Access token; a quick tunnel (b)
	// has none. Only persist the pair when both are present.
	const record: Record<string, string> = {
		url,
		user: user.id,
		updated: new Date().toISOString(),
	};
	if (cfId && cfSecret) {
		record.cf_access_id = cfId;
		record.cf_access_secret = cfSecret;
	}
	await putObjectText(userKey(user.id), JSON.stringify(record), 'application/json');
	// Never echo the CF secret back.
	return json({ ok: true, url, hasAccessToken: Boolean(cfId && cfSecret) });
};

export const GET: RequestHandler = async ({ request, cookies }) => {
	const user = await authUser(request, cookies);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	const text = await getObjectText(userKey(user.id));
	if (!text) return json({ registered: false });
	try {
		const rec = JSON.parse(text) as Record<string, unknown>;
		return json({
			registered: true,
			url: rec.url ?? '',
			hasAccessToken: Boolean(rec.cf_access_id && rec.cf_access_secret),
			updated: rec.updated ?? '',
		});
	} catch {
		return json({ registered: false });
	}
};

export const DELETE: RequestHandler = async ({ request, cookies }) => {
	const user = await authUser(request, cookies);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
	await deleteObject(userKey(user.id));
	return json({ ok: true });
};
