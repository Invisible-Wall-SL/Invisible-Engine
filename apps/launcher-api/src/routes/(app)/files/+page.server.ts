import { allowedPrefixes, gate } from '$lib/server/ftpScope';
import type { PageServerLoad } from './$types';

/**
 * The FTP browser is client-driven via `/api/files/*`; the loader only gates
 * access and seeds the root listing (the project's tool-namespace folders).
 */
export const load: PageServerLoad = async ({ locals, cookies }) => {
	const { clientKey, projectKey } = await gate(locals, cookies);
	return {
		clientKey,
		projectKey,
		rootFolders: allowedPrefixes(clientKey, projectKey),
	};
};
