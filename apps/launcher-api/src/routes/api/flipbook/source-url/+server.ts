import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { presignPut } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT the image straight to R2. */
const PUT_TTL_SECONDS = 300;

/**
 * Where a Flipbook video source image lands, INSIDE the Atlas Maker's `input/` mirror:
 * `<client>/<project>/input/refs/flipbook/<name>`.
 *
 * The folder is not cosmetic — it is what makes the returned ref resolvable. `source_ref` is
 * handed verbatim to the atlas-tool's runner, which resolves an INPUT_DIR-relative path
 * (`refs/…`), so an image written anywhere else in the project would need a second mapping
 * rule that nothing else in the chain knows about. Its own subfolder keeps generated sources
 * out of the Atlas Maker's hand-curated `refs/` listing.
 */
const REF_FOLDER = 'refs/flipbook';

/** Content types the picker may sign — what both a browser canvas and Pillow can round-trip. */
const ALLOWED_TYPES: Record<string, string> = {
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp',
};

/** A name must be ONE safe filename segment with an extension matching its content type. */
function isSafeName(name: string, ext: string): boolean {
	if (!name || name.length > 120) return false;
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) return false;
	return name.toLowerCase().endsWith(ext);
}

/**
 * Mint a presigned R2 PUT URL for a Flipbook **video source image** — the still an
 * image-to-video blueprint animates.
 *
 * Two of the three source options end up here: a region cropped out of an atlas in the browser,
 * and a file picked off the author's disk. (The third, picking a file that is ALREADY in the
 * project, needs no upload — it goes through the `/fsbrowse` proxy, which is the only thing that
 * knows the tool's per-root ref relativization. See `docs/ui-inventory.md` §1.)
 *
 * The browser PUTs the bytes DIRECTLY to R2 rather than POSTing them here: adapter-node's
 * `BODY_SIZE_LIMIT` is 512 KB and a symbol crop routinely exceeds it, so a proxied upload would
 * 413. Same pattern as the font + spine uploaders.
 *
 * The response's `ref` is the value to put in `source_ref` — built HERE, next to the key it
 * mirrors, so the two can never disagree.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'flipbook',
		forbiddenMessage: 'Your role does not have access to Invisible Flipbook.',
	});

	let body: { name?: unknown; contentType?: unknown };
	try {
		body = (await request.json()) as { name?: unknown; contentType?: unknown };
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const contentType = typeof body.contentType === 'string' ? body.contentType : '';
	const ext = ALLOWED_TYPES[contentType];
	if (!ext) {
		throw error(400, `Unsupported image type: ${contentType || '(none)'}.`);
	}

	const name = typeof body.name === 'string' ? body.name : '';
	if (!isSafeName(name, ext)) {
		throw error(400, `Invalid file name: ${JSON.stringify(name)}`);
	}

	const key = `${SUB.input(clientKey, projectKey)}/${REF_FOLDER}/${name}`;
	assertAllowed(key, prefixes);

	const url = await presignPut(key, contentType, PUT_TTL_SECONDS);
	return json({
		key,
		url,
		contentType,
		ref: `${REF_FOLDER}/${name}`,
		expiresInSeconds: PUT_TTL_SECONDS,
	});
};
