import { error, json } from '@sveltejs/kit';
import { assertAllowed, gate, rootPrefixes } from '$lib/server/ftpScope';
import { listFolder } from '$lib/server/r2';
import type { RequestHandler } from './$types';

/**
 * Folder listing. With no `prefix`: scoped mode returns the project's tool
 * namespaces as folders; full (admin) mode lists the live bucket root. Otherwise
 * we list one delimited page under the (validated) prefix, re-checking every
 * returned key/folder stays inside the scope (defense in depth).
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const scope = await gate(locals, cookies);
	const prefix = url.searchParams.get('prefix') ?? '';
	const token = url.searchParams.get('token') ?? undefined;

	if (!prefix) {
		if (!scope.full) {
			return json({ folders: rootPrefixes(scope), files: [], nextToken: null });
		}
		const root = await listFolder('', token);
		return json({ folders: root.folders, files: root.files, nextToken: root.nextToken ?? null });
	}

	assertAllowed(prefix, scope);
	const { files, folders, nextToken } = await listFolder(prefix, token);

	for (const f of folders) assertAllowed(f, scope);
	for (const f of files) assertAllowed(f.key, scope);

	return json({ folders, files, nextToken: nextToken ?? null });
};

export const fallback: RequestHandler = () => {
	throw error(405, 'method not allowed');
};
