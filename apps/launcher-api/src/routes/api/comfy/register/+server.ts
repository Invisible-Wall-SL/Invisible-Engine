import { json } from '@sveltejs/kit';
import type { Cookies } from '@sveltejs/kit';
import { SESSION_COOKIE, validateSession } from '$lib/server/auth';
import { deleteObject, getObjectText, putObjectText } from '$lib/server/r2';
import { r2Slug } from '$lib/server/projectPaths';
import type { RequestHandler } from './$types';

// Per-user ComfyUI routing (docs/design/per-user-comfyui-routing.md).
//
// The desktop launcher (authenticated as the user) registers its LOCAL ComfyUI
// address here; the atlas-tool then routes THAT user's generation to it instead
// of the shared tunnel. Keyed by the USER (a client is shared by several users),
// stored at `_users/<slug>/comfy.json` in the same R2 bucket the atlas-tool
// reads. `r2Slug` here is byte-identical to the atlas-tool's `r2_slug`, and the
// atlas handoff forwards the same `?user=<slug>` — so all three agree on the key.

function userKey(userId: string): string {
	return `_users/${r2Slug(userId)}/comfy.json`;
}

function bearer(header: string | null): string | undefined {
	const m = /^Bearer\s+(.+)$/i.exec((header ?? '').trim());
	return m?.[1];
}

// Accept an `Authorization: Bearer <token>` (the desktop launcher already holds
// a session token from POST /api/launcher/login) OR the web session cookie (a
// user managing it from the portal). Same validation as everywhere else.
async function authUser(request: Request, cookies: Cookies) {
	const token = bearer(request.headers.get('authorization')) ?? cookies.get(SESSION_COOKIE);
	return validateSession(token);
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const user = await authUser(request, cookies);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Body must be JSON' }, { status: 400 });
	}
	const b = (body ?? {}) as Record<string, unknown>;
	const url = String(b.url ?? '')
		.trim()
		.replace(/\/+$/, '');
	if (!/^https?:\/\/.+/i.test(url)) {
		return json({ error: 'A valid http(s) ComfyUI url is required' }, { status: 400 });
	}
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
