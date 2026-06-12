import { error, json } from '@sveltejs/kit';
import { parseFontTarget, resolveFontTarget } from '$lib/server/fonts';
import { getRoleOverrides } from '$lib/server/roleToolAccess';
import { getToolOverrides } from '$lib/server/userToolAccess';
import { presignPut } from '$lib/server/r2';
import { assertAllowed, gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT each file straight to R2. */
const PUT_TTL_SECONDS = 600;
/** Cap per request — a descriptor + its page images is a handful of files. */
const MAX_FILES = 64;

interface UploadFile {
	name?: unknown;
	contentType?: unknown;
}
interface UploadRequest {
	folder?: unknown;
	files?: unknown;
	target?: unknown;
}

/** A name must be a single safe filename segment (no path separators / escapes). */
function isSafeName(name: string): boolean {
	if (!name || name.length > 255) return false;
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
	return true;
}

/**
 * Mint presigned R2 PUT URLs for a Font Maker import. The browser PUTs the BMFont
 * descriptor + every page image DIRECTLY to R2 — BMFont page PNGs routinely exceed
 * adapter-node's tiny `BODY_SIZE_LIMIT` (512 KB), so a multipart POST through the
 * node server would 413. Mirrors the spine-upload pattern.
 *
 * Every key is `${dest.bundleFor(folder)}/${name}` — the target's bundle helper
 * validates `folder` (rejects path escapes / bad segments) and `assertAllowed` then
 * confirms the key stays inside this session's project (or shared-fonts) prefix, so
 * a caller can never sign a key outside its own tree. A `shared` target additionally
 * requires the `fontPublish` capability (checked in `resolveFontTarget`) — the
 * shared `_shared/fonts/` prefix is in the allow-list for READS, so `assertAllowed`
 * alone would not stop a non-publisher from signing a shared write.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey, prefixes } = await gate(locals, cookies, {
		tool: 'fontMaker',
		forbiddenMessage: 'Your role does not have access to the Invisible Font Maker.',
		includeSharedFonts: true,
	});

	let body: UploadRequest;
	try {
		body = (await request.json()) as UploadRequest;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}

	const folder = body.folder;
	if (typeof folder !== 'string' || !folder) {
		throw error(400, 'Expected a `folder` string.');
	}
	const files = body.files;
	if (!Array.isArray(files) || files.length === 0) {
		throw error(400, 'Expected a non-empty `files` array.');
	}
	if (files.length > MAX_FILES) {
		throw error(400, `Too many files (max ${MAX_FILES} per request).`);
	}

	// Resolve the write target (shared ⇒ `fontPublish`-gated; project ⇒ unrestricted).
	const role = locals.user!.role;
	const roleOverrides = await getRoleOverrides(role);
	const userOverrides = await getToolOverrides(locals.user!.id);
	const dest = resolveFontTarget(
		parseFontTarget(body.target),
		clientKey,
		projectKey,
		role,
		roleOverrides,
		userOverrides,
	);

	// Throws (caught by SvelteKit → 400/500) on a bad folder segment.
	let bundle: string;
	try {
		bundle = dest.bundleFor(folder);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Invalid folder.');
	}

	const uploads: { name: string; key: string; url: string; contentType: string }[] = [];
	for (const raw of files as UploadFile[]) {
		const name = raw?.name;
		const contentType = raw?.contentType;
		if (typeof name !== 'string' || !isSafeName(name)) {
			throw error(400, `Invalid file name: ${JSON.stringify(name)}`);
		}
		if (typeof contentType !== 'string' || !contentType) {
			throw error(400, `Missing contentType for ${name}.`);
		}
		const key = `${bundle}/${name}`;
		assertAllowed(key, prefixes);
		const url = await presignPut(key, contentType, PUT_TTL_SECONDS);
		uploads.push({ name, key, url, contentType });
	}

	return json({ uploads, expiresInSeconds: PUT_TTL_SECONDS });
};
