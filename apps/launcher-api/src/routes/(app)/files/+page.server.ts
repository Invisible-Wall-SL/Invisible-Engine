import { gate, rootPrefixes } from '$lib/server/ftpScope';
import type { PageServerLoad } from './$types';

/**
 * The FTP browser is client-driven via `/api/files/*`; the loader only gates
 * access and seeds the root listing. Scoped (developer) sessions get the
 * project's tool-namespace folders; full (admin) sessions get an empty seed and
 * the page fetches the live bucket root on mount.
 */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	const scope = await gate(locals, cookies);
	return {
		full: scope.full,
		clientKey: scope.clientKey,
		projectKey: scope.projectKey,
		rootFolders: rootPrefixes(scope),
	};
};
