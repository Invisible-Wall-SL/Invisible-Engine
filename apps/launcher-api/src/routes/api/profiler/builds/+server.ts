import { json } from '@sveltejs/kit';
import { isValidGameKey } from '$lib/server/games';
import { registerBuild } from '$lib/server/profiler/builds';
import { buildOrigin } from '$lib/server/profiler/origin';
import { ReportRefused } from '$lib/server/profiler/store';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Registers a desktop build's breakdown (`docs/design/invisible-profiler.md` §2): the desktop
 * launcher, after ☁ Publish or 📦 Deliver, PUT `build-breakdown.json` to a presigned upload
 * (`POST /api/profiler/uploads?project=` with its bearer) and posts
 * `{ "project", "gameKey", "upload" }` here. The build number, kind and sizes are read from the file
 * itself. 201 `{ id, build }`; registering the same upload again answers the same.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: { project?: unknown; gameKey?: unknown; upload?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });
	}
	const origin = await buildOrigin(request, typeof body.project === 'string' ? body.project : null);
	if (origin instanceof Response) return origin;
	const gameKey = typeof body.gameKey === 'string' ? body.gameKey.trim() : '';
	if (!isValidGameKey(gameKey)) {
		return json({ error: 'Invalid game key' }, { status: 400, headers: NO_STORE });
	}
	const upload = typeof body.upload === 'string' ? body.upload : '';
	try {
		return json(await registerBuild(origin, gameKey, upload), { status: 201, headers: NO_STORE });
	} catch (e) {
		if (e instanceof ReportRefused) {
			return json({ error: e.message }, { status: e.status, headers: NO_STORE });
		}
		throw e;
	}
};
