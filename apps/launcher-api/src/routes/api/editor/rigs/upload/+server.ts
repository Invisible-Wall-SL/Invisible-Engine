import { error, json } from '@sveltejs/kit';
import { SUB } from '$lib/server/projectPaths';
import { presignPut } from '$lib/server/r2';
import { RIG_ASSET_EXT, contentTypeForRigFile, rigExt } from '$lib/server/rigIndex';
import { gate } from '$lib/server/toolScope';
import type { RequestHandler } from './$types';

/** How long the browser has to PUT each file straight to R2. */
const PUT_TTL_SECONDS = 600;
/** Cap per request so a single call can't mint an unbounded URL batch. */
const MAX_FILES = 2000;

/** A relpath is valid when it stays under the rigs prefix and has an allowed ext. */
function isValidRelpath(rel: string): boolean {
	if (!rel || rel.length > 1024) return false;
	if (rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) return false;
	if (rel.includes('//') || rel.endsWith('/')) return false;
	// No `.` / `..` segments and nothing that escapes the root.
	if (rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return false;
	return RIG_ASSET_EXT.has(rigExt(rel));
}

interface UploadRequest {
	files?: unknown;
}

/**
 * Mint presigned R2 PUT URLs for a project's rig upload. The browser PUTs each
 * file DIRECTLY to R2 (bypassing the launcher's tiny `BODY_SIZE_LIMIT`), then calls
 * the reindex endpoint. Every relpath is validated to stay under the session-bound
 * project's `spines/` prefix and to be an allowed rig extension — the server signs
 * only those keys, so a caller can never write outside its own project tree.
 */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies, {
		tool: 'editor',
		forbiddenMessage: 'Your role does not have access to the Invisible Editor.',
	});

	let body: UploadRequest;
	try {
		body = (await request.json()) as UploadRequest;
	} catch {
		throw error(400, 'Invalid JSON body.');
	}
	const files = body.files;
	if (!Array.isArray(files) || files.length === 0) {
		throw error(400, 'Expected a non-empty `files` array of relative paths.');
	}
	if (files.length > MAX_FILES) {
		throw error(400, `Too many files (max ${MAX_FILES} per request).`);
	}

	const rigsPrefix = SUB.spines(clientKey, projectKey);
	const uploads: { relpath: string; key: string; url: string; contentType: string }[] = [];
	for (const rel of files) {
		if (typeof rel !== 'string' || !isValidRelpath(rel)) {
			throw error(400, `Invalid rig file path: ${JSON.stringify(rel)}`);
		}
		const key = `${rigsPrefix}/${rel}`;
		const contentType = contentTypeForRigFile(rel);
		const url = await presignPut(key, contentType, PUT_TTL_SECONDS);
		uploads.push({ relpath: rel, key, url, contentType });
	}

	return json({ uploads, expiresInSeconds: PUT_TTL_SECONDS });
};
