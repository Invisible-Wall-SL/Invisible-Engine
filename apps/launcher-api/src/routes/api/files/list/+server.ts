import { error, json } from '@sveltejs/kit';
import { allowedPrefixes, assertAllowed, gate } from '$lib/server/ftpScope';
import { listFolder } from '$lib/server/r2';
import type { RequestHandler } from './$types';

/**
 * Folder listing for the active project. With no `prefix` we return the
 * top-level tool namespaces as folders. Otherwise we list one delimited page
 * under the (validated) prefix, re-checking every returned key/folder stays
 * inside the allowed prefixes (defense in depth).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);
	const prefix = url.searchParams.get('prefix') ?? '';
	const token = url.searchParams.get('token') ?? undefined;

	if (!prefix) {
		return json({ folders: allowedPrefixes(clientKey, projectKey), files: [], nextToken: null });
	}

	assertAllowed(prefix, clientKey, projectKey);
	const { files, folders, nextToken } = await listFolder(prefix, token);

	for (const f of folders) assertAllowed(f, clientKey, projectKey);
	for (const f of files) assertAllowed(f.key, clientKey, projectKey);

	return json({ folders, files, nextToken: nextToken ?? null });
};

export const fallback: RequestHandler = () => {
	throw error(405, 'method not allowed');
};
