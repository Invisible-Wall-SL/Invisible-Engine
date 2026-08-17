import { error, json } from '@sveltejs/kit';
import { riggerBundlePrefix } from '$lib/server/riggerBundle';
import { RIG_TEXT_PAGE_RE } from '$lib/server/riggerText';
import { presignPut } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT the packed text page straight to R2. */
const PUT_TTL_SECONDS = 600;

/**
 * Mint a presigned PUT for a rig's packed TEXT page (`rigtext-<hash>.png` inside the rig
 * bundle). The browser uploads the pixels DIRECTLY to R2, exactly like the Font Maker's page
 * import: a packed page routinely exceeds adapter-node's 512 KB `BODY_SIZE_LIMIT`, so posting
 * it through the node server would 413.
 *
 * The filename is CONTENT-ADDRESSED by the caller and validated here against
 * `RIG_TEXT_PAGE_RE`, so this endpoint can only ever sign a rig-text page — not an arbitrary
 * object inside the bundle, and never the rig's own `.irig` / `.atlas` / source page.
 *
 * Body: `{ dir: <base64url bundle dir>, file: 'rigtext-<hash>.png' }`.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'rigger',
		forbiddenMessage: 'Your role does not have access to the Invisible Rigger.',
	});

	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) throw error(400, 'bad body');

	const file = typeof body.file === 'string' ? body.file : '';
	if (!RIG_TEXT_PAGE_RE.test(file)) throw error(400, 'bad text page filename');

	const bundlePrefix = riggerBundlePrefix(clientKey, projectKey, body.dir);
	const key = `${bundlePrefix}/${file}`;
	assertAllowed(key, prefixes);

	return json({
		key,
		url: await presignPut(key, 'image/png', PUT_TTL_SECONDS),
		contentType: 'image/png',
		expiresInSeconds: PUT_TTL_SECONDS,
	});
};
