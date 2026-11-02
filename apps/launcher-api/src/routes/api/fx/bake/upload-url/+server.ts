import { json } from '@sveltejs/kit';
import { readBakeTarget } from '$lib/server/fxBake';
import { fxBakeKeys } from '$lib/server/projectPaths';
import { presignPut } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT the baked page straight to R2. */
const PUT_TTL_SECONDS = 300;

/**
 * Step 1 of "Bake now" in `/fx` (`invisible-fx.md` §"Baked effects"): a presigned R2 PUT for the
 * baked sheet's PNG page, at `fx-bakes/<effectId>/fxbake_<effectId>_<hash>.png`. The browser PUTs the
 * bytes directly — a sheet is megabytes and a proxied upload would hit `BODY_SIZE_LIMIT` — then calls
 * `POST /api/fx/bake` to write the sheet's JSON. `fx`-gated like `/api/fx/save`.
 *
 * Body: `{ effectId, hash, projectKey? }`. Answers `{ url, key, contentType }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'fx',
		forbiddenMessage: 'Your role does not have access to Invisible FX.',
	});
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const target = readBakeTarget(body, projectKey);
	if (target instanceof Response) return target;

	const { png } = fxBakeKeys(clientKey, projectKey, target.effectId, target.hash);
	assertAllowed(png, prefixes);
	const contentType = 'image/png';
	const url = await presignPut(png, contentType, PUT_TTL_SECONDS);
	return json({ url, key: png, contentType });
};
